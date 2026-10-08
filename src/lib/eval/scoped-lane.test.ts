import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATASET_PATH, parseDataset, retrievalCases } from "./dataset";
import { fixtureLane, scopedLane, type Suite } from "./scoped-lane";
import { SUBSET_ENV } from "./subset";

const CASES = retrievalCases(parseDataset(readFileSync(DATASET_PATH, "utf8")));
const LANE_ID = CASES[0].id;

/**
 * The guard #536's acceptance rests on: «a scoped paid run can't silently run
 * a full lane». `laneScope` (in `subset.test.ts`) decides; this pins that
 * every eval lane asks it. A new `*.eval.test.ts` that declares its suite
 * straight from `integrationSuite`, or imports vitest's `describe`, fails
 * here, in the free lane, before it can spend under an `EVAL_CASES` run.
 */
describe("every eval lane is scoped by EVAL_CASES (#536)", () => {
  const src = path.join(process.cwd(), "src");
  const lanes = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".eval.test.ts"))
    .sort();

  it("finds the lanes", () => {
    // Vacuity guard: a glob that matched nothing would pass every check below.
    expect(lanes.length).toBeGreaterThanOrEqual(8);
  });

  it.each(lanes)(
    "%s builds every suite through scopedLane or fixtureLane",
    (file) => {
      const text = readFileSync(path.join(src, file), "utf8");
      const gates = text.match(/\bintegrationSuite\(/g) ?? [];
      const wrapped =
        text.match(/\b(?:scopedLane|fixtureLane)\(\s*integrationSuite\(/g) ??
        [];
      expect(gates.length).toBeGreaterThan(0);
      expect(wrapped.length).toBe(gates.length);
      const vitestImport =
        text.match(/import\s*\{([^}]*)\}\s*from\s*"vitest"/)?.[1] ?? "";
      expect(vitestImport).not.toMatch(/\bdescribe\b/);
      // A test declared outside any suite would run under every EVAL_CASES.
      expect(text).not.toMatch(/^(?:it|test)\b/m);
    },
  );
});

describe("scopedLane", () => {
  // Declared at collection time, as a lane file does; the assertions read
  // what the wrapper did with each call.
  const calls: string[] = [];
  const gate: Suite = (name) => void calls.push(name);

  scopedLane(gate, CASES, {})("unset", () => {});
  scopedLane(gate, CASES, { [SUBSET_ENV]: LANE_ID })("named", () => {});
  fixtureLane(gate, { [SUBSET_ENV]: LANE_ID })("a fixture lane", () => {
    it("never runs under EVAL_CASES", () => {
      throw new Error("a skipped lane ran a test");
    });
  });
  scopedLane(gate, [], { [SUBSET_ENV]: "" })("blank", () => {});
  // The typo branch declares one failing test; a skipped parent keeps it from
  // running here while still showing the gate is never reached.
  describe.skip("an unknown id", () => {
    scopedLane(gate, CASES, { [SUBSET_ENV]: `${LANE_ID},typo` })(
      "a typo",
      () => {},
    );
  });

  it("hands the lane to its gate when unset, blank or naming its cases", () => {
    expect(calls).toEqual(["unset", "named", "blank"]);
  });

  it("never hands a skipped or mistyped lane to its gate", () => {
    expect(calls).not.toContain("a fixture lane");
    expect(calls).not.toContain("a typo");
  });
});
