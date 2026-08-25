/**
 * The degraded-retrieval counter (issue #127, req. 4).
 *
 * Retrieval degrades when the interactive query embed fails or times out
 * (`embedQuery`, ~5 s budget): the vector leg is skipped and `search_chunks`
 * runs lexical-only rather than the ask failing. That is a silent quality
 * drop on our side of the wire, so it has to be countable.
 *
 * Shape follows the citation invariant's counter (`answer/invariant.ts`) for
 * the same reason it does: there is no metrics pipeline in this codebase yet —
 * the observability issue owns that — so the event is recorded twice, in the
 * two forms something downstream can consume today. An in-process tally the
 * tests read, and a `console.warn` on a stable prefix a platform log drain can
 * count. In-process means per serverless instance and lost on recycle; the log
 * line, not this tally, is the durable signal.
 */

/**
 * Why the vector leg was dropped. `timeout` is the budget expiring — the
 * provider is slow or unreachable; `error` is everything else it can answer
 * with (a 429, a 5xx, a malformed body). Worth splitting: they call for
 * different fixes, and a shift from one to the other is the interesting event.
 */
export type DegradedReason = "timeout" | "error";

export type DegradedRetrievalCounts = Record<DegradedReason, number>;

const counts: DegradedRetrievalCounts = { timeout: 0, error: 0 };

/** Snapshot of the tally. A copy — callers cannot write through it. */
export function degradedRetrievals(): DegradedRetrievalCounts {
  return { ...counts };
}

/** Test-only: puts the tally back to zero between cases. */
export function resetDegradedRetrievals(): void {
  counts.timeout = 0;
  counts.error = 0;
}

/**
 * Classifies what `embedQuery` rejected with. `AbortSignal.timeout` aborts a
 * fetch with a `TimeoutError` DOMException; a caller-provided signal (or a
 * runtime that reports the abort generically) gives `AbortError`. Both mean
 * the budget is what stopped us, so both count as `timeout`.
 */
export function degradedReason(error: unknown): DegradedReason {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "error";
}

/**
 * Records one degraded ask. The prefix is load-bearing: it is what a log-based
 * counter will match on, so it is a constant string with the variables tacked
 * on as `key=value`, not an interpolated sentence.
 */
export function recordDegradedRetrieval(error: unknown): DegradedReason {
  const reason = degradedReason(error);
  counts[reason] += 1;
  console.warn(
    `retrieval: degraded to lexical-only — reason=${reason} ` +
      `error=${String(error)}`,
  );
  return reason;
}
