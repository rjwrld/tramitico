/**
 * `EVAL_CASES` reaches every eval lane (#536).
 *
 * Before this, three lanes read the variable and the rest ignored it, so
 * `EVAL_CASES=… pnpm test:eval` scoped three lanes and still ran the
 * conflicting-sources, amending-law and adequacy cases, the census and the
 * retrieval suite in full, and paid for them. #508 paid ≈US$1 that way for a
 * «scoped» abstention run.
 *
 * Of the two remedies #536 offered — every lane honours the variable, or
 * `pnpm test:eval` refuses it unless one lane file is named — this is the
 * first. A refusal in the package script would not reach
 * `pnpm vitest run --project eval`, which is how the smoke recipe runs; a
 * decision taken where each lane declares its suite reaches every way in.
 *
 * Every `*.eval.test.ts` builds its `describe` as
 * `scopedLane(integrationSuite(…), laneCases)`, or `fixtureLane(…)` for a lane
 * that holds no dataset case, and `scoped-lane.test.ts` fails a lane file that
 * does not. A lane none of whose cases are named is declared with
 * `describe.skip`: its body still runs to collect test names, which #211
 * already keeps free of paid calls, but no hook or test of it does.
 */
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { DATASET_PATH, parseDataset, type EvalCase } from "./dataset";
import { laneScope, SUBSET_ENV, subsetSpec } from "./subset";

/** The shape `integrationSuite` returns, and this module returns in turn. */
export type Suite = (name: string, fn: () => void) => void;

let datasetIds: string[] | null = null;

/** Every id `EVAL_CASES` may name, read once per test file. */
function allDatasetIds(): string[] {
  datasetIds ??= parseDataset(readFileSync(DATASET_PATH, "utf8")).map(
    (evalCase) => evalCase.id,
  );
  return datasetIds;
}

/**
 * Wraps a lane's gate so `EVAL_CASES` decides first (`laneScope`):
 *
 * - unset, or naming some of `laneCases`: the gate decides, as before;
 * - naming none of them: the suite is skipped, its name saying why;
 * - naming an id no case carries: the suite becomes one failing test that
 *   names it, whatever the environment, so a typo spends nothing anywhere.
 */
export function scopedLane(
  gate: Suite,
  laneCases: readonly EvalCase[],
  env: Record<string, string | undefined> = process.env,
): Suite {
  const ids = subsetSpec(env);
  const scope = laneScope(
    laneCases.map((evalCase) => evalCase.id),
    ids === null ? [] : allDatasetIds(),
    ids,
  );
  return (name, fn) => {
    if (scope.mode === "full" || scope.mode === "scoped") return gate(name, fn);
    if (scope.mode === "skip") {
      return void describe.skip(
        `${name} — ${SUBSET_ENV} names none of this lane's cases`,
        fn,
      );
    }
    describe(name, () => {
      it(`${SUBSET_ENV} names only dataset cases`, () => {
        throw new Error(
          `${SUBSET_ENV}: no case in the dataset has id ` +
            `${scope.ids.join(", ")} — a typo. No lane runs while one is ` +
            "named, so nothing was paid for.",
        );
      });
    });
  };
}

/**
 * A lane over hand-written fixtures, or over the corpus as a whole, holds no
 * dataset case: any `EVAL_CASES` skips it.
 */
export function fixtureLane(
  gate: Suite,
  env: Record<string, string | undefined> = process.env,
): Suite {
  return scopedLane(gate, [], env);
}
