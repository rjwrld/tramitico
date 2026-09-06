/**
 * `EVAL_CASES` — the cheap read (#289).
 *
 * The classification #289 asks for needs the answers, and the answers cost a
 * full run: ~30 minutes and ~US$10 of Anthropic and Voyage for 73 cases, of
 * which a given question usually concerns four. The 2026 baseline was
 * classified from the printed table alone and got it wrong, for a reason the
 * table cannot show — `caseHit` is true when *any one* expected target
 * matches, and the missing requirement usually lives in a different chunk of
 * the same document, so "retrieval hit" was read as "the fragment was in front
 * of the model" when it was not. The correction came from a four-case run that
 * cost cents, whose script was never committed and is gone.
 *
 * So the subset is a first-class, committed input: name the ids, get the same
 * production answer path and the same transcript over just those cases.
 *
 * What it must never become is a cheap way to a green gate. A run over four
 * cases cannot say anything about a rate over 73, and "tier 1 is 27/27" read
 * off six of them is worse than no number. Two things enforce that, and both
 * are loud rather than silent:
 *
 * - every gate in `groundedness.eval.test.ts` **fails** while a subset is
 *   selected, naming it (the #129 rule: a required check that silently
 *   asserts nothing is the failure mode the gate exists to prevent);
 * - the transcript filename carries `subset`, so the file a later comparison
 *   picks up cannot be mistaken for a full run's.
 */
import type { EvalCase } from "./dataset";

/** The env var that selects a subset: comma-separated case ids. */
export const SUBSET_ENV = "EVAL_CASES";

/**
 * The selected ids, or `null` for "the whole dataset". Blank and
 * whitespace-only are `null` too: an unset variable and one exported empty by
 * a shell script mean the same thing to the reader.
 */
export function subsetSpec(
  env: Record<string, string | undefined> = process.env,
): string[] | null {
  const raw = env[SUBSET_ENV];
  if (raw === undefined) return null;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  return ids.length === 0 ? null : ids;
}

/**
 * The cases the run should cover, in dataset order.
 *
 * An id that matches nothing throws, and the message names it: a typo that
 * silently selected zero cases would produce a run that measured nothing,
 * printed an empty table, and cost the money anyway. Duplicates are collapsed
 * rather than rejected — asking for the same case twice is a shell-loop
 * artefact, not a mistake worth failing a paid run over.
 */
export function selectCases(
  cases: readonly EvalCase[],
  ids: readonly string[] | null,
): EvalCase[] {
  if (ids === null) return [...cases];
  const wanted = new Set(ids);
  const selected = cases.filter((evalCase) => wanted.has(evalCase.id));
  const found = new Set(selected.map((evalCase) => evalCase.id));
  const unknown = [...wanted].filter((id) => !found.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `${SUBSET_ENV}: no case in eval/dataset.jsonl has id ${unknown.join(", ")}`,
    );
  }
  return selected;
}

/**
 * What a gate says instead of asserting, while a subset is selected. It names
 * the ids so the failure reads as "this run was scoped", not "the gate broke".
 */
export function subsetGateFailure(ids: readonly string[]): string {
  return (
    `${SUBSET_ENV} selected ${ids.length} case(s) — ${ids.join(", ")}. ` +
    "The gates measure the whole dataset and cannot be read from a subset; " +
    "this run is a transcript read, not a measurement. Unset " +
    `${SUBSET_ENV} to run the gates.`
  );
}
