import { describe, expect, it } from "vitest";
import type { EvalCase } from "./dataset";
import {
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

  it("throws on an id no case carries, naming it", () => {
    // The failure mode this exists for: a typo selects zero cases, the run
    // measures nothing, prints an empty table and still spends the money.
    expect(() => selectCases(CASES, ["a", "typo"])).toThrow(/typo/);
  });
});

describe("subsetGateFailure", () => {
  it("names the ids and says the gates were not measured", () => {
    const message = subsetGateFailure(["a", "b"]);
    expect(message).toContain("a, b");
    expect(message).toContain(SUBSET_ENV);
  });
});
