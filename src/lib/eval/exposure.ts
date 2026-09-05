/**
 * Exposure groups for eval reporting (#267, #261 part B).
 *
 * A flag cannot undo exposure. Seven held-out cases were in the retrieval
 * suite before the set existed, so a single held-out number would claim more
 * than it measured. Every eval lane therefore tallies its verdicts three ways:
 *
 *   first-exposure   held out and written for the set (`seed` = held-out:*)
 *   promoted         held out, but a member by promotion — measured before
 *   corpus-derived   not held out: the retrieval regression suite
 *
 * `held-out.test.ts` pins which cases fall in the middle group; this module
 * only reads the seed, so the two cannot disagree without that test going red.
 */
import type { EvalCase } from "./dataset";

export const EXPOSURE_GROUPS = [
  "first-exposure",
  "promoted",
  "corpus-derived",
] as const;
export type ExposureGroup = (typeof EXPOSURE_GROUPS)[number];

export function exposureOf(evalCase: EvalCase): ExposureGroup {
  if (!evalCase.heldOut) return "corpus-derived";
  return evalCase.seed.startsWith("held-out:") ? "first-exposure" : "promoted";
}

export interface ExposureTally {
  group: ExposureGroup;
  passed: number;
  total: number;
}

/** One row per group, in EXPOSURE_GROUPS order; empty groups included. */
export function tallyByExposure<T>(
  results: readonly T[],
  caseOf: (result: T) => EvalCase,
  passed: (result: T) => boolean,
): ExposureTally[] {
  return EXPOSURE_GROUPS.map((group) => {
    const members = results.filter((r) => exposureOf(caseOf(r)) === group);
    return {
      group,
      passed: members.filter(passed).length,
      total: members.length,
    };
  });
}

/** The tally block the per-case tables print under their headline number. */
export function formatExposureTally(
  label: string,
  tallies: readonly ExposureTally[],
): string {
  const rows = tallies.map(
    (t) => `  ${t.group.padEnd(15)} ${t.passed}/${t.total}`,
  );
  return [`${label} by exposure (#267):`, ...rows].join("\n");
}
