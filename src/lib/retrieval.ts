/**
 * Hybrid retrieval (SPEC §5, issue #20) — the contract /api/ask (#21) and the
 * eval harness (#25) build against.
 *
 * The fusion itself lives in Postgres: `search_chunks` runs a pgvector cosine
 * leg and a `spanish` full-text leg and fuses them with reciprocal rank fusion
 * (k = 60). This module embeds the question with the same provider the corpus
 * was embedded with, calls that RPC, and maps rows to typed chunks, citations,
 * and the weak-retrieval signal the honest-fallback path keys off.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { createEmbedder, type Embedder } from "./ingestion/embedder";
import { serviceClient } from "./supabase/service";

/** RRF constant, mirrored by the SQL function. */
export const RRF_K = 60;

/**
 * Rows each leg contributes to the fusion, mirrored by the SQL function.
 * Widened from 20 in #51 so vector-deep chunks (ley-iva Art. 10 sits at
 * vector #34 for the tarifa-general question) can reach the rerank pool.
 */
export const LEG_LIMIT = 50;

/** Fused rows returned when the caller does not ask for a specific count. */
export const DEFAULT_MATCH_COUNT = 8;

/** `documents.source` jsonb (SPEC §4). */
export interface DocumentSource {
  kind?: string;
  /** hacienda-pdf / plain url sources. */
  url?: string;
  /** cabys sources point at the catalog they were curated from. */
  catalog?: string;
  idFichaNorma?: number;
  idVersionNorma?: number;
}

/** One row of `public.search_chunks`, wire shape. */
export interface SearchChunksRow {
  chunk_id: string;
  doc_key: string;
  doc_title: string;
  norma: string | null;
  articulo: string | null;
  path: string[];
  part: number;
  content: string;
  source: DocumentSource;
  score: number;
  /** 1-based rank in the vector leg; null when that leg missed the chunk. */
  vector_rank: number | null;
  /** 1-based rank in the lexical leg; null when that leg missed the chunk. */
  lexical_rank: number | null;
}

export interface SearchChunksArgs {
  /** Empty string disables the lexical leg — vector-only. */
  query_text: string;
  /**
   * pgvector literal — `[0.1,0.2,…]`, which is what PostgREST casts. `null`
   * disables the vector leg — lexical-only, which is also how retrieval keeps
   * working if the embedding provider is down.
   */
  query_embedding: string | null;
  match_count: number;
}

/**
 * The slice of `SupabaseClient<Database>` retrieval needs — narrow enough that
 * tests can hand in a fake without standing up PostgREST.
 */
export interface RetrievalRpcClient {
  rpc(
    fn: "search_chunks",
    args: SearchChunksArgs,
  ): PromiseLike<{
    data: SearchChunksRow[] | null;
    error: { message: string } | null;
  }>;
}

export interface RetrievedChunk {
  chunkId: string;
  docKey: string;
  docTitle: string;
  norma: string | null;
  articulo: string | null;
  path: string[];
  part: number;
  content: string;
  source: DocumentSource;
  /** RRF score; comparable across chunks of one query, not across queries. */
  score: number;
  /** 1-based rank in the vector leg; null when that leg missed the chunk. */
  vectorRank: number | null;
  /** 1-based rank in the lexical leg; null when that leg missed the chunk. */
  lexicalRank: number | null;
}

/** What an answer renders as a `Documento · Artículo` chip (SPEC §5). */
export interface Citation {
  docKey: string;
  docTitle: string;
  norma: string | null;
  articulo: string | null;
  url: string | null;
}

/**
 * Runtime guard for one persisted `citations` element (issue #61):
 * `saveQuestion` writes `Citation[]` through a `Json` cast (persist.ts), so
 * nothing statically checks that a row read back from `questions.citations`
 * still has this shape. `docKey`/`docTitle` are always strings; `norma`,
 * `articulo`, `url` are nullable per `Citation` — a chunk can lack a norma
 * label, an artículo, or a resolvable citation URL.
 */
export function isCitation(value: unknown): value is Citation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.docKey === "string" &&
    typeof v.docTitle === "string" &&
    (typeof v.norma === "string" || v.norma === null) &&
    (typeof v.articulo === "string" || v.articulo === null) &&
    (typeof v.url === "string" || v.url === null)
  );
}

/**
 * Parses a persisted `citations` column (or any `Json`) back into
 * `Citation[]`, throwing on the first element that does not match — the
 * same check the history UI could adopt instead of trusting the `Json` cast
 * in `persist.ts` blind.
 */
export function parseCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    throw new Error(`parseCitations: expected an array, got ${typeof value}`);
  }
  return value.map((entry, index) => {
    if (!isCitation(entry)) {
      throw new Error(
        `parseCitations: element ${index} is not a Citation: ${JSON.stringify(entry)}`,
      );
    }
    return entry;
  });
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  /** One entry per cited artículo, in fused order; parts collapse into one. */
  citations: Citation[];
  /** Score of the best chunk, 0 when nothing matched. */
  topScore: number;
  /** No returned chunk was corroborated — trigger for the honest fallback. */
  isWeak: boolean;
}

export interface RetrieveOptions {
  matchCount?: number;
  client?: RetrievalRpcClient;
  embedder?: Embedder;
}

/**
 * A chunk is corroborated when both the vector and the lexical leg surfaced
 * it. `isWeak` — no returned chunk corroborated — is what #21 turns into the
 * honest fallback (say so and link the agency) instead of answering from
 * single-leg hits. Until #51 this was inferred from a score threshold
 * (2/(k + LEG_LIMIT)); coverage-scaled fallback contributions broke that
 * arithmetic, so the SQL now returns each leg's rank and the signal is
 * structural. The eval asserts no dataset question ever trips it
 * (retrieval-hitrate.integration.test.ts).
 */
export function isCorroborated(chunk: {
  vectorRank: number | null;
  lexicalRank: number | null;
}): boolean {
  return chunk.vectorRank !== null && chunk.lexicalRank !== null;
}

/** Score one leg contributes to an id ranked `rank` (1-based). */
export function rrfScore(rank: number, k = RRF_K): number {
  if (!Number.isFinite(rank) || rank < 1) {
    throw new Error(`rrfScore: rank must be >= 1, got ${rank}`);
  }
  return 1 / (k + rank);
}

/**
 * One leg entry for `fuseRrf`: a bare id contributes its full RRF score, an
 * `{ id, weight }` entry contributes `weight * rrfScore(rank)`. Weights model
 * the SQL's coverage scaling on the OR-fallback lexical leg (#51): the weight
 * is the fraction of query lexemes the chunk matches, 1 everywhere else.
 */
export type LegEntry = string | { id: string; weight: number };

/**
 * Reference implementation of the fusion the SQL performs: sum each id's
 * per-leg contribution, best first. The integration test cross-checks the RPC's
 * scores against it, which is what keeps the two in step.
 */
export function fuseRrf(
  legs: readonly (readonly LegEntry[])[],
  k = RRF_K,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const leg of legs) {
    leg.forEach((entry, index) => {
      const { id, weight } =
        typeof entry === "string" ? { id: entry, weight: 1 } : entry;
      scores.set(id, (scores.get(id) ?? 0) + weight * rrfScore(index + 1, k));
    });
  }
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Official address for a document's citation chip.
 *
 * SINALEVI fichas get the viewer link the site itself redirects legacy SCIJ
 * URLs to; `param2` is left empty on purpose — that is what makes the viewer
 * resolve and render the vigente version (a pinned version id renders the
 * ficha's default tab instead of the text).
 */
export function citationUrl(
  source: DocumentSource | null | undefined,
): string | null {
  if (!source) return null;
  if (source.kind === "sinalevi" && source.idFichaNorma) {
    return `https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=${source.idFichaNorma}&param2=&param3=1&param4=`;
  }
  const address = source.url ?? source.catalog;
  if (!address) return null;
  return /^https?:\/\//i.test(address) ? address : null;
}

/**
 * Dedupe identity for citations: one per doc + artículo (parts collapse).
 * Shared with the answer layer's citation tracker so both dedupe the same
 * way. NUL as separator because it cannot appear in either field — written
 * as an escape so the source file stays text to git (see 797a2fc).
 */
export function citationIdentity(entry: {
  docKey: string;
  articulo: string | null;
}): string {
  return `${entry.docKey}\u0000${entry.articulo ?? ""}`;
}

export function toCitation(chunk: RetrievedChunk): Citation {
  return {
    docKey: chunk.docKey,
    docTitle: chunk.docTitle,
    norma: chunk.norma,
    articulo: chunk.articulo,
    url: citationUrl(chunk.source),
  };
}

function toChunk(row: SearchChunksRow): RetrievedChunk {
  return {
    chunkId: row.chunk_id,
    docKey: row.doc_key,
    docTitle: row.doc_title,
    norma: row.norma,
    articulo: row.articulo,
    path: row.path ?? [],
    part: row.part,
    content: row.content,
    source: row.source ?? {},
    score: row.score,
    vectorRank: row.vector_rank ?? null,
    lexicalRank: row.lexical_rank ?? null,
  };
}

type GeneratedArgs = Database["public"]["Functions"]["search_chunks"]["Args"];

/**
 * Adapts a Supabase client to the retrieval contract. The generated types
 * describe `source` as free-form `Json`, cannot express which RETURNS TABLE
 * columns are nullable, and cannot express the nullable vector argument — so
 * both shapes are re-asserted here. These are the only casts in the module,
 * they sit at the database boundary, and the integration test covers them.
 */
export function asRetrievalClient(
  client: SupabaseClient<Database>,
): RetrievalRpcClient {
  return {
    rpc: (fn, args) =>
      client.rpc(fn, args as GeneratedArgs).then(({ data, error }) => ({
        data: (data ?? null) as SearchChunksRow[] | null,
        error,
      })),
  };
}

/** Service-role client — `search_chunks` is granted to that role only. */
export function createRetrievalClient(): RetrievalRpcClient {
  return asRetrievalClient(serviceClient());
}

export async function retrieve(
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return {
      query: trimmed,
      chunks: [],
      citations: [],
      topScore: 0,
      isWeak: true,
    };
  }

  const embedder = options.embedder ?? createEmbedder();
  const client = options.client ?? createRetrievalClient();
  const [embedding] = await embedder.embed([trimmed]);

  const { data, error } = await client.rpc("search_chunks", {
    query_text: trimmed,
    query_embedding: JSON.stringify(embedding),
    match_count: options.matchCount ?? DEFAULT_MATCH_COUNT,
  });
  if (error) {
    throw new Error(`search_chunks failed for "${trimmed}": ${error.message}`);
  }

  const chunks = (data ?? []).map(toChunk);
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const chunk of chunks) {
    const key = citationIdentity(chunk);
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(toCitation(chunk));
  }

  const topScore = chunks[0]?.score ?? 0;
  return {
    query: trimmed,
    chunks,
    citations,
    topScore,
    isWeak: !chunks.some(isCorroborated),
  };
}
