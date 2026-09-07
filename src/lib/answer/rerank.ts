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
 * And since #286 the rerank reads the corpus-register expansion as well as
 * the question. The reranker reads the same question the fused legs read, so
 * it had the same register gap: a target moved from pool 24 to pool 5 and
 * still missed, because «desde cuánta plata al mes lo obligan a uno a pagar
 * Caja» does not look like «base mínima contributiva» to `rerank-2.5-lite`
 * either.
 *
 * #286 read both by **concatenating** them into one query string, and #296
 * measured what that costs. One string is one reading, and the reranker
 * scores it as one: a question that names a foreign country («Le cobro a un
 * cliente en España…») draws an expansion written in European VAT doctrine,
 * and once that vocabulary is inside the query the Costa Rican artículo the
 * reader needed fell from reranked #3 to #10 — a Tier 1 miss caused by text
 * no reader wrote. The shape is general: a foreign country, a foreign
 * currency or an international platform can all pull the rewrite into another
 * jurisdiction's rules, and the corpus is Costa Rican and only Costa Rican.
 *
 * So the two queries are scored **separately and fused by the higher score**
 * (`fuseByMaxScore`). Two Voyage calls run in parallel under the one timeout,
 * and a chunk keeps the best relevance either reading gave it. That restores,
 * on the rerank side, the bound the expansion legs already have on the fused
 * side (expand.ts, property 3): the expansion can only ever raise a chunk's
 * score, never lower it. It is a bound, not immunity — a competitor the
 * expansion lifts can still cross above a chunk whose own score never moved —
 * but a bad rewrite can no longer drag the question's own best answer down
 * with it.
 *
 * Measured over all 73 retrieval cases, not the one case that motivated it
 * (#296 requirement 2): 68/73 concatenated → **70/73 fused by max**, two
 * cases gained, none lost, and both remaining blocking misses recovered.
 * eval/README.md carries the variant table — RRF over the two orders, their
 * mean, and a question-weighted blend were all measured too, and each of them
 * lost a case that concatenation held.
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

/**
 * At most this many chunks of one document in the answer set, while chunks
 * of other documents remain to fill it (#303). `Infinity` is "no cap", and
 * it is the default because the cap was measured and did not earn one.
 *
 * The hypothesis it was built for: the reranker scores each chunk against
 * the query on its own, so a document with many title-similar chunks — an
 * FAQ page above all — could take five of the eight places with its most
 * question-*like* entries while the entry that answers the required step
 * ranked 9th to 15th. The six-case read (#289) had found "the right
 * document, the wrong chunk" in five of five Tier 1 adequacy failures.
 *
 * What the full reranked orders then showed (#303, eval/README.md): in three
 * of those five the needed chunk was **not in the pool of 40 at all**, in one
 * it sat at #9 with nothing over the cap above it, and in the last the cap
 * pushed the needed artículo *down* — it was its document's fourth chunk. On
 * the six cases the cap moved hit-rate 6/6 → 6/6 and adequacy 1/6 → 1/6; on
 * the same six `ANSWER_TOP_K=10` moved adequacy to 2/6. So the mechanism
 * stays, pinned and switchable by `ANSWER_DOC_CAP`, for the authorized full
 * run to measure beside the top-k; the default is the pipeline of record.
 */
export const ANSWER_DOC_CAP = Infinity;

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
   * It becomes a **second rerank query** scored beside the question, not text
   * appended to it (#296).
   *
   * The reranker reads the same question the fused legs read, so it has the
   * same register problem, and #286 found it the hard way: putting
   * `ho-desde-cuanta-plata-caja`'s target at pool rank 5 instead of 24 did
   * not make it a hit, because the reranker still scored «desde cuánta plata
   * al mes lo obligan a uno a pagar Caja» against artículos that say «base
   * mínima contributiva». Letting the reranker read the expansion too
   * recovers that case and two more that were already being cut.
   *
   * Both readings, never the expansion alone by choice — only when the
   * question's own call failed, which the degradation path below prefers to
   * losing the rerank entirely. The rewrite is a probe, the
   * question is what the reader actually asked, and scoring only the rewrite
   * costs a case (`ho-donde-me-afilio-caja`) that the question's own words
   * carry. Two separate calls rather than one concatenated query, because a
   * concatenation is a single reading and a rewrite that drifts into another
   * country's law takes the reader's own question down with it — see the
   * module header and #296.
   */
  expansion?: string | null;
}

/**
 * The rerank queries, in the order their scores are fused: always the
 * question, then its expansion when retrieval produced one.
 */
export function rerankQueries(
  question: string,
  expansion?: string | null,
): string[] {
  return expansion ? [question, expansion] : [question];
}

/**
 * One Voyage query's verdict on the pool: its scored pool indices, in the
 * order Voyage returned them (best first).
 */
export type QueryVerdict = readonly { index: number; score: number }[];

/**
 * Pool indices, best first, scored by the highest relevance any query gave
 * them (#296).
 *
 * Ties break on the **first reading that came back** — `verdicts[0]`, the
 * question's, whenever its own call succeeded: first by the place Voyage gave
 * the chunk in that reading (Voyage's own order carries more than the rounded
 * score does, and a chunk it never returned there sorts last), and then by
 * pool position, so the result is fully determined the way `fuseRrf`'s
 * explicit sort is. A chunk the expansion merely matched as well therefore
 * never outranks one the reader's own words ranked higher.
 *
 * "First that came back", not "verdicts[0]", is the load-bearing wording: when
 * the question's call fails and only the expansion's survives, the surviving
 * reading's own Voyage order is what the caller is told it gets, so reading a
 * `null` slot here would silently downgrade that to pool order.
 *
 * A chunk missing from a reading simply did not come back from it. That is
 * not evidence against the chunk: it scores nothing there and keeps whatever
 * the other reading gave it.
 */
export function fuseByMaxScore(
  verdicts: readonly (QueryVerdict | null)[],
): { index: number; score: number }[] {
  const best = new Map<number, number>();
  for (const verdict of verdicts) {
    for (const { index, score } of verdict ?? []) {
      best.set(index, Math.max(best.get(index) ?? -Infinity, score));
    }
  }
  const rank = new Map<number, number>();
  (verdicts.find((verdict) => verdict !== null) ?? []).forEach(
    ({ index }, position) => {
      rank.set(index, position);
    },
  );
  const asked = (index: number) => rank.get(index) ?? Infinity;
  return [...best]
    .map(([index, score]) => ({ index, score }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        asked(a.index) - asked(b.index) ||
        a.index - b.index,
    );
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

/**
 * How many chunks of one document may reach the answer prompt. `ANSWER_DOC_CAP`
 * in the environment sets a cap for a measured run; `off`, unset and empty
 * all mean the default (no cap), and anything else that is not a positive
 * integer is ignored rather than trusted.
 */
export function answerDocCap(): number {
  const raw = process.env.ANSWER_DOC_CAP;
  if (!raw) return ANSWER_DOC_CAP;
  if (raw === "off") return Infinity;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return ANSWER_DOC_CAP;
  return parsed;
}

/**
 * The first `topK` of `order` with no more than `cap` chunks per document,
 * while other documents can still fill the set (#303).
 *
 * One pass in rank order: a chunk is taken while its document is under the
 * cap and deferred otherwise. Places the pass leaves open are then filled
 * from the deferred chunks, again in rank order — so one long artículo split
 * in parts, alone in the pool, still fills the set, and the cap is a
 * preference for breadth rather than a hole in the answer set. Survivors
 * keep their reranked order among themselves: the cap drops, it never
 * reorders.
 */
export function capPerDocument<T extends { chunk: RetrievedChunk }>(
  order: readonly T[],
  topK: number,
  cap: number,
): T[] {
  const taken: T[] = [];
  const deferred: T[] = [];
  const perDoc = new Map<string, number>();
  for (const entry of order) {
    if (taken.length >= topK) break;
    const seen = perDoc.get(entry.chunk.docKey) ?? 0;
    if (seen < cap) {
      perDoc.set(entry.chunk.docKey, seen + 1);
      taken.push(entry);
    } else {
      deferred.push(entry);
    }
  }
  return taken.concat(deferred.slice(0, topK - taken.length));
}

/** The model Voyage is asked for; empty or unset means the model of record. */
function rerankModel(): string {
  return process.env.RERANK_MODEL || RERANK_MODEL;
}

/**
 * One Voyage rerank call, as a map of pool index → relevance score, or `null`
 * when it did not produce one. Never throws: a rejected call is one reading
 * lost, not a failed ask.
 */
async function scorePool(
  query: string,
  chunks: readonly RetrievedChunk[],
  key: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<QueryVerdict | null> {
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
      signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as VoyageRerankResponse;
    // The response is typed, not trusted. `chunks[index]` alone is not enough
    // of a check: `chunks["0"]` is defined too, and a string index is a
    // *different* Map key from the number in `fuseByMaxScore` — one response
    // carrying both would enter the same chunk twice and push a real
    // candidate out of the answer set. A non-finite score would poison the
    // sort the same way, so both are checked before a verdict exists.
    const verdict = json.data.flatMap(({ index, relevance_score }) =>
      Number.isInteger(index) &&
      index >= 0 &&
      index < chunks.length &&
      Number.isFinite(relevance_score)
        ? [{ index, score: relevance_score }]
        : [],
    );
    return verdict.length > 0 ? verdict : null;
  } catch {
    return null;
  }
}

/**
 * The whole pool in Voyage's order, or `null` when the rerank did not happen —
 * opted out, unkeyed, or failed. `null` is not an error: every caller falls
 * back to the fused order, which is the policy this module exists to keep.
 *
 * With an expansion this makes two calls, in parallel under the one timeout,
 * and fuses them by the higher score (#296). The degradation is the same
 * policy one call down: both readings back → fused; one back → that reading
 * alone, which is still better than the fused order; neither → `null`.
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
  // One deadline for both calls: they run concurrently, so the reader waits
  // for the slower one and not for the sum.
  const signal = AbortSignal.timeout(RERANK_TIMEOUT_MS);
  const scored = await Promise.all(
    rerankQueries(question, options.expansion).map((query) =>
      scorePool(query, chunks, key, fetchImpl, signal),
    ),
  );
  if (scored.every((scores) => scores === null)) return null;
  // Passed with the question's slot intact, `null` and all: `fuseByMaxScore`
  // reads position 0 as the question's for its tiebreak, and a call that did
  // not come back must not silently promote the expansion into that slot.
  const order = fuseByMaxScore(scored).flatMap(({ index, score }, position) => {
    const chunk = chunks[index];
    return chunk === undefined ? [] : [{ chunk, score, rank: position + 1 }];
  });
  return order.length > 0 ? order : null;
}

/**
 * The answer set: the reranked order cut to the answer top-k under the
 * per-document cap, or the fused order cut the same way when there is no
 * reranked order. The one place the cut is made, so the eval harness and the
 * route agree by construction — and the cap applies to whichever order is
 * being cut, since the fused head has the same FAQ-page shape (#303).
 */
export function answerSetFromOrder(
  order: readonly RerankedChunk[] | null,
  fused: readonly RetrievedChunk[],
): RetrievedChunk[] {
  const topK = answerTopK();
  const cap = answerDocCap();
  const ranked = order ?? fused.map((chunk) => ({ chunk }));
  return capPerDocument(ranked, topK, cap).map(({ chunk }) => chunk);
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
