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
 * - every gate in the groundedness, hit-rate (#303) and abstention lanes
 *   **fails** while a subset is selected, naming it (the #129 rule: a required check that silently
 *   asserts nothing is the failure mode the gate exists to prevent);
 * - the transcript filename carries `subset`, so the file a later comparison
 *   picks up cannot be mistaken for a full run's.
 *
 * And a scoped run must never quietly become a full one (#536): every eval
 * lane is built through `scopedLane` (`./scoped-lane`), which reads
 * `laneScope` below and skips a lane none of whose cases were named. The
 * fixture lanes hold no dataset case, so a scoped run skips them whole.
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
 * The cases the run should cover, in dataset order. `cases` is the
 * population being scoped; `dataset` is every id that may legitimately be
 * named, and defaults to `cases`. A lane passes the whole dataset there, so an
 * id another lane runs is left to that lane rather than thrown on (#536).
 *
 * An id `dataset` does not carry throws, and the message names it: a typo that
 * silently selected zero cases would produce a run that measured nothing,
 * printed an empty table, and cost the money anyway. Duplicates are collapsed
 * rather than rejected — asking for the same case twice is a shell-loop
 * artefact, not a mistake worth failing a paid run over.
 */
export function selectCases(
  cases: readonly EvalCase[],
  ids: readonly string[] | null,
  dataset: readonly EvalCase[] = cases,
): EvalCase[] {
  if (ids === null) return [...cases];
  const unknown = unknownIds(
    dataset.map((evalCase) => evalCase.id),
    ids,
  );
  if (unknown.length > 0) {
    throw new Error(
      `${SUBSET_ENV}: no case ${dataset === cases ? "this run covers" : "in the dataset"} ` +
        `has id ${unknown.join(", ")} — a typo`,
    );
  }
  const wanted = new Set(ids);
  return cases.filter((evalCase) => wanted.has(evalCase.id));
}

/** The named ids no case in `known` carries, deduplicated, in named order. */
function unknownIds(
  known: readonly string[],
  ids: readonly string[],
): string[] {
  const carried = new Set(known);
  return [...new Set(ids)].filter((id) => !carried.has(id));
}

/**
 * What `EVAL_CASES` does to one lane (#536), decided before the lane's suite
 * is declared, so no lane can spend while scoped unless it was named:
 *
 * - `full`: the variable is unset; the lane runs every case and its gates.
 * - `scoped`: some of the lane's cases are named; it runs those and its gates
 *   fail, naming the scope.
 * - `skip`: none of the lane's cases are named — another lane's ids, or a
 *   fixture lane, which holds no dataset case at all. Nothing runs.
 * - `unknown`: an id no dataset case carries. Every lane fails before a paid
 *   call, naming it, rather than any lane running on the rest.
 */
export type LaneScope =
  | { mode: "full" }
  | { mode: "scoped"; ids: string[] }
  | { mode: "skip"; ids: string[] }
  | { mode: "unknown"; ids: string[] };

export function laneScope(
  laneIds: readonly string[],
  datasetIds: readonly string[],
  ids: readonly string[] | null,
): LaneScope {
  if (ids === null) return { mode: "full" };
  const unknown = unknownIds(datasetIds, ids);
  if (unknown.length > 0) return { mode: "unknown", ids: unknown };
  const lane = new Set(laneIds);
  const selected = [...new Set(ids)].filter((id) => lane.has(id));
  return selected.length === 0
    ? { mode: "skip", ids: [...new Set(ids)] }
    : { mode: "scoped", ids: selected };
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
