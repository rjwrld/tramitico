import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATASET_PATH, parseDataset, type EvalCase } from "./dataset";
import { exposureOf, formatExposureTally, tallyByExposure } from "./exposure";

const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));

describe("exposureOf (#267)", () => {
  it("splits the committed dataset into 41 / 7 / the rest", () => {
    const counts = { "first-exposure": 0, promoted: 0, "corpus-derived": 0 };
    for (const c of cases) counts[exposureOf(c)] += 1;
    expect(counts["first-exposure"]).toBe(41);
    expect(counts.promoted).toBe(7);
    expect(counts["corpus-derived"]).toBe(cases.length - 48);
  });
});

describe("tallyByExposure", () => {
  const results = cases.map((evalCase) => ({
    evalCase,
    ok: evalCase.tier !== 1,
  }));

  it("counts passes per group, keeping every group even when empty", () => {
    const tallies = tallyByExposure(
      results,
      (r) => r.evalCase,
      (r) => r.ok,
    );
    expect(tallies.map((t) => t.group)).toEqual([
      "first-exposure",
      "promoted",
      "corpus-derived",
    ]);
    const first = tallies[0];
    // 27 Tier 1 held-out cases: 7 promoted + 20 first-exposure fail here.
    expect(first.total - first.passed).toBe(20);
    expect(tallies[1].total - tallies[1].passed).toBe(7);
    expect(tallies[2].passed).toBe(tallies[2].total);
    expect(
      tallyByExposure(
        [] as { evalCase: EvalCase }[],
        (r) => r.evalCase,
        () => true,
      ),
    ).toEqual([
      { group: "first-exposure", passed: 0, total: 0 },
      { group: "promoted", passed: 0, total: 0 },
      { group: "corpus-derived", passed: 0, total: 0 },
    ]);
  });

  it("formats one row per group under a label", () => {
    const text = formatExposureTally("hit-rate", [
      { group: "first-exposure", passed: 3, total: 4 },
      { group: "promoted", passed: 1, total: 1 },
      { group: "corpus-derived", passed: 0, total: 0 },
    ]);
    expect(text.split("\n")).toEqual([
      "hit-rate by exposure (#267):",
      "  first-exposure  3/4",
      "  promoted        1/1",
      "  corpus-derived  0/0",
    ]);
  });
});
