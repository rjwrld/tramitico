// Free: one arm's five probe draws against the control's, read on
// preregistration.md's bars R1–R4, with R3 as Amendment 1 has it. No provider,
// no database: it reads probe JSONs through `carrierRecall`.
//
//   pnpm exec tsx eval/runs/2026-10-12-611/bars.ts <arm dir> [<control dir>]
//
// Each dir holds probe-1.json … probe-5.json; the control defaults to
// eval/runs/2026-10-12-611/control.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  carrierRecall,
  median,
  parseCarrierList,
  type ProbeRead,
  type RecallReport,
} from "../../../scripts/carrier-recall";

const HERE = path.join("eval", "runs", "2026-10-12-611");

function report(dir: string): RecallReport {
  const list = parseCarrierList(
    readFileSync(path.join(HERE, "carriers.json"), "utf8"),
  );
  const draws = [1, 2, 3, 4, 5].map((i) => ({
    name: `probe-${i}`,
    reads: (
      JSON.parse(readFileSync(path.join(dir, `probe-${i}.json`), "utf8")) as {
        reads: ProbeRead[];
      }
    ).reads,
  }));
  return carrierRecall(draws, list);
}

/** Each case's `isWeak` per draw, as one string to compare across arms. */
function weakFlags(dir: string): Map<string, string> {
  const flags = new Map<string, string>();
  for (const i of [1, 2, 3, 4, 5]) {
    const { reads } = JSON.parse(
      readFileSync(path.join(dir, `probe-${i}.json`), "utf8"),
    ) as { reads: ProbeRead[] };
    for (const r of reads) {
      flags.set(r.id, (flags.get(r.id) ?? "") + (r.weak ? "W" : "."));
    }
  }
  return flags;
}

const share = (r: RecallReport) => {
  const carried = r.rows.reduce((n, row) => n + row.carried, 0);
  const pairs = r.rows.reduce((n, row) => n + row.draws, 0);
  return carried / pairs;
};
const tierOneJaccard = (r: RecallReport) =>
  median(
    r.cases.flatMap((c) =>
      c.tierOne && c.jaccard !== null ? [c.jaccard] : [],
    ),
  ) ?? 0;
const sameStepPins = (r: RecallReport) => {
  const classified = r.cases.filter(
    (c) => c.tierOne && c.sameStepPins !== null,
  );
  return {
    same: classified.filter((c) => c.sameStepPins).length,
    of: classified.length,
  };
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL");

function main(): void {
  const [armDir, controlDir = path.join(HERE, "control")] =
    process.argv.slice(2);
  const arm = report(armDir);
  const control = report(controlDir);
  const lines: string[] = [`arm ${armDir} against ${controlDir}`, ""];

  // R1: mean share ≥ control + 10 points; no row control carries in ≥ 4/5
  // falls below 3/5.
  const [a1, c1] = [share(arm), share(control)];
  const floor = control.rows.flatMap((row, i) =>
    row.carried >= 4 && arm.rows[i].carried < 3
      ? [`${i + 1} ${row.row.case} ${row.carried}/5 → ${arm.rows[i].carried}/5`]
      : [],
  );
  const r1 = a1 >= c1 + 0.1 && floor.length === 0;
  lines.push(
    `R1 ${verdict(r1)}  mean share ${(100 * a1).toFixed(1)} % vs control ${(100 * c1).toFixed(1)} % (needs ≥ ${(100 * c1 + 10).toFixed(1)} %); floor rows fallen below 3/5: ${floor.length === 0 ? "none" : floor.join("; ")}`,
  );

  // R2: step-pinned subset identical on ≥ 90 % of classified Tier 1 cases;
  // Tier 1 median Jaccard ≥ control's.
  const pins = sameStepPins(arm);
  const [a2, c2] = [tierOneJaccard(arm), tierOneJaccard(control)];
  const r2 = pins.same / pins.of >= 0.9 && a2 >= c2;
  lines.push(
    `R2 ${verdict(r2)}  step-pinned subset identical ${pins.same}/${pins.of} (${((100 * pins.same) / pins.of).toFixed(1)} %, needs ≥ 90 %); Tier 1 median Jaccard ${a2.toFixed(2)} vs control ${c2.toFixed(2)}`,
  );

  // R3 (Amendment 1): hit-rate ≥ 0.94 on every draw; robustness ≥ 25 on every
  // draw and ≥ 130/135 summed; all-targets mean ≥ control − 1; isWeak the same
  // as control's on every case and draw, and no flip within the arm.
  const hitOk = arm.draws.every((d) => d.hits / d.gated >= 0.94);
  const rob = arm.draws.map((d) => d.robustnessHits);
  const robSum = rob.reduce((a, b) => a + b, 0);
  const robOk = rob.every((n) => n >= 25) && robSum >= 130;
  const [a3, c3] = [
    mean(arm.draws.map((d) => d.allTargets)),
    mean(control.draws.map((d) => d.allTargets)),
  ];
  const armWeak = weakFlags(armDir);
  const controlWeak = weakFlags(controlDir);
  // Draws aren't paired across arms: compare the flags each arm ever gave.
  const seen = (flags: string) => [...new Set(flags)].sort().join("");
  const weakChanged = [...armWeak].filter(
    ([id, flags]) =>
      controlWeak.has(id) && seen(flags) !== seen(controlWeak.get(id) ?? ""),
  );
  const weakOk = arm.weakFlips.length === 0 && weakChanged.length === 0;
  const r3 = hitOk && robOk && a3 >= c3 - 1 && weakOk;
  lines.push(
    `R3 ${verdict(r3)}  hit-rate ${arm.draws.map((d) => `${d.hits}/${d.gated}`).join(" ")} (${verdict(hitOk)}); robustness ${rob.join(" ")} = ${robSum}/135 (${verdict(robOk)}); all-targets mean ${a3.toFixed(1)} vs control ${c3.toFixed(1)}; isWeak flips ${arm.weakFlips.join(", ") || "none"}, differs from control ${weakChanged.map(([id]) => id).join(", ") || "none"}`,
  );

  // R4: median answer-set size ≤ control + 2 (the median of the per-draw
  // medians).
  const size = (r: RecallReport) =>
    median(
      r.draws.flatMap((d) => (d.medianSize === null ? [] : [d.medianSize])),
    ) ?? 0;
  const [a4, c4] = [size(arm), size(control)];
  const r4 = a4 <= c4 + 2;
  lines.push(
    `R4 ${verdict(r4)}  median size ${a4} vs control ${c4} (needs ≤ ${c4 + 2})`,
  );

  lines.push("", `R1–R4: ${verdict(r1 && r2 && r3 && r4)}`);
  console.log(lines.join("\n"));
}

main();
