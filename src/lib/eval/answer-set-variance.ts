/**
 * Run-to-run variance of the answer set (#457): two runs of
 * `pnpm answer-set-probe` on one stack, compared case by case.
 *
 * Two identical full-lane arms of 2026-09-28 put the same chunk list in front
 * of the model on only 11 of 27 Tier 1 cases, which is why every full-lane
 * comparison in eval/README.md carries a ±4 caveat. This names *where* two
 * runs of one case parted. The pipeline is a chain — condense → expand →
 * fused pool → reranked order → answer set — and every stage downstream of
 * the first one that differs inherits the difference, so the first one is
 * the source.
 *
 * Pure and free: it reads two probe runs and calls nothing.
 */
import type { Variant } from "./dataset";

/** The probe configuration the route runs by default (rerank.ts, derived.ts). */
export const PRODUCTION_CONFIG = "top8/capoff/pinon";

/** One case as `answer-set-probe` writes it — only the fields read here. */
export interface ProbeRead {
  id: string;
  tier: unknown;
  /** The case's variant; absent before #502. */
  variant?: Variant | null;
  /** The standalone question the pipeline ran on; absent before #457. */
  query?: string;
  /** The expansion the legs ran on, null for none; absent before #457. */
  expansion?: string | null;
  /** The fused pool, best first; absent before #457. */
  pool?: string[];
  /** The whole reranked order, null when there was none; absent before #457. */
  order?: string[] | null;
  per: Record<string, { set: string[] }>;
}

/**
 * The first stage at which two runs of a case differ, in pipeline order;
 * `same` when they cut the same answer set. `cut` is the same reranked order
 * cut to a different set: under `pin1` the step catalogue's appended pick
 * (#311), which the order does not carry, since the step sentences' readings
 * are scored apart from the question's. `unknown` is a run that recorded
 * only its answer sets (every probe run before #457): they differ, and
 * nothing says where.
 */
export type Divergence =
  "same" | "query" | "expansion" | "pool" | "rerank" | "cut" | "unknown";

export interface CaseComparison {
  id: string;
  tier: unknown;
  variant: Variant | null;
  /** The answer set is the same list, in the same order. */
  sameList: boolean;
  /** The answer set holds the same chunks, in whatever order. */
  sameSet: boolean;
  divergence: Divergence;
}

function sameList(
  a: readonly string[] | null,
  b: readonly string[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function divergence(a: ProbeRead, b: ProbeRead): Divergence {
  const recorded = (read: ProbeRead) =>
    read.query !== undefined &&
    read.expansion !== undefined &&
    read.pool !== undefined &&
    read.order !== undefined;
  if (!recorded(a) || !recorded(b)) return "unknown";
  if (a.query !== b.query) return "query";
  if (a.expansion !== b.expansion) return "expansion";
  if (!sameList(a.pool ?? null, b.pool ?? null)) return "pool";
  if (!sameList(a.order ?? null, b.order ?? null)) return "rerank";
  return "cut";
}

/**
 * Every case both runs read, compared under `config`. A case only one of them
 * read has nothing to be compared with and is left out.
 */
export function compareProbeRuns(
  a: readonly ProbeRead[],
  b: readonly ProbeRead[],
  config: string = PRODUCTION_CONFIG,
): CaseComparison[] {
  const other = new Map(b.map((read) => [read.id, read]));
  return a.flatMap((read) => {
    const twin = other.get(read.id);
    if (twin === undefined) return [];
    const setA = read.per[config]?.set ?? [];
    const setB = twin.per[config]?.set ?? [];
    const list = sameList(setA, setB);
    return [
      {
        id: read.id,
        tier: read.tier,
        variant: read.variant ?? null,
        sameList: list,
        sameSet:
          setA.length === setB.length &&
          setA.every((chunk) => setB.includes(chunk)),
        divergence: list ? "same" : divergence(read, twin),
      },
    ];
  });
}
