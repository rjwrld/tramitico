/**
 * The robustness block (#502): the dataset's seeds, re-asked in the words
 * production actually gets.
 *
 * The eval asked well-formed questions and production gets short ones: the
 * landing's seed pills show a short label and people retype it, a phone drops
 * the accents, a developer writes «client», and a conversation reaches a
 * third turn. Each robustness case (`variant: "robustez"`) re-asks one seed
 * case and carries that seed's `expected`, tier, family and requirements
 * verbatim (`robustness.test.ts` holds it to that), so whatever it misses, it
 * misses on the wording alone.
 *
 * **Beside the gates, never inside them.** Every gate a lane already asserts
 * reads the population it read before #502 (`splitRobustness`), so its
 * baseline — ADR 0023's Tier 1 count, the hit-rate floor, groundedness — stays
 * comparable with every run before the block existed. The block gets its own
 * line in each lane and its own gate.
 *
 * **The gate is a tracked baseline** (eval/README, «The robustness block»):
 * the count of block cases whose answer set holds one of the seed's targets
 * — the hit-rate lane's own metric — must not fall more than
 * `ROBUSTNESS_REGRESSION_MARGIN` below `ROBUSTNESS_HIT_BASELINE`. #511's full
 * lane set the baseline; with no baseline, the lane prints the line and the
 * gate shows as a todo rather than passing on nothing.
 */
import { isRobustness, robustnessSeedId, type EvalCase } from "./dataset";

/**
 * Block cases that hit, on the lane that sets it: 25 of 27 on #511's
 * baseline lane (eval/runs/2026-10-08-baseline/), missing
 * `rb-pill-retroactivo` and `rb-corto-cuanto-es-iva`. A lane that beats it
 * moves it up, as `HIT_RATE_GATE` ratchets: #512's two final lanes both hit
 * 27 of 27 (eval/runs/2026-10-08-final/).
 */
export const ROBUSTNESS_HIT_BASELINE: number | null = 27;

/**
 * How many hits a lane may lose to noise: two of 27. The two #502 probe
 * arms, one per rewrite model, scored the block 24 and 25, and #496's four
 * hit-rate lanes spread by two over the rest (69–71 of 73; eval/README,
 * «The robustness block»).
 */
export const ROBUSTNESS_REGRESSION_MARGIN = 2;

/** The fewest block hits a full lane may score, or `null` with no baseline. */
export function robustnessHitFloor(
  baseline: number | null = ROBUSTNESS_HIT_BASELINE,
): number | null {
  return baseline === null ? null : baseline - ROBUSTNESS_REGRESSION_MARGIN;
}

/**
 * The results every pre-#502 gate reads (`gated`), and the block's own
 * (`block`), each in input order.
 */
export function splitRobustness<T>(
  results: readonly T[],
  caseOf: (result: T) => EvalCase,
): { gated: T[]; block: T[] } {
  const gated: T[] = [];
  const block: T[] = [];
  for (const result of results) {
    (isRobustness(caseOf(result)) ? block : gated).push(result);
  }
  return { gated, block };
}

/**
 * The block's line under a lane's headline number: the count, then every
 * failing case beside the seed it re-asks, so a miss reads as «this wording
 * of that question». `detail` appends to a failing row what the lane knows
 * about it.
 */
export function formatRobustnessLine<T>(
  label: string,
  block: readonly T[],
  caseOf: (result: T) => EvalCase,
  passed: (result: T) => boolean,
  detail: (result: T) => string = () => "",
): string {
  const failed = block.filter((result) => !passed(result));
  return [
    `${label}, robustness block (#502): ${block.length - failed.length}/${block.length}`,
    ...failed.map((result) => {
      const evalCase = caseOf(result);
      const more = detail(result);
      return (
        `  MISS  ${evalCase.id} ← ${robustnessSeedId(evalCase)}  «${evalCase.question}»` +
        (more === "" ? "" : `  ${more}`)
      );
    }),
  ].join("\n");
}
