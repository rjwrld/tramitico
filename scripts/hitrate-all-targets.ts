/**
 * #570's «all expected targets reached», recomputed from committed hit-rate
 * logs. Free — it reads files only: no database, no model, no reranker.
 *
 *   pnpm hitrate-all-targets <lane.log> [<lane.log> …]
 *
 * Each log's hit-rate block is split the way the lane splits it — the cases
 * the gated line counts, then the robustness block (#502) — by the current
 * `eval/dataset.jsonl`, and each part gets the gated hit count beside the
 * all-targets count (`all-targets.ts`). A log from before #304 prints no
 * per-target lines, and says so instead of reading as zero.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  formatAllTargetsLine,
  loggedReading,
  parseHitRateLog,
  type LoggedCase,
} from "../src/lib/eval/all-targets";
import {
  DATASET_PATH,
  isRobustness,
  parseDataset,
} from "../src/lib/eval/dataset";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: pnpm hitrate-all-targets <lane.log> [<lane.log> …]");
  process.exit(1);
}

const byId = new Map(
  parseDataset(readFileSync(DATASET_PATH, "utf8")).map((c) => [c.id, c]),
);
const inBlock = (logged: LoggedCase) => {
  const evalCase = byId.get(logged.id);
  return evalCase !== undefined && isRobustness(evalCase);
};

for (const file of files) {
  const cases = parseHitRateLog(readFileSync(file, "utf8"));
  console.log(`\n${path.relative(process.cwd(), file)}`);
  if (cases.length === 0) {
    console.log("  no hit-rate block");
    continue;
  }
  if (cases.every((c) => c.targets.length === 0)) {
    console.log(`  ${cases.length} cases, no per-target lines (before #304)`);
    continue;
  }
  const unknown = cases.filter((c) => !byId.has(c.id)).map((c) => c.id);
  for (const [name, part] of [
    ["gated", cases.filter((c) => !inBlock(c))],
    ["robustness block", cases.filter(inBlock)],
  ] as const) {
    if (part.length === 0) continue;
    const readings = part.map(loggedReading);
    const hits = readings.filter((r) => r.hit).length;
    console.log(`  ${name}: hit ${hits}/${readings.length}`);
    console.log(`  ${name}: ${formatAllTargetsLine(readings)}`);
  }
  if (unknown.length > 0) {
    console.log(
      `  not in today's dataset (read as gated): ${unknown.join(", ")}`,
    );
  }
}
