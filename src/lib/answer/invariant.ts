/**
 * The runtime citation invariant (issue #131, decision on #121).
 *
 * Citations used to be prompt-led and nothing more: `ANSWER_SYSTEM_PROMPT`
 * rule 2 asks for a [n] after every claim, and whether the model obliged was
 * discovered — if at all — at eval time. So an answer could ship citing
 * nothing, or citing a [9] that no retrieved document backs, and the render
 * path would quietly tidy the evidence away: `renumberCitationMarkers` deletes
 * a marker no seal backs, which turns a hallucinated source into a bare
 * uncited claim rather than a visible defect.
 *
 * This module is the base check that makes the contract real at runtime:
 * presence and resolvability of markers. Per-claim support normally stays an
 * eval-time concern (`src/lib/eval/`) because it needs a judge model. The one
 * deterministic exception is a derived figure: answer assembly knows its
 * exact input markers and separately refuses to publish the quoted result when
 * one is absent.
 */
import { citationMarkers, unclosedMarkers } from "./citations";

/**
 * Why an answer fails the invariant.
 *
 * - `no_markers` — nothing a reader can follow to a source. Includes the
 *   answer whose only markers are all dangling: it cites nothing *real*.
 * - `unresolved_markers` — at least one usable citation, but also a marker
 *   pointing outside the retrieval set, or one the model never closed
 *   («[49 tomando…», #352): neither renders as a seal a reader can follow.
 * - `incomplete_derived_markers` — a system-calculated figure was quoted
 *   without every marker for the inputs used to calculate it.
 */
export type CitationViolation =
  "no_markers" | "unresolved_markers" | "incomplete_derived_markers";

export type CitationVerdict =
  | { ok: true }
  | { ok: false; violation: CitationViolation; unresolved: number[] };

/**
 * Whether `answer` may be shown: at least one marker resolving to a source in
 * the retrieval set, and no marker that does not.
 *
 * `sourceCount` is the length of the chunk list the prompt numbered, so a
 * marker resolves exactly when it falls in `[1, sourceCount]` — `formatChunks`
 * numbers from 1, which is why `[0]` is as dangling as `[99]`.
 *
 * `unresolved` lists the offending markers deduped in order of first
 * appearance, for the log line; it is populated on either violation, since an
 * answer whose markers are *all* dangling is reported as `no_markers` but the
 * markers are still what went wrong.
 */
export function validateCitations(
  answer: string,
  sourceCount: number,
): CitationVerdict {
  const markers = citationMarkers(answer);
  const unresolved: number[] = [];
  let resolved = 0;
  for (const marker of markers) {
    if (marker >= 1 && marker <= sourceCount) {
      resolved += 1;
    } else if (!unresolved.includes(marker)) {
      unresolved.push(marker);
    }
  }
  for (const marker of unclosedMarkers(answer)) {
    if (!unresolved.includes(marker)) unresolved.push(marker);
  }
  if (resolved === 0) return { ok: false, violation: "no_markers", unresolved };
  if (unresolved.length > 0) {
    return { ok: false, violation: "unresolved_markers", unresolved };
  }
  return { ok: true };
}

/**
 * The counter req. 3 asks for, and no more (#131). There is no metrics
 * pipeline in this codebase yet — the observability issue owns that — so a
 * failure is recorded twice, in the two forms something downstream can
 * actually consume today: an in-process tally the tests read, and a log line
 * on a stable prefix a platform log drain can count.
 *
 * In-process means per serverless instance and lost on recycle. That is
 * honest for what it is: the log line, not this tally, is the durable signal.
 */
export type CitationFailureCounts = Record<CitationViolation, number>;

const counts: CitationFailureCounts = {
  no_markers: 0,
  unresolved_markers: 0,
  incomplete_derived_markers: 0,
};

/** Snapshot of the tally. A copy — callers cannot write through it. */
export function citationFailures(): CitationFailureCounts {
  return { ...counts };
}

/** Test-only: puts the tally back to zero between cases. */
export function resetCitationFailures(): void {
  counts.no_markers = 0;
  counts.unresolved_markers = 0;
  counts.incomplete_derived_markers = 0;
}

export interface CitationFailure {
  violation: CitationViolation;
  /** 1 for the first generation, 2 for the retry — which one failed matters. */
  attempt: number;
  unresolved?: readonly number[];
}

/**
 * Records one violation. The prefix is load-bearing: it is what a log-based
 * counter will match on, so it is a constant string with the variables tacked
 * on as `key=value`, not an interpolated sentence.
 */
export function recordCitationFailure({
  violation,
  attempt,
  unresolved = [],
}: CitationFailure): void {
  counts[violation] += 1;
  console.warn(
    `ask: citation invariant violated — violation=${violation} ` +
      `attempt=${attempt} unresolved=${unresolved.join(",")}`,
  );
}
