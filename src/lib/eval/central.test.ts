import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CENTRAL_PATH,
  centralCoverage,
  parseCentral,
  staleMisses,
} from "./central";
import { DATASET_PATH, isRobustness, parseDataset } from "./dataset";

const central = parseCentral(readFileSync(CENTRAL_PATH, "utf8"));
const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));

describe("parseCentral", () => {
  it("rejects a file without cases, or a case without a claim", () => {
    expect(() => parseCentral("{}")).toThrow(/cases/);
    expect(() => parseCentral('{"cases":{"x":""}}')).toThrow(/x/);
  });
});

describe("centralCoverage", () => {
  const claims = new Map([
    ["a", "judged claim"],
    ["b", "literal claim"],
    ["c", "third claim"],
  ]);

  it("counts a judged miss, a literal miss, and skips unread rows", () => {
    const read = centralCoverage(
      [
        { id: "a", adequacy: { missing: ["judged claim"], literals: [] } },
        {
          id: "b",
          adequacy: { missing: [], literals: ["literal claim (5 %: absent)"] },
        },
        { id: "c", adequacy: { missing: ["another claim"], literals: [] } },
        { id: "d", adequacy: { missing: [], literals: [] } },
        { id: "a", adequacy: null },
      ],
      claims,
    );
    expect(read).toEqual({ stated: 1, total: 3, missed: ["a", "b"] });
  });
});

describe("staleMisses", () => {
  it("names misses the case no longer declares, literal suffix stripped", () => {
    const declared = ["kept claim (CNPT artículo 78).", "a step"];
    expect(
      staleMisses(declared, {
        missing: ["a step", "old wording"],
        literals: [
          "kept claim (CNPT artículo 78). (50 % | 50%: absent)",
          "old literal (5 %: present but uncited)",
        ],
      }),
    ).toEqual(["old wording", "old literal"]);
  });
});

describe("eval/tier1-central.json", () => {
  const tier1 = dataset.filter((c) => c.tier === 1 && !isRobustness(c));

  it("names every Tier 1 case outside the robustness block, and only those", () => {
    expect([...central.keys()].sort()).toEqual(tier1.map((c) => c.id).sort());
  });

  it("carries each claim's exact dataset text", () => {
    for (const evalCase of tier1) {
      const claims = (evalCase.requiredClaims ?? []).map((c) => c.claim);
      expect(claims, evalCase.id).toContain(central.get(evalCase.id));
    }
  });
});
