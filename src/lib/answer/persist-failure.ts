/**
 * The history-save failure counter (issue #139, req. 2).
 *
 * A signed-in ask can deliver a perfectly good answer and still fail to write
 * its row — a dead service client, a rejected insert, a socket that drops
 * between the last byte and the commit. `persist.ts` has always logged that,
 * but a log line nobody counts is not a signal: the failure is invisible until
 * a user notices an answer missing from their history and tells us.
 *
 * Shape follows the two counters already here — `answer/invariant.ts` (#131)
 * and `retrieval-degraded.ts` (#127) — for the same reason they share it:
 * there is no metrics pipeline in this codebase yet (#141 owns that), so the
 * event is recorded in the two forms something downstream can consume today.
 * An in-process tally the tests read, and a `console.warn` on a stable prefix
 * a platform log drain can count. In-process means per serverless instance and
 * lost on recycle; the log line, not this tally, is the durable signal.
 */

/**
 * Which delivered answer failed to save. Both are answers the reader has on
 * screen and expects in their history, so both are surfaced identically — but
 * they are worth splitting, since a decline is a canned string we could
 * always reconstruct while a real answer is paid tokens we cannot.
 */
export type SavedAnswerKind = "answer" | "decline";

export type HistorySaveFailureCounts = Record<SavedAnswerKind, number>;

const counts: HistorySaveFailureCounts = { answer: 0, decline: 0 };

/** Snapshot of the tally. A copy — callers cannot write through it. */
export function historySaveFailures(): HistorySaveFailureCounts {
  return { ...counts };
}

/** Test-only: puts the tally back to zero between cases. */
export function resetHistorySaveFailures(): void {
  counts.answer = 0;
  counts.decline = 0;
}

export interface HistorySaveFailure {
  kind: SavedAnswerKind;
  /**
   * What the save call rejected with, when it rejected. Absent when the
   * insert reported the failure itself — `saveQuestion` has already logged
   * that message, so repeating it here would say the same thing twice.
   */
  error?: unknown;
}

/**
 * Records one lost exchange. The prefix is load-bearing: it is what a
 * log-based counter will match on, so it is a constant string with the
 * variables tacked on as `key=value`, not an interpolated sentence.
 */
export function recordHistorySaveFailure({
  kind,
  error,
}: HistorySaveFailure): void {
  counts[kind] += 1;
  console.warn(
    `ask: history save failed — kind=${kind} ` +
      `error=${error === undefined ? "insert" : String(error)}`,
  );
}
