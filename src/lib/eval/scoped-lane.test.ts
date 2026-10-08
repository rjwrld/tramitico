import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATASET_PATH, parseDataset, retrievalCases } from "./dataset";
import { fixtureLane, scopedLane, type Suite } from "./scoped-lane";
import { SUBSET_ENV } from "./subset";

const CASES = retrievalCases(parseDataset(readFileSync(DATASET_PATH, "utf8")));
const LANE_ID = CASES[0].id;

/**
 * What keeps an eval lane's suites from going through `scopedLane` or
 * `fixtureLane`, one line per problem; empty when the wiring holds.
 *
 * vitest may be imported only by name, and never its `describe`: a namespace
 * or default import (`import * as v`, `import v`) reaches `v.describe` without
 * naming it (#543), and so does a dynamic `import("vitest")`.
 */
function laneWiring(text: string): string[] {
  const problems: string[] = [];
  const gates = text.match(/\bintegrationSuite\(/g) ?? [];
  const wrapped =
    text.match(/\b(?:scopedLane|fixtureLane)\(\s*integrationSuite\(/g) ?? [];
  if (gates.length === 0) problems.push("no integrationSuite gate");
  if (wrapped.length !== gates.length) {
    problems.push(
      `${gates.length - wrapped.length} integrationSuite gate(s) not wrapped`,
    );
  }
  for (const [, clause] of text.matchAll(
    /\bimport\s+([^;]*?)\s*from\s*["']vitest["']/g,
  )) {
    const named = /^(?:type\s+)?\{([^}]*)\}$/.exec(clause);
    if (named === null) problems.push(`vitest imported whole: ${clause}`);
    else if (/\bdescribe\b/.test(named[1])) {
      problems.push("vitest's describe imported");
    }
  }
  if (/\b(?:import|require)\(\s*["']vitest["']\s*\)/.test(text)) {
    problems.push("vitest loaded dynamically");
  }
  // A test declared outside any suite would run under every EVAL_CASES.
  if (/^(?:it|test)\b/m.test(text)) problems.push("a test outside any suite");
  return problems;
}

/**
 * The guard #536's acceptance rests on: «a scoped paid run can't silently run
 * a full lane». `laneScope` (in `subset.test.ts`) decides; this pins that
 * every eval lane asks it. A new `*.eval.test.ts` that declares its suite
 * straight from `integrationSuite`, or reaches vitest's `describe`, fails
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
      expect(laneWiring(readFileSync(path.join(src, file), "utf8"))).toEqual(
        [],
      );
    },
  );
});

describe("the wiring guard, on planted lanes (#543)", () => {
  const lane = (vitestImport: string, body = "") =>
    `${vitestImport}\n` +
    'import { scopedLane } from "./scoped-lane";\n' +
    'scopedLane(integrationSuite(needs), CASES, process.env)("lane", () => {\n' +
    `  it("asks", () => {});${body}\n` +
    "});\n";

  it("passes a lane wired the way the real ones are", () => {
    expect(
      laneWiring(lane('import { beforeAll, expect, it } from "vitest";')),
    ).toEqual([]);
  });

  it.each([
    ['import * as v from "vitest";', "vitest imported whole: * as v"],
    ['import v from "vitest";', "vitest imported whole: v"],
    ['import v, { it } from "vitest";', "vitest imported whole: v, { it }"],
    ['import { describe, it } from "vitest";', "vitest's describe imported"],
    ['import { describe as d } from "vitest";', "vitest's describe imported"],
  ])("fails %s", (vitestImport, problem) => {
    expect(laneWiring(lane(vitestImport))).toEqual([problem]);
  });

  it("fails a dynamic import of vitest", () => {
    const text = lane(
      'import { it } from "vitest";',
      '\n  const v = await import("vitest");',
    );
    expect(laneWiring(text)).toEqual(["vitest loaded dynamically"]);
  });

  it("fails an unwrapped gate and a test outside any suite", () => {
    const text =
      'import { it } from "vitest";\n' +
      'integrationSuite(needs)("bare", () => {});\n' +
      'it("loose", () => {});\n';
    expect(laneWiring(text)).toEqual([
      "1 integrationSuite gate(s) not wrapped",
      "a test outside any suite",
    ]);
  });
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
