import { describe, expect, it } from "vitest";

import {
  envPrereqs,
  gateDecision,
  isCi,
  missingPrerequisites,
} from "./suite-gate";

describe("missingPrerequisites", () => {
  it("names every unmet prerequisite, in declaration order", () => {
    expect(
      missingPrerequisites({
        SUPABASE_URL: true,
        SUPABASE_SERVICE_ROLE_KEY: false,
        "a real embeddings provider": false,
      }),
    ).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "a real embeddings provider"]);
  });

  it("returns nothing when every prerequisite is met", () => {
    expect(missingPrerequisites({ SUPABASE_URL: true })).toEqual([]);
  });
});

describe("gateDecision", () => {
  it("runs the suite when the prerequisites are met, CI or not", () => {
    const prereqs = { SUPABASE_URL: true };
    expect(gateDecision(prereqs, true)).toEqual({ mode: "run", missing: [] });
    expect(gateDecision(prereqs, false)).toEqual({ mode: "run", missing: [] });
  });

  it("fails — never skips — on CI when a prerequisite is absent", () => {
    expect(gateDecision({ SUPABASE_URL: false }, true)).toEqual({
      mode: "fail",
      missing: ["SUPABASE_URL"],
    });
  });

  it("skips off CI, so a laptop without credentials stays usable", () => {
    expect(gateDecision({ SUPABASE_URL: false }, false)).toEqual({
      mode: "skip",
      missing: ["SUPABASE_URL"],
    });
  });
});

describe("envPrereqs", () => {
  it("treats an unset or empty variable as absent", () => {
    process.env.SUITE_GATE_SET = "value";
    process.env.SUITE_GATE_EMPTY = "";
    delete process.env.SUITE_GATE_UNSET;
    try {
      expect(
        envPrereqs("SUITE_GATE_SET", "SUITE_GATE_EMPTY", "SUITE_GATE_UNSET"),
      ).toEqual({
        SUITE_GATE_SET: true,
        SUITE_GATE_EMPTY: false,
        SUITE_GATE_UNSET: false,
      });
    } finally {
      delete process.env.SUITE_GATE_SET;
      delete process.env.SUITE_GATE_EMPTY;
    }
  });
});

describe("isCi", () => {
  it("reads CI=true as CI", () => {
    expect(isCi({ CI: "true" })).toBe(true);
    expect(isCi({ CI: "1" })).toBe(true);
  });

  it("reads an unset, empty or explicitly-off CI as not CI", () => {
    expect(isCi({})).toBe(false);
    expect(isCi({ CI: "" })).toBe(false);
    expect(isCi({ CI: "false" })).toBe(false);
    expect(isCi({ CI: "0" })).toBe(false);
  });
});
