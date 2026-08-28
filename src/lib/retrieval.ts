/**
 * Hybrid retrieval (SPEC §5, issue #20) — the contract /api/ask (#21) and the
 * eval harness (#25) build against.
 *
 * The fusion itself lives in Postgres: `search_chunks` runs a pgvector cosine
 * leg and a `spanish` full-text leg and fuses them with reciprocal rank fusion
 * (k = 60). This module embeds the question with the same provider the corpus
 * was embedded with, calls that RPC, and maps rows to typed chunks, citations,
 * and the weak-retrieval signal the honest-fallback path keys off.
 *
 * The embed is the one step here that depends on a third party being up, so
 * since #127 it is allowed to fail: an embed that errors or blows its ~5 s
 * budget degrades the query to the RPC's lexical-only contract
 * (`query_embedding: null`) and says so through `isDegraded`, rather than
 * taking the ask down with it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { createEmbedder, type Embedder } from "./ingestion/embedder";
import { serviceClient } from "./supabase/service";
import { isCitation, parseCitations, type Citation } from "./citations";
import { recordDegradedRetrieval } from "./retrieval-degraded";

/**
 * What the `search_chunks` RPC rejecting looks like to a caller. Used to read
 * `search_chunks failed for "<the user's question>": <the Postgres message>`,
 * which put the question — and whatever of the row Postgres chose to quote —
 * one `console.error` away from an operational log (#136). The context now
 * lives in the class name, which is ours, rather than in a message built from
 * input we do not control; the driver's error rides along as `cause`, where
 * `describeError` will take its SQLSTATE and nothing else.
 */
export class SearchChunksError extends Error {
  constructor(cause: unknown) {
    super("search_chunks failed", { cause });
    this.name = "SearchChunksError";
  }
}

// Re-exported so existing server-side imports of `Citation`/`isCitation`/
// `parseCitations` from "@/lib/retrieval" keep working unchanged — the
// definitions themselves live in the client-safe `./citations` (issue #94).
export { isCitation, parseCitations };
export type { Citation };

/** RRF constant, mirrored by the SQL function. */
export const RRF_K = 60;

/**
 * Rows each leg contributes to the fusion, mirrored by the SQL function.
 * Widened from 20 in #51 so vector-deep chunks (ley-iva Art. 10 sits at
 * vector #34 for the tarifa-general question) can reach the rerank pool.
 *
 * An HNSW scan returns at most `hnsw.ef_search` rows regardless of LIMIT, so
 * `search_chunks` pins that GUC above this value
 * (supabase/migrations/20260828120000_hnsw_ef_search_rate_limits_index.sql);
 * if this constant moves, that setting must move with it.
 */
export const LEG_LIMIT = 50;

/** Fused rows returned when the caller does not ask for a specific count. */
export const DEFAULT_MATCH_COUNT = 8;

/**
 * How deeply a source's official URL can be linked (issue #134), audited per
 * manifest entry and recorded in `corpus/manifest.json`:
 *
 * - `articulo` — SINALEVI fichas: the viewer opens one artículo directly, keyed
 *   by the opaque `idArticulo` harvested into `articulos` at ingestion.
 * - `page` — page-ranged PDFs: the PDF viewer honours a `#page=` fragment, so
 *   the chip lands on the first page of the range we actually ingested.
 * - `none` — no anchor the official URL supports (whole-file PDFs with no
 *   article→page map, a PDF inside a zip, the CABYS catalog page): the chip
 *   keeps the document root, which #121 accepted as long as it is documented.
 */
export type DeepLinkKind = "articulo" | "page" | "none";

/** `documents.source` jsonb (SPEC §4). */
export interface DocumentSource {
  kind?: string;
  /** hacienda-pdf / plain url sources. */
  url?: string;
  /** cabys sources point at the catalog they were curated from. */
  catalog?: string;
  idFichaNorma?: number;
  idVersionNorma?: number;
  /** Deep-link capability audited for this source (#134). */
  deepLink?: DeepLinkKind;
  /** `deepLink: "articulo"`: artículo number → SINALEVI `idArticulo`. */
  articulos?: Record<string, number>;
  /** `deepLink: "page"`: 1-based inclusive page range, e.g. "165-171". */
  pages?: string;
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
  /** `documents.fetched_at` — when the corpus last pulled this document. */
  fetched_at: string | null;
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
  /**
   * ISO timestamp the corpus last fetched this document (`documents.
   * fetched_at`), null for a document ingested before the column was
   * stamped. It rides along to the citation chip, which prints it as
   * "consultado el …" (#135) — the honest freshness signal we do have, as
   * opposed to `effective_date`, which is unpopulated and post-launch (#121).
   */
  fetchedAt: string | null;
  /** RRF score; comparable across chunks of one query, not across queries. */
  score: number;
  /** 1-based rank in the vector leg; null when that leg missed the chunk. */
  vectorRank: number | null;
  /** 1-based rank in the lexical leg; null when that leg missed the chunk. */
  lexicalRank: number | null;
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
  /**
   * The vector leg never ran: the interactive embed failed or timed out and
   * retrieval fell back to lexical-only (#127). The answer is still grounded
   * in real documents, but in a thinner search than usual — the route labels
   * it on the wire so the reader is told rather than quietly served less.
   */
  isDegraded: boolean;
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
 * (retrieval-hitrate.eval.test.ts).
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

const SINALEVI_VIEWER =
  "https://sinalevi.go.cr/ResultadosNormativa/Informacion";

/**
 * `documents.source` is untrusted jsonb: every value interpolated into a URL
 * has to be a positive integer before it goes anywhere near a query string.
 */
function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * The chunk's artículo heading → the key `source.articulos` is harvested under
 * (issue #134). Only a plain, whole-numbered artículo can be anchored: the
 * SINALEVI rail numbers its anchors, so `Artículo 8 bis`, transitorios and the
 * preámbulo have no key and keep the document root.
 */
function articuloAnchorKey(articulo: string | null | undefined): string | null {
  const m = articulo?.trim().match(/^ART[ÍI]CULO\s+(\d+)$/i);
  return m ? m[1] : null;
}

/**
 * Official address for a document's citation chip, deep-linked to `articulo`
 * where the source's own URL structure supports it (issue #134; capability
 * audited per source and recorded as `source.deepLink` in the manifest).
 *
 * SINALEVI fichas get the viewer link the site itself redirects legacy SCIJ
 * URLs to. On the document root `param2` is left empty on purpose — that is
 * what makes the viewer resolve and render the vigente version (a pinned
 * version id renders the ficha's default tab instead of the text). The
 * artículo view (`param3=3`) is the deliberate exception: it *requires* a
 * version id, and pinning the one we ingested is the honest link — it opens
 * the exact text the answer was grounded in, not a later reform we never read.
 */
export function citationUrl(
  source: DocumentSource | null | undefined,
  articulo?: string | null,
): string | null {
  if (!source) return null;
  if (source.kind === "sinalevi" && source.idFichaNorma) {
    const ficha = positiveInt(source.idFichaNorma);
    if (!ficha) return null;
    const root = `${SINALEVI_VIEWER}?param1=${ficha}&param2=&param3=1&param4=`;
    if (source.deepLink !== "articulo") return root;
    const version = positiveInt(source.idVersionNorma);
    const key = articuloAnchorKey(articulo);
    const idArticulo = key ? positiveInt(source.articulos?.[key]) : null;
    if (!version || !idArticulo) return root;
    return `${SINALEVI_VIEWER}?param1=${ficha}&param2=${version}&param3=3&param4=${idArticulo}&param5=`;
  }
  const address = source.url ?? source.catalog;
  if (!address) return null;
  if (!/^https?:\/\//i.test(address)) return null;
  if (source.deepLink === "page") {
    const first = positiveInt(Number(source.pages?.match(/^(\d+)-\d+$/)?.[1]));
    // Never append a second fragment — the address is the root otherwise.
    if (first && !address.includes("#")) return `${address}#page=${first}`;
  }
  return address;
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
    url: citationUrl(chunk.source, chunk.articulo),
    fetchedAt: chunk.fetchedAt,
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
    fetchedAt: row.fetched_at ?? null,
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
      isDegraded: false,
    };
  }

  const embedder = options.embedder ?? createEmbedder();
  const client = options.client ?? createRetrievalClient();

  // #127: the ask path does not get to die because the embedding provider is
  // down. `embedQuery` is one attempt on a ~5 s budget; when it does not come
  // back with a vector we run the RPC's own lexical-only contract
  // (`query_embedding: null`) rather than propagating the failure into
  // `retrieval_failed`. Counting happens here, at the one place that knows a
  // degradation happened at all.
  let embedding: number[] | null = null;
  try {
    embedding = await embedder.embedQuery(trimmed);
  } catch (error) {
    recordDegradedRetrieval(error);
  }
  const isDegraded = embedding === null;

  const { data, error } = await client.rpc("search_chunks", {
    query_text: trimmed,
    query_embedding: embedding === null ? null : JSON.stringify(embedding),
    match_count: options.matchCount ?? DEFAULT_MATCH_COUNT,
  });
  if (error) {
    throw new SearchChunksError(error);
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
    // Corroboration needs two legs, so on the degraded path it is not a
    // signal that is available to us — every chunk has a null `vectorRank`
    // and the structural test would decline every single degraded ask,
    // turning the fallback #127 asks for into a dead end. Weakness there is
    // the only honest thing lexical-only can still say: the query matched
    // nothing at all.
    isWeak: isDegraded ? chunks.length === 0 : !chunks.some(isCorroborated),
    isDegraded,
  };
}
