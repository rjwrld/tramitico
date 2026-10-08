import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  abstentionCases,
  DATASET_PATH,
  parseDataset,
  type EvalCase,
} from "./dataset";
import {
  laneScope,
  SUBSET_ENV,
  selectCases,
  subsetGateFailure,
  subsetSpec,
} from "./subset";

function evalCase(id: string): EvalCase {
  return {
    id,
    seed: "held-out:T1-E",
    question: "¿…?",
    expected: [{ docKey: "tramos-renta-2026" }],
    blocking: true,
    tier: 1,
    heldOut: true,
    variant: "literal",
    family: "T1-E",
  };
}

const CASES = ["a", "b", "c"].map(evalCase);

describe("subsetSpec", () => {
  it("is null when the variable is unset", () => {
    expect(subsetSpec({})).toBeNull();
  });

  it("reads a comma-separated list, trimming the shell's spaces", () => {
    expect(subsetSpec({ [SUBSET_ENV]: " a , b " })).toEqual(["a", "b"]);
  });

  it("treats an empty value as the whole dataset", () => {
    // A script that exports the variable unconditionally must not accidentally
    // scope a run to nothing.
    expect(subsetSpec({ [SUBSET_ENV]: "" })).toBeNull();
    expect(subsetSpec({ [SUBSET_ENV]: " , " })).toBeNull();
  });
});

describe("selectCases", () => {
  it("returns the whole dataset for a null spec", () => {
    expect(selectCases(CASES, null).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps dataset order, not the order the ids were written in", () => {
    expect(selectCases(CASES, ["c", "a"]).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("collapses a repeated id", () => {
    expect(selectCases(CASES, ["b", "b"]).map((c) => c.id)).toEqual(["b"]);
  });

  it("selects an abstention case from the abstention lane's population", () => {
    const abstention = abstentionCases(
      parseDataset(readFileSync(DATASET_PATH, "utf8")),
    );
    expect(
      selectCases(abstention, ["ho-abs-iva-2027"]).map((c) => c.id),
    ).toEqual(["ho-abs-iva-2027"]);
  });

  it("leaves an id another lane runs to that lane when given the dataset", () => {
    // #536: `EVAL_CASES` naming cases of two lanes scopes both, rather than
    // failing the one that runs only some of them.
    const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));
    expect(
      selectCases(
        abstentionCases(dataset),
        ["ccss-cuanto-pago-base", "ho-abs-iva-2027"],
        dataset,
      ).map((c) => c.id),
    ).toEqual(["ho-abs-iva-2027"]);
  });

  it("throws on an id the dataset does not carry, naming it", () => {
    const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));
    expect(() =>
      selectCases(abstentionCases(dataset), ["ho-abs-typo"], dataset),
    ).toThrow(/no case has id ho-abs-typo — a typo/);
  });

  it("without a dataset, throws on an id outside the cases given", () => {
    const abstention = abstentionCases(
      parseDataset(readFileSync(DATASET_PATH, "utf8")),
    );
    expect(() => selectCases(abstention, ["ccss-cuanto-pago-base"])).toThrow(
      /ccss-cuanto-pago-base — a typo/,
    );
  });

  it("throws on an id no case carries, naming it", () => {
    // The failure mode this exists for: a typo selects zero cases, the run
    // measures nothing, prints an empty table and still spends the money.
    expect(() => selectCases(CASES, ["a", "typo"])).toThrow(/typo/);
  });
});

describe("laneScope (#536)", () => {
  const DATASET = ["a", "b", "c", "x"];

  it("is full when nothing is named", () => {
    expect(laneScope(["a", "b"], DATASET, null)).toEqual({ mode: "full" });
  });

  it("scopes a lane to the named ids it runs, dropping another lane's", () => {
    expect(laneScope(["a", "b"], DATASET, ["x", "b", "b"])).toEqual({
      mode: "scoped",
      ids: ["b"],
    });
  });

  it("skips a lane none of whose cases are named", () => {
    expect(laneScope(["a", "b"], DATASET, ["x"])).toEqual({
      mode: "skip",
      ids: ["x"],
    });
  });

  it("skips a fixture lane whatever is named", () => {
    expect(laneScope([], DATASET, ["a"])).toEqual({ mode: "skip", ids: ["a"] });
  });

  it("names an unknown id rather than running on the rest", () => {
    // Every lane reads the same verdict, so a typo stops all of them — none
    // runs on the ids that did match.
    expect(laneScope(["a", "b"], DATASET, ["a", "typo"])).toEqual({
      mode: "unknown",
      ids: ["typo"],
    });
    expect(laneScope([], DATASET, ["typo"])).toEqual({
      mode: "unknown",
      ids: ["typo"],
    });
  });
});

describe("subsetGateFailure", () => {
  it("names the ids and says the gates were not measured", () => {
    const message = subsetGateFailure(["a", "b"]);
    expect(message).toContain("a, b");
    expect(message).toContain(SUBSET_ENV);
  });
});
