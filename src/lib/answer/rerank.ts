/**
 * Pool → rerank → top-8 (issue #21 design note, ADR 0003 canary section).
 * /api/ask retrieves a pool of RERANK_POOL fused candidates; when
 * Voyage rerank-2.5-lite narrows them to ANSWER_TOP_K. On by default since
 * the #25 eval validated the lift (canary at fused #20 → reranked top-8;
 * hit-rate 19→25 of 25); `RERANK=off` opts out. Any rerank failure —
 * missing key, HTTP error, timeout — falls back to the fused order.
 * Reranking must never fail the ask.
 *
 * Since #287 the Voyage call asks for the *whole* pool in rank order rather
 * than only its top 8, and the cut to the answer set happens here. Voyage
 * scores every document either way — `top_k` only truncates the response —
 * so this costs one identical call and buys two things: the eval harness can
 * name the rank a missed target actually reached and which chunk displaced
 * it (#287 requirement 1), and the answer top-k becomes a knob
 * (`ANSWER_TOP_K`) that a measured run can move without touching the code.
 *
 * And since #286 the query it scores against is the question *plus* its
 * corpus-register expansion. The reranker reads the same question the fused
 * legs read, so it had the same register gap: a target moved from pool 24 to
 * pool 5 and still missed, because «desde cuánta plata al mes lo obligan a
 * uno a pagar Caja» does not look like «base mínima contributiva» to
 * `rerank-2.5-lite` either.
 */
import type { RetrievedChunk } from "../retrieval";

/**
 * Fused candidates fetched per question. 40, not 30, since #51: ley-iva
 * Art. 10 fuses at #38 for the tarifa-general question (vector #34, nothing
 * from the lexical leg), and the pool must reach the canonical source for the
 * reranker to promote it. Still one Voyage call either way.
 */
export const RERANK_POOL = 40;

/** Chunks handed to the answer model (SPEC §5: top-k ≈ 8). */
export const ANSWER_TOP_K = 8;

/** Rerank model of record; `RERANK_MODEL` swaps it for a measured run (#287). */
export const RERANK_MODEL = "rerank-2.5-lite";

/** Reranking adds latency before the first token — keep it bounded. */
const RERANK_TIMEOUT_MS = 3_000;

interface VoyageRerankResponse {
  data: { index: number; relevance_score: number }[];
}

export interface RerankOptions {
  fetchImpl?: typeof fetch;
  /**
   * The corpus-register rewrite retrieval ran on (#286), when there was one.
   * It is appended to the reranker's query rather than replacing it.
   *
   * The reranker reads the same question the fused legs read, so it has the
   * same register problem, and #286 found it the hard way: putting
   * `ho-desde-cuanta-plata-caja`'s target at pool rank 5 instead of 24 did
   * not make it a hit, because the reranker still scored «desde cuánta plata
   * al mes lo obligan a uno a pagar Caja» against artículos that say «base
   * mínima contributiva». Reranking on the question *and* its expansion
   * recovers that case and two more that were already being cut.
   *
   * Both, not the expansion alone: the rewrite is a probe, the question is
   * what the reader actually asked, and dropping it costs a case
   * (`ho-donde-inscribo-ya-no-atv`) that the question's own words carry.
   */
  expansion?: string | null;
}

/**
 * What the reranker scores against: the question, plus its expansion when
 * retrieval produced one.
 */
export function rerankQuery(
  question: string,
  expansion?: string | null,
): string {
  return expansion ? `${question} ${expansion}` : question;
}

/** One reranked pool member: the chunk, Voyage's score, its 1-based rank. */
export interface RerankedChunk {
  chunk: RetrievedChunk;
  score: number;
  rank: number;
}

/**
 * How many chunks reach the answer prompt. `ANSWER_TOP_K` in the environment
 * overrides the constant for a measured run (#287 option 1); anything that is
 * not a positive integer is ignored rather than trusted.
 */
export function answerTopK(): number {
  const raw = process.env.ANSWER_TOP_K;
  if (!raw) return ANSWER_TOP_K;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return ANSWER_TOP_K;
  return parsed;
}

/** The model Voyage is asked for; empty or unset means the model of record. */
function rerankModel(): string {
  return process.env.RERANK_MODEL || RERANK_MODEL;
}

/**
 * The whole pool in Voyage's order, or `null` when the rerank did not happen —
 * opted out, unkeyed, or failed. `null` is not an error: every caller falls
 * back to the fused order, which is the policy this module exists to keep.
 */
export async function rerankOrder(
  question: string,
  chunks: readonly RetrievedChunk[],
  options: RerankOptions = {},
): Promise<RerankedChunk[] | null> {
  // `||`, not `??`: CI interpolates an unset `vars.RERANK` as "", which must
  // mean "default on" — only an explicit RERANK=off opts out.
  if ((process.env.RERANK || "voyage") !== "voyage") return null;

  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const query = rerankQuery(question, options.expansion);
  try {
    const res = await fetchImpl("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: rerankModel(),
        query,
        documents: chunks.map((chunk) => chunk.content),
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as VoyageRerankResponse;
    const order = json.data.flatMap(({ index, relevance_score }, position) => {
      const chunk = chunks[index];
      return chunk === undefined
        ? []
        : [{ chunk, score: relevance_score, rank: position + 1 }];
    });
    return order.length > 0 ? order : null;
  } catch {
    return null;
  }
}

/**
 * The answer set: the reranked order cut to the answer top-k, or the fused
 * head when there is no reranked order. The one place the cut is made, so the
 * eval harness and the route agree by construction.
 */
export function answerSetFromOrder(
  order: readonly RerankedChunk[] | null,
  fused: readonly RetrievedChunk[],
): RetrievedChunk[] {
  const topK = answerTopK();
  if (order === null) return fused.slice(0, topK);
  return order.slice(0, topK).map(({ chunk }) => chunk);
}

export async function rerankChunks(
  question: string,
  chunks: readonly RetrievedChunk[],
  options: RerankOptions = {},
): Promise<RetrievedChunk[]> {
  return answerSetFromOrder(
    await rerankOrder(question, chunks, options),
    chunks,
  );
}
