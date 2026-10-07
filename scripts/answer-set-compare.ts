/**
 * Two `pnpm answer-set-probe` runs, compared case by case (#457): which cases
 * put the same answer set in front of the model, and for the ones that did
 * not, the first pipeline stage at which the two runs parted
 * (`src/lib/eval/answer-set-variance.ts`).
 *
 * Free: it reads two JSON files and calls nothing. Usage:
 *
 *   pnpm answer-set-compare a.json b.json [config]
 *
 * `config` is one of the probe's configuration names; the default is the one
 * the route runs (`top8/capoff/pinon`).
 */
import { readFileSync } from "node:fs";
import { isRobustness, ROBUSTNESS } from "../src/lib/eval/dataset";
import {
  compareProbeRuns,
  PRODUCTION_CONFIG,
  type CaseComparison,
  type Divergence,
  type ProbeRead,
} from "../src/lib/eval/answer-set-variance";

function reads(file: string): ProbeRead[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { reads: ProbeRead[] })
    .reads;
}

function main(): void {
  const [a, b, config = PRODUCTION_CONFIG] = process.argv.slice(2);
  if (!a || !b) {
    console.error("usage: pnpm answer-set-compare a.json b.json [config]");
    process.exit(1);
  }
  const rows = compareProbeRuns(reads(a), reads(b), config);
  // The robustness block (#502) is a group of its own, outside every tier.
  const block = (row: CaseComparison) => isRobustness(row);
  const groups: [string, (row: CaseComparison) => boolean][] = [
    ["Tier 1", (row) => row.tier === 1 && !block(row)],
    ["Tier 2", (row) => row.tier === 2 && !block(row)],
    [
      "untiered",
      (row) =>
        row.tier !== 1 &&
        row.tier !== 2 &&
        row.tier !== "abstain" &&
        !block(row),
    ],
    ["abstention", (row) => row.tier === "abstain"],
    [ROBUSTNESS, block],
  ];
  console.log(`config ${config}\n`);
  console.log(
    `${"cases".padEnd(11)} ${"n".padStart(3)} ${"same list".padStart(10)} ${"same set".padStart(9)}  first stage that differs`,
  );
  for (const [name, inGroup] of groups) {
    const group = rows.filter(inGroup);
    if (group.length === 0) continue;
    const stages = new Map<Divergence, number>();
    for (const row of group) {
      if (row.divergence === "same") continue;
      stages.set(row.divergence, (stages.get(row.divergence) ?? 0) + 1);
    }
    console.log(
      `${name.padEnd(11)} ${String(group.length).padStart(3)} ${String(group.filter((r) => r.sameList).length).padStart(10)} ${String(group.filter((r) => r.sameSet).length).padStart(9)}  ${
        [...stages].map(([stage, n]) => `${stage} ${n}`).join(", ") || "—"
      }`,
    );
  }
  console.log();
  for (const row of rows) {
    if (row.sameList) continue;
    console.log(
      `${String(row.tier).padEnd(8)} ${row.divergence.padEnd(9)} ${row.sameSet ? "reordered" : "differs  "} ${row.id}`,
    );
  }
}

main();
