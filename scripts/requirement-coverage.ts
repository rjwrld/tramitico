/**
 * Tier 1 requirement coverage read off committed groundedness transcripts
 * (#287): requirements stated over requirements declared, per case and
 * summed, from the rows' own `adequacy.missing` and `adequacy.literals`.
 *
 * Free on purpose — no provider, no database. It gives any earlier run the
 * finer count the groundedness lane now prints beside the Tier 1 gate, so a
 * new run is compared against a before-state that was never paid for twice.
 *
 * Usage:
 *   pnpm requirement-coverage eval/runs/<dir>/groundedness-….jsonl [more…]
 */
import { readFileSync } from "node:fs";
import {
  requirementCoverage,
  requirementTotal,
  type AdequacyMisses,
} from "../src/lib/eval/adequacy";
import { DATASET_PATH, parseDataset } from "../src/lib/eval/dataset";

const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));

for (const file of process.argv.slice(2)) {
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        JSON.parse(line) as { id: string; adequacy: AdequacyMisses | null },
    );
  const tier1 = rows.flatMap((row) => {
    const evalCase = dataset.find((c) => c.id === row.id);
    return evalCase?.tier === 1 ? [{ evalCase, adequacy: row.adequacy }] : [];
  });
  const { stated, total } = requirementCoverage(tier1);
  console.log(`${file}\n  tier 1 requirements stated: ${stated}/${total}`);
  for (const row of tier1) {
    const one = requirementCoverage([row]);
    if (one.stated < one.total) {
      console.log(
        `  ${one.stated}/${requirementTotal(row.evalCase)}  ${row.evalCase.id}`,
      );
    }
  }
}
