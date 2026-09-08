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
import { expandQuery, expansionEnabled } from "./answer/expand";
import { stepProbe, stepsEnabled, type StepProbe } from "./answer/steps";

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
  /** `documents.effective_date` — when the cited rule or figure took effect. */
  effective_date: string | null;
  /** `documents.fetched_at` — when the corpus last pulled this document. */
  fetched_at: string | null;
  score: number;
  /** 1-based rank in the vector leg; null when that leg missed the chunk. */
  vector_rank: number | null;
  /** 1-based rank in the lexical leg; null when that leg missed the chunk. */
  lexical_rank: number | null;
  /** 1-based rank in the expansion's vector leg; null when it missed (#286). */
  expansion_vector_rank: number | null;
  /** 1-based rank in the expansion's lexical leg; null when it missed (#286). */
  expansion_lexical_rank: number | null;
  /**
   * 1-based rank in the step catalogue's vector leg (#304), by the nearest
   * sentence; null when it missed, absent from a v5 row.
   */
  step_vector_rank?: number | null;
  /** 1-based rank in the step catalogue's lexical leg, by the best sentence. */
  step_lexical_rank?: number | null;
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
  /**
   * The question rewritten into the register of the corpus (#286), or null
   * for the two-leg contract v4 had. Feeds the expansion lexical leg. Both
   * expansion arguments are optional on the wire — omitting them is what a
   * caller with no model does, and the SQL defaults them to null.
   */
  expansion_text?: string | null;
  /** pgvector literal for `expansion_text`; null disables its vector leg. */
  expansion_embedding?: string | null;
  /**
   * The step catalogue's sentences (#304), one probe each, or null for the
   * four-leg contract v5 had. Feeds the step lexical leg, ranked by the best
   * sentence.
   */
  step_texts?: string[] | null;
  /**
   * One pgvector literal per sentence, in the same order, or null in the slot
   * of a sentence whose embed failed — that sentence keeps its lexical leg
   * and loses its vector one, as `expansion_embedding: null` does for the
   * expansion. Null altogether disables the step vector leg.
   */
  step_embeddings?: (string | null)[] | null;
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
  /** ISO date the document's cited rule or figure took effect (#262). */
  effectiveAt?: string | null;
  /**
   * ISO timestamp the corpus last fetched this document (`documents.
   * fetched_at`), null for a document ingested before the column was
   * stamped. It rides along to the citation chip, which prints it as
   * "consultado el …" (#135), beside the document's effective date when one
   * is declared (#262).
   */
  fetchedAt: string | null;
  /** RRF score; comparable across chunks of one query, not across queries. */
  score: number;
  /** 1-based rank in the vector leg; null when that leg missed the chunk. */
  vectorRank: number | null;
  /** 1-based rank in the lexical leg; null when that leg missed the chunk. */
  lexicalRank: number | null;
  /**
   * 1-based rank in the expansion's vector leg (#286); null when that leg
   * missed the chunk, and absent when the retrieval ran no expansion at all.
   */
  expansionVectorRank?: number | null;
  /** 1-based rank in the expansion's lexical leg; null when it missed (#286). */
  expansionLexicalRank?: number | null;
  /**
   * 1-based rank in the step catalogue's vector leg (#304) — the chunk's
   * distance to its nearest catalogue sentence; null when that leg missed
   * it, and absent when the retrieval ran no catalogue at all.
   */
  stepVectorRank?: number | null;
  /** 1-based rank in the step catalogue's lexical leg; null when it missed. */
  stepLexicalRank?: number | null;
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
  /**
   * The corpus-register rewrite the expansion legs ran on (#286), or null
   * when there was none: no model configured, a failed or unusable rewrite,
   * or a caller that opted out. Null means this retrieval is exactly the
   * two-leg search v4 performed.
   */
  expansion: string | null;
  /**
   * The step catalogue probe the step legs ran on (#304) — the family the
   * question classified to and its sentences — or null when there was none:
   * the question named no family, `STEPS=off`, or a caller that opted out.
   */
  steps: StepProbe | null;
}

/**
 * Rewrites a question into the register of the corpus (#286). The seam exists
 * so tests can supply a rewrite without a model call, and so a caller can pass
 * `null` to opt out of expansion entirely.
 */
export interface QueryExpander {
  expand(query: string): Promise<string | null>;
}

/**
 * The step-catalogue seam (#304): names the family's probe for a question,
 * or `null` when the question belongs to none. Deterministic in production
 * (`stepProbe`); the seam exists so tests can hand in a probe without the
 * classifier, and so a caller can pass `null` to opt out.
 */
export interface StepCatalogue {
  probe(query: string): StepProbe | null;
}

export interface RetrieveOptions {
  matchCount?: number;
  client?: RetrievalRpcClient;
  embedder?: Embedder;
  /**
   * Expansion seam (#286). Omit for the production expander, which is skipped
   * when no Anthropic key is configured; pass `null` to search the literal
   * question only.
   */
  expander?: QueryExpander | null;
  /**
   * Step-catalogue seam (#304). Omit for the production catalogue, which is
   * skipped under `STEPS=off`; pass `null` to search without it.
   */
  steps?: StepCatalogue | null;
}

/**
 * A chunk is corroborated when **the reader's own words matched it** — the
 * question's lexical leg surfaced it — and a similarity leg did too, whether
 * that leg ran on the question or on its corpus-register expansion (#286).
 *
 * The lexical leg is the only witness that can miss. Nearest-neighbour search
 * ranks the whole corpus for any string, so the vector leg surfaces *some*
 * chunk for gibberish, and the expansion is a passage a model wrote for this
 * question, which it writes for any question — including one the corpus
 * cannot answer, when it writes a refusal in the corpus's own register
 * («términos tributarios», «normativa»). #286 required only that one raw leg
 * be present, and the raw vector leg always was; the expansion's lexical leg
 * then supplied "by words" for free, and a nonsense question stopped tripping
 * `isWeak` (#307). So the rule now names the discriminating leg. What that
 * guarantees is one-directional: a question that shares not one lexeme with
 * the corpus is weak whether expansion is off or on, because nothing the
 * expansion finds can stand in for the reader's words. In the other direction
 * the expansion still helps — a chunk the reader's words did match, but the
 * question's own vector leg missed, may take its similarity witness from the
 * expansion's vector leg. That is the #286 register gap, and it is the one
 * place the expansion can still move `isWeak`: towards answering, never
 * towards declining.
 *
 * The step catalogue's legs (#304) are not a witness on either side. The
 * probe is the same hand-written text for every question in a family, so a
 * chunk it found says nothing about *this* question's words, and a
 * similarity witness that any question in the family would supply is not a
 * similarity to what the reader asked. The catalogue can fill a pool; it
 * cannot move `isWeak`.
 *
 * `isWeak` — no returned chunk corroborated — is what #21 turns into the
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
  expansionVectorRank?: number | null;
  expansionLexicalRank?: number | null;
}): boolean {
  const bySimilarity =
    chunk.vectorRank !== null || (chunk.expansionVectorRank ?? null) !== null;
  const byTheReadersWords = chunk.lexicalRank !== null;
  return bySimilarity && byTheReadersWords;
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
    ...(chunk.effectiveAt !== undefined
      ? { effectiveAt: chunk.effectiveAt }
      : {}),
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
    effectiveAt: row.effective_date ?? null,
    fetchedAt: row.fetched_at ?? null,
    score: row.score,
    vectorRank: row.vector_rank ?? null,
    lexicalRank: row.lexical_rank ?? null,
    expansionVectorRank: row.expansion_vector_rank ?? null,
    expansionLexicalRank: row.expansion_lexical_rank ?? null,
    stepVectorRank: row.step_vector_rank ?? null,
    stepLexicalRank: row.step_lexical_rank ?? null,
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

/**
 * The production expander, or `null` when expansion is switched off or has no
 * provider — `expansionEnabled` owns that decision (expand.ts), and this asks
 * it rather than re-deciding, so there is one answer to "does this ask
 * expand?" and it lives beside the call it gates.
 */
function defaultExpander(): QueryExpander | null {
  return expansionEnabled() ? { expand: (query) => expandQuery(query) } : null;
}

/** The production catalogue, or `null` under `STEPS=off` (steps.ts owns it). */
function defaultStepCatalogue(): StepCatalogue | null {
  return stepsEnabled() ? { probe: (query) => stepProbe(query) } : null;
}

/**
 * One embed attempt, `null` instead of a throw. `countDegradation` is what
 * separates the question's embed — whose failure is the #127 degradation the
 * reader is told about — from the expansion's, which costs the search only a
 * leg it did not have before #286.
 */
async function embedOrNull(
  embedder: Embedder,
  text: string,
  countDegradation = true,
): Promise<number[] | null> {
  try {
    return await embedder.embedQuery(text);
  } catch (error) {
    if (countDegradation) recordDegradedRetrieval(error);
    return null;
  }
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
      expansion: null,
      steps: null,
    };
  }

  const embedder = options.embedder ?? createEmbedder();
  const client = options.client ?? createRetrievalClient();
  const expander =
    options.expander === undefined ? defaultExpander() : options.expander;
  const catalogue =
    options.steps === undefined ? defaultStepCatalogue() : options.steps;
  // Free and synchronous: a keyword table over the question (#304). It is
  // decided before any provider is called so its sentences can be embedded
  // in the same wait as the question.
  const steps = catalogue === null ? null : catalogue.probe(trimmed);

  // #127: the ask path does not get to die because the embedding provider is
  // down. `embedQuery` is one attempt on a ~5 s budget; when it does not come
  // back with a vector we run the RPC's own lexical-only contract
  // (`query_embedding: null`) rather than propagating the failure into
  // `retrieval_failed`. Counting happens here, at the one place that knows a
  // degradation happened at all.
  //
  // The expansion (#286) is asked for alongside that embed rather than in
  // front of it: the two calls go to different providers and neither needs
  // the other's answer, so the reader waits for the slower one, not for both.
  //
  // The catalogue's sentences (#304) embed in the same wait: they are known
  // before anything is called, and each is one more request to the same
  // provider. A sentence whose embed fails keeps its lexical leg, like the
  // expansion's, and is not counted as the reader's degradation either.
  const [embedding, expansion, stepEmbeddings] = await Promise.all([
    embedOrNull(embedder, trimmed),
    expander === null ? Promise.resolve(null) : expander.expand(trimmed),
    steps === null
      ? Promise.resolve(null)
      : Promise.all(
          steps.sentences.map((sentence) =>
            embedOrNull(embedder, sentence, false),
          ),
        ),
  ]);
  const isDegraded = embedding === null;

  // An expansion whose embedding fails is not a degradation — the question's
  // own legs are untouched — so it simply keeps its lexical leg and loses its
  // vector one, exactly as `query_embedding: null` does for the question.
  const expansionEmbedding =
    expansion === null ? null : await embedOrNull(embedder, expansion, false);

  const { data, error } = await client.rpc("search_chunks", {
    query_text: trimmed,
    query_embedding: embedding === null ? null : JSON.stringify(embedding),
    match_count: options.matchCount ?? DEFAULT_MATCH_COUNT,
    expansion_text: expansion,
    expansion_embedding:
      expansionEmbedding === null ? null : JSON.stringify(expansionEmbedding),
    step_texts: steps === null ? null : steps.sentences,
    step_embeddings:
      stepEmbeddings === null
        ? null
        : stepEmbeddings.map((vector) =>
            vector === null ? null : JSON.stringify(vector),
          ),
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
    // signal that is available to us — the question's `vectorRank` is null on
    // every chunk and the structural test would decline every single degraded
    // ask, turning the fallback #127 asks for into a dead end. Weakness there
    // is the only honest thing lexical-only can still say: **the reader's own
    // words** matched nothing at all. Since #286 that has to be said in those
    // terms rather than as `chunks.length === 0`: the expansion's legs can
    // fill a pool on a degraded ask all by themselves — its embed is a
    // separate call and may well have succeeded — and a pool made only of
    // chunks a model-written passage found is exactly what must not clear the
    // honest decline.
    isWeak: isDegraded
      ? !chunks.some((chunk) => chunk.lexicalRank !== null)
      : !chunks.some(isCorroborated),
    isDegraded,
    expansion,
    steps,
  };
}
