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
import { isDerivedFigureInput } from "./derived";

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

/**
 * How the step catalogue's sentences (#304) reach the answer set, once the
 * reranker has scored the pool against each of them:
 *
 * - `off` — the sentences are not scored; the catalogue only fills the pool,
 *   and the reranker decides from the question's readings what reaches the
 *   model. **The default**, by the authorized full run (eval/README.md):
 *   `pin` took adequacy 15/40 → 18/40 and cost groundedness 71/73 → 67/73,
 *   under the 0.94 gate — four unanimous failures, mostly the answer citing
 *   the wrong fragment once ten or eleven overlapping fragments (`cnpt` 78,
 *   79 and 81 side by side) were in front of it. A step in the prompt at the
 *   price of the release gate does not ship.
 * - `pin` — the question's readings decide the order and the cut exactly as
 *   before, and the best chunk of each sentence's reading is then **appended
 *   past the cut** when it is not already in the set, the way #287 pins a
 *   derived figure's missing input. Nothing the reranker chose for the
 *   question is displaced; the prompt grows by at most one chunk per
 *   sentence, only on an ask that classified to a family.
 * - `pin1` — `pin`'s picks, but only **one** of them reaches the prompt: the
 *   highest-scoring pick the cut did not already take (#311). `pin`'s cost
 *   was the answer set's size — ten or eleven overlapping fragments, and the
 *   model mis-indexing them — so this is its smallest version: +1 fragment,
 *   on an ask that classifies. A sentence whose best chunk is already in the
 *   cut is covered, so the one append goes to a step the cut left out.
 *   Measured beside `off` on 2026-09-24 (eval/README.md, #311): groundedness
 *   64/73 → 67/73, adequacy 16/40 → 18/40, and no new failure cites the
 *   appended fragment. Still under the 0.94 gate, as `off` is, so it stayed
 *   off by #311's rule until the baseline was back over the gate.
 *   **The default since 2026-09-25** (owner decision, #287): on a
 *   same-evening pair on current code `pin1` and `off` tie on groundedness
 *   (68/73 each, neither over 0.94), and `pin1` states 83/116 Tier 1
 *   requirements against 71/116, 11/27 Tier 1 cases against 4/27, with the
 *   citation invariant and the blocking hit-rate green where `off` has them
 *   red (eval/README.md, «`pin1` becomes the default»).
 * - `slot` — `pin`'s picks, taking the **last places of the cut** instead of
 *   growing it (#287): the best `STEP_SLOTS` picks the cut did not take
 *   displace its lowest-ranked chunks, so the prompt stays at the answer
 *   top-k. `pin` and `pin1` both grow the prompt, and a larger, overlapping
 *   answer set is what `pin` paid for in groundedness; the cut's tail, on the
 *   2026-09-24 transcript, is mostly filler (`reglamento-iva` 60 in four
 *   unrelated answer sets, preámbulos, «¿Horario de Atención?»). A derived
 *   figure's input is never displaced (`isDerivedFigureInput`): a figure is
 *   arithmetic over every input, and the #403 slot loss is exactly that.
 *   The risk is the question's own target at #7/#8, which the hit-rate lane
 *   reads on the same run.
 * - `max` — the sentences are readings like the expansion's, fused by the
 *   higher score (#296). Measured first, and what it does is in
 *   eval/README.md: the step chunks reach #1–#2, and the question's own
 *   chunks move down to make room — the F case's escala chunks from
 *   reranked #3/#4 to #8/#9, the H case's reglamento-renta 27 from #7 to
 *   #21. A required step in front of the model at the price of the claim
 *   the question was about is not a trade the adequacy gate can take.
 *
 * `STEPS_RERANK` in the environment overrides the constant for a measured run.
 */
export type StepRerankMode = "pin" | "pin1" | "slot" | "max" | "off";

export const STEP_RERANK_MODE: StepRerankMode = "pin1";

/** Places of the cut `STEPS_RERANK=slot` gives to step picks (#287). */
export const STEP_SLOTS = 2;

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
  /**
   * The step catalogue's sentences retrieval ran on (#304), when it ran a
   * probe. Each becomes one more rerank query fused by max, for the reason
   * the legs search them one by one: the reranker reads «¿dónde me afilio?»
   * and cannot see that «cuándo se paga» is part of a complete answer, so
   * the step chunk the catalogue carried into the pool would be scored
   * against the question alone and cut. Scored against its own sentence, it
   * keeps the relevance that sentence gives it — and, by the same bound as
   * the expansion, never loses any the question gave it.
   */
  steps?: readonly string[] | null;
}

/**
 * The rerank queries, in the order their scores are fused: always the
 * question, then its expansion when retrieval produced one, then the step
 * catalogue's sentences when it ran a probe (#304).
 */
export function rerankQueries(
  question: string,
  expansion?: string | null,
  steps?: readonly string[] | null,
): string[] {
  return [question, ...(expansion ? [expansion] : []), ...(steps ?? [])];
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

/** The step-rerank mode in force; anything unrecognised is the constant. */
export function stepRerankMode(): StepRerankMode {
  const raw = process.env.STEPS_RERANK;
  return raw === "pin" ||
    raw === "pin1" ||
    raw === "slot" ||
    raw === "max" ||
    raw === "off"
    ? raw
    : STEP_RERANK_MODE;
}

/** Whether the mode in force pins step picks past the cut at all. */
function pinsSteps(mode: StepRerankMode): boolean {
  return mode === "pin" || mode === "pin1" || mode === "slot";
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

/** What the reranker decided: the order to cut, and what to pin past it. */
export interface RerankOutcome {
  /**
   * The whole pool in Voyage's order — the question's readings fused by the
   * higher score, and the step sentences' too under `STEPS_RERANK=max`.
   */
  order: RerankedChunk[];
  /**
   * Under `pin`, `pin1` and `slot` (#304, #311, #287): the best chunk of each sentence's
   * reading, in sentence order and without repeats, carrying that reading's
   * score and the rank `order` gave it. Empty in the other modes and with no
   * probe. How many of them reach the prompt is `answerSetFromOrder`'s call,
   * because only the cut knows which are already in.
   */
  stepPicks: RerankedChunk[];
}

/**
 * The whole pool in Voyage's order, or `null` when the rerank did not happen —
 * opted out, unkeyed, or failed. `null` is not an error: every caller falls
 * back to the fused order, which is the policy this module exists to keep.
 *
 * With an expansion this makes two calls, in parallel under the one timeout,
 * and fuses them by the higher score (#296); a step probe adds one call per
 * sentence to the same batch (#304), read as `stepRerankMode` says. The
 * degradation is the same policy one call down: every reading back → fused;
 * some back → those alone, which is still better than the fused order;
 * none → `null`. Under `pin`/`pin1`/`slot`, a batch where only sentence readings came
 * back falls back to fusing those — one reading of the pool is still better
 * than none, and the picks are then empty because there is no question
 * order to pin them past.
 */
export async function rerankReadings(
  question: string,
  chunks: readonly RetrievedChunk[],
  options: RerankOptions = {},
): Promise<RerankOutcome | null> {
  // `||`, not `??`: CI interpolates an unset `vars.RERANK` as "", which must
  // mean "default on" — only an explicit RERANK=off opts out.
  if ((process.env.RERANK || "voyage") !== "voyage") return null;

  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;

  const mode = stepRerankMode();
  const sentences = mode === "off" ? [] : (options.steps ?? []);
  const fetchImpl = options.fetchImpl ?? fetch;
  // One deadline for every call: they run concurrently, so the reader waits
  // for the slowest one and not for the sum.
  const signal = AbortSignal.timeout(RERANK_TIMEOUT_MS);
  const scored = await Promise.all(
    rerankQueries(question, options.expansion, sentences).map((query) =>
      scorePool(query, chunks, key, fetchImpl, signal),
    ),
  );
  if (scored.every((scores) => scores === null)) return null;

  const questionReadings = scored.slice(0, scored.length - sentences.length);
  const stepReadings = scored.slice(scored.length - sentences.length);
  const pinning =
    pinsSteps(mode) && questionReadings.some((reading) => reading !== null);
  // Passed with the question's slot intact, `null` and all: `fuseByMaxScore`
  // reads position 0 as the question's for its tiebreak, and a call that did
  // not come back must not silently promote the expansion into that slot.
  const fused = fuseByMaxScore(pinning ? questionReadings : scored);
  const byIndex = new Map<number, RerankedChunk>();
  const order = fused.flatMap(({ index, score }, position) => {
    const chunk = chunks[index];
    if (chunk === undefined) return [];
    const entry = { chunk, score, rank: position + 1 };
    byIndex.set(index, entry);
    return [entry];
  });
  if (order.length === 0) return null;

  const stepPicks: RerankedChunk[] = [];
  if (pinning) {
    const picked = new Map<number, RerankedChunk>();
    for (const reading of stepReadings) {
      // Voyage returns best first, but the pick is by score, not position —
      // the verdict is typed, not trusted (`scorePool`).
      const best = (reading ?? []).reduce<{
        index: number;
        score: number;
      } | null>(
        (top, entry) => (top === null || entry.score > top.score ? entry : top),
        null,
      );
      if (best === null) continue;
      // Two sentences agreeing on a chunk pick it once, in the first one's
      // place and with the higher of their scores — `pin1` ranks the picks
      // by score, so the first sentence's must not stand in for both (#311).
      const already = picked.get(best.index);
      if (already !== undefined) {
        already.score = Math.max(already.score, best.score);
        continue;
      }
      const inOrder = byIndex.get(best.index);
      const chunk = chunks[best.index];
      const pick =
        inOrder !== undefined
          ? { ...inOrder, score: best.score }
          : chunk !== undefined
            ? { chunk, score: best.score, rank: order.length + 1 }
            : null;
      if (pick === null) continue;
      picked.set(best.index, pick);
      stepPicks.push(pick);
    }
  }
  return { order, stepPicks };
}

/** `rerankReadings`' order alone — the pre-#304 shape, kept for its callers. */
export async function rerankOrder(
  question: string,
  chunks: readonly RetrievedChunk[],
  options: RerankOptions = {},
): Promise<RerankedChunk[] | null> {
  return (await rerankReadings(question, chunks, options))?.order ?? null;
}

/**
 * The answer set: the reranked order cut to the answer top-k under the
 * per-document cap, or the fused order cut the same way when there is no
 * reranked order — then the step picks (#304) appended past the cut, each
 * once, when the cut did not already take them. The one place the cut is
 * made, so the eval harness and the route agree by construction — and the
 * cap applies to whichever order is being cut, since the fused head has the
 * same FAQ-page shape (#303). A pick is an append, like #287's derived
 * inputs: nothing the cut chose is displaced. Under `pin1` (#311) only one
 * pick is appended — the highest-scoring one the cut did not take; ties keep
 * sentence order. Under `slot` (#287) the picks take the cut's last places
 * instead (`slotSteps`), and the set keeps its size.
 */
export function answerSetFromOrder(
  order: readonly RerankedChunk[] | null,
  fused: readonly RetrievedChunk[],
  stepPicks: readonly RerankedChunk[] = [],
): RetrievedChunk[] {
  const topK = answerTopK();
  const cap = answerDocCap();
  const ranked = order ?? fused.map((chunk) => ({ chunk }));
  const cut = capPerDocument(ranked, topK, cap).map(({ chunk }) => chunk);
  const taken = new Set(cut.map((chunk) => chunk.chunkId));
  const fresh = stepPicks.filter(({ chunk }) => !taken.has(chunk.chunkId));
  if (stepRerankMode() === "slot") return slotSteps(cut, fresh);
  const appended =
    stepRerankMode() === "pin1"
      ? [...fresh].sort((a, b) => b.score - a.score).slice(0, 1)
      : fresh;
  for (const { chunk } of appended) {
    // A caller's picks may repeat a chunk; it still goes in once.
    if (taken.has(chunk.chunkId)) continue;
    taken.add(chunk.chunkId);
    cut.push(chunk);
  }
  return cut;
}

/**
 * `STEPS_RERANK=slot` (#287): the best `STEP_SLOTS` fresh picks, by score
 * with ties in sentence order, each displacing the lowest-ranked chunk of the
 * cut that is neither a derived figure's input nor an earlier pick. No such
 * chunk left → the pick is dropped, never appended: the set does not grow.
 */
function slotSteps(
  cut: RetrievedChunk[],
  fresh: readonly RerankedChunk[],
): RetrievedChunk[] {
  const set = [...cut];
  const placed = new Set<string>();
  const picks = [...fresh].sort((a, b) => b.score - a.score);
  for (const { chunk } of picks) {
    if (placed.size === STEP_SLOTS) break;
    // A caller's picks may repeat a chunk; it still goes in once.
    if (placed.has(chunk.chunkId)) continue;
    let victim = -1;
    for (let i = set.length - 1; i >= 0; i--) {
      const held = set[i];
      if (placed.has(held.chunkId) || isDerivedFigureInput(held)) continue;
      victim = i;
      break;
    }
    if (victim === -1) break;
    set.splice(victim, 1);
    set.push(chunk);
    placed.add(chunk.chunkId);
  }
  return set;
}

export async function rerankChunks(
  question: string,
  chunks: readonly RetrievedChunk[],
  options: RerankOptions = {},
): Promise<RetrievedChunk[]> {
  const outcome = await rerankReadings(question, chunks, options);
  return answerSetFromOrder(
    outcome?.order ?? null,
    chunks,
    outcome?.stepPicks ?? [],
  );
}
