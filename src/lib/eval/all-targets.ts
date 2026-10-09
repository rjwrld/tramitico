/**
 * «All expected targets reached» (#570): reported beside the hit-rate gate,
 * never gated.
 *
 * `caseHit` counts a case when any one expected target is in the answer set,
 * so a missing second source never shows: in 10 of #561's 12 rows the carrier
 * is an expected target of a case that still reads as a hit. This count asks
 * the stricter question of the same answer set — every target the dataset
 * lists, in the top-k or pinned past it — and names the cases that hit with a
 * target cut.
 *
 * It is a read, not a gate, because `expected` was written as alternatives
 * for most of the dataset's life: some cases list two chunks either of which
 * answers the question. The hit-rate lane prints it live; `pnpm
 * hitrate-all-targets` recomputes it, for free, from a lane's committed log,
 * whose per-target lines (#304) carry each target's place.
 */
import {
  chunkMatchesTarget,
  type ExpectedTarget,
  type MatchableChunk,
} from "./dataset";

/** Every expected target matched by some chunk of the answer set. */
export function allTargetsReached(
  answerSet: readonly MatchableChunk[],
  expected: readonly ExpectedTarget[],
): boolean {
  return expected.every((target) =>
    answerSet.some((chunk) => chunkMatchesTarget(chunk, target)),
  );
}

/** One case's two readings: any target reached, and every one. */
export interface TargetReading {
  id: string;
  hit: boolean;
  allReached: boolean;
}

/** The reported line, for the cases the gated hit-rate line counts. */
export function formatAllTargetsLine(
  readings: readonly TargetReading[],
): string {
  const all = readings.filter((r) => r.allReached).length;
  const partial = readings.filter((r) => r.hit && !r.allReached);
  return (
    `all expected targets reached (#570, reported): ${all}/${readings.length}` +
    (partial.length > 0
      ? ` — hit with a target cut: ${partial.map((r) => r.id).join(", ")}`
      : "")
  );
}

/** A case of a hit-rate log: its line, then its dataset targets' places. */
export interface LoggedCase {
  id: string;
  hit: boolean;
  /** The dataset's targets only: the catalogue's and the carriers' are left out. */
  targets: { target: string; place: "top" | "pinned" | "cut" }[];
}

const CASE_LINE = /^\s+(hit |MISS)\s+pool#\S+\s+top=\S+\s+(\S+)\s*$/;
const TARGET_LINE = /^\s+pool#\S+\s+rr#\S+\s+(top|pinned|cut)\s+(.+?)\s*$/;
/** The suffixes the lane puts on a target the dataset did not list. */
const NOT_DATASET = /\((?:catálogo|carrier)\)$/;

/**
 * The cases of the hit-rate block in a lane's console log. A case line and its
 * target lines are the lane's per-case report; a log from before #304 has no
 * target lines, and its cases come back with none.
 */
export function parseHitRateLog(log: string): LoggedCase[] {
  const cases: LoggedCase[] = [];
  let current: LoggedCase | null = null;
  for (const line of log.split("\n")) {
    const head = CASE_LINE.exec(line);
    if (head !== null) {
      current = { id: head[2], hit: head[1] === "hit ", targets: [] };
      cases.push(current);
      continue;
    }
    const target = TARGET_LINE.exec(line);
    if (target !== null && current !== null) {
      if (!NOT_DATASET.test(target[2])) {
        current.targets.push({
          target: target[2],
          place: target[1] as "top" | "pinned" | "cut",
        });
      }
      continue;
    }
    // Anything else but the case's own ↳ ⤳ ⊕ lines ends the case.
    if (!/^\s+[↳⤳⊕]/.test(line)) current = null;
  }
  return cases;
}

/** A logged case read the way the lane reads it: pinned counts as reached. */
export function loggedReading(logged: LoggedCase): TargetReading {
  return {
    id: logged.id,
    hit: logged.hit,
    allReached:
      logged.targets.length > 0 &&
      logged.targets.every((t) => t.place !== "cut"),
  };
}
