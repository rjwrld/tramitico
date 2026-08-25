import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  citationFailures,
  recordCitationFailure,
  resetCitationFailures,
  validateCitations,
} from "./invariant";

describe("validateCitations", () => {
  it("accepts an answer whose every marker points at a retrieved source", () => {
    expect(
      validateCitations("La tarifa es 13% [2]. Aplica a servicios [1].", 3),
    ).toEqual({ ok: true });
  });

  it("rejects an answer with no marker at all", () => {
    expect(validateCitations("La tarifa es 13%.", 3)).toEqual({
      ok: false,
      violation: "no_markers",
      unresolved: [],
    });
  });

  it("rejects a marker past the end of the retrieval set", () => {
    expect(
      validateCitations("La tarifa es 13% [1] y algo más [9].", 3),
    ).toEqual({ ok: false, violation: "unresolved_markers", unresolved: [9] });
  });

  it("rejects [0] — the numbering the prompt hands the model is 1-based", () => {
    expect(validateCitations("Base [1], y algo más [0].", 3)).toEqual({
      ok: false,
      violation: "unresolved_markers",
      unresolved: [0],
    });
  });

  it("reports every unresolved marker once, in order of first appearance", () => {
    expect(validateCitations("a [7] b [1] c [5] d [7].", 3)).toEqual({
      ok: false,
      violation: "unresolved_markers",
      unresolved: [7, 5],
    });
  });

  it("reports the missing marker before the dangling one when both are absent", () => {
    // No resolving marker *and* a dangling one: the answer cites nothing a
    // reader can follow, so it is the marker-less case.
    expect(validateCitations("a [9] b.", 3)).toEqual({
      ok: false,
      violation: "no_markers",
      unresolved: [9],
    });
  });

  it("does not read prose brackets as citations", () => {
    // Legal text carries brackets of its own; only bare integers are markers.
    expect(validateCitations("Según el [nota] y el [12x].", 3)).toEqual({
      ok: false,
      violation: "no_markers",
      unresolved: [],
    });
  });

  it("rejects any marker when nothing was retrieved", () => {
    expect(validateCitations("La tarifa es 13% [1].", 0)).toEqual({
      ok: false,
      violation: "no_markers",
      unresolved: [1],
    });
  });
});

describe("the citation-validation-failure counter (#131 req. 3)", () => {
  beforeEach(() => {
    resetCitationFailures();
    vi.restoreAllMocks();
  });

  it("starts at zero for every violation kind", () => {
    expect(citationFailures()).toEqual({
      no_markers: 0,
      unresolved_markers: 0,
    });
  });

  it("counts each failure under its own violation kind", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    recordCitationFailure({ violation: "no_markers", attempt: 1 });
    recordCitationFailure({ violation: "no_markers", attempt: 2 });
    recordCitationFailure({ violation: "unresolved_markers", attempt: 1 });

    expect(citationFailures()).toEqual({
      no_markers: 2,
      unresolved_markers: 1,
    });
  });

  it("logs each failure on a stable, greppable prefix with its attempt", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordCitationFailure({
      violation: "unresolved_markers",
      attempt: 2,
      unresolved: [9, 5],
    });

    expect(warn).toHaveBeenCalledWith(
      "ask: citation invariant violated — violation=unresolved_markers attempt=2 unresolved=9,5",
    );
  });

  it("hands back a copy — a caller cannot drive the counter through it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = citationFailures();
    snapshot.no_markers = 99;
    recordCitationFailure({ violation: "no_markers", attempt: 1 });

    expect(citationFailures().no_markers).toBe(1);
  });
});
