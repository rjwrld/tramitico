/**
 * Pool → rerank → top-8 (issue #21 design note, ADR 0003 canary section).
 * /api/ask retrieves a pool of RERANK_POOL fused candidates; when
 * Voyage rerank-2.5-lite narrows them to ANSWER_TOP_K. On by default since
 * the #25 eval validated the lift (canary at fused #20 → reranked top-8;
 * hit-rate 19→25 of 25); `RERANK=off` opts out. Any rerank failure —
 * missing key, HTTP error, timeout — falls back to the fused order.
 * Reranking must never fail the ask.
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

export async function rerankChunks(
  question: string,
  chunks: readonly RetrievedChunk[],
  options: RerankOptions = {},
): Promise<RetrievedChunk[]> {
  const fused = chunks.slice(0, ANSWER_TOP_K);
  // `||`, not `??`: CI interpolates an unset `vars.RERANK` as "", which must
  // mean "default on" — only an explicit RERANK=off opts out.
  if ((process.env.RERANK || "voyage") !== "voyage") return fused;

  const key = process.env.VOYAGE_API_KEY;
  if (!key) return fused;

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
        model: "rerank-2.5-lite",
        query,
        documents: chunks.map((chunk) => chunk.content),
        top_k: ANSWER_TOP_K,
      }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });
    if (!res.ok) return fused;
    const json = (await res.json()) as VoyageRerankResponse;
    const reranked = json.data
      .map(({ index }) => chunks[index])
      .filter((chunk): chunk is RetrievedChunk => chunk !== undefined)
      .slice(0, ANSWER_TOP_K);
    return reranked.length > 0 ? reranked : fused;
  } catch {
    return fused;
  }
}
