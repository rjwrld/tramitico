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

  it("rejects an artículo number written as a marker (#352)", () => {
    // `ho-cliente-espana-lleva-iva`, 2026-09-24: reglamento-iva art. 47 sat at
    // [5] of 8, and the model wrote its artículo number instead.
    expect(
      validateCitations(
        "Esto es distinto de los servicios digitales transfronterizos [6][47].",
        8,
      ),
    ).toEqual({ ok: false, violation: "unresolved_markers", unresolved: [47] });
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
    // Nor a bracketed figure: a decimal point or comma continues the number.
    expect(validateCitations("Un monto de [1.500] o de [13,5].", 3)).toEqual({
      ok: false,
      violation: "no_markers",
      unresolved: [],
    });
  });

  it("rejects a marker the model never closed (#352)", () => {
    // The 2026-09-24 full run: «…de la transacción [1] [3] [49 tomando base
    // el monto total…». No `]`, so it was no marker to the check and no
    // marker to the renumbering either — the reader would see «[49» as text.
    expect(
      validateCitations(
        "cobra el IVA [1] [3] [49 tomando base el monto total [6].",
        8,
      ),
    ).toEqual({ ok: false, violation: "unresolved_markers", unresolved: [49] });
    // In range or not: an unclosed «[4» renders no seal either.
    expect(validateCitations("Aplica [4 al servicio [2].", 8)).toEqual({
      ok: false,
      violation: "unresolved_markers",
      unresolved: [4],
    });
    // Alone, it is still no usable citation.
    expect(validateCitations("Aplica [4 al servicio.", 8)).toEqual({
      ok: false,
      violation: "no_markers",
      unresolved: [4],
    });
  });

  it("rejects a marker the model annotated with its own correction (#427)", () => {
    // The marker clusters of the three committed answers, verbatim. Refused,
    // not repaired: in the first the retracted [6] is in range, so a repair
    // would have to pick which of two numbers the sentence cites from the
    // model's own prose — the retry decides.
    expect(
      validateCitations("…el hosting [2][6 no aplica aquí, corrijo: 2].", 9),
    ).toEqual({ ok: false, violation: "unresolved_markers", unresolved: [6] });
    expect(
      validateCitations("…como asalariado [4][6][10 no existe, cito 6].", 8),
    ).toEqual({ ok: false, violation: "unresolved_markers", unresolved: [10] });
    expect(
      validateCitations("…asegurado por su patrono [7][10 nota: cita 7].", 9),
    ).toEqual({ ok: false, violation: "unresolved_markers", unresolved: [10] });
  });

  it("rejects an annotated marker whose number is followed by punctuation (#427)", () => {
    // Shipped as ok before: the unclosed check wanted a space after the number.
    // The 2026-09-25 off lane's «[3] [5, ojo: revisar]» on an 8-chunk answer,
    // and the 2026-09-16 run's «[12, en 2]» — an artículo number with the
    // document's after it.
    expect(validateCitations("…gravadas [3] [5, ojo: revisar].", 8)).toEqual({
      ok: false,
      violation: "unresolved_markers",
      unresolved: [5],
    });
    expect(
      validateCitations("…del servicio [1] [12, en 2]. No hay [25, en 1].", 8),
    ).toEqual({
      ok: false,
      violation: "unresolved_markers",
      unresolved: [12, 25],
    });
    for (const annotated of [
      "[10: cita 7]",
      "[10; cita 7]",
      "[10—cita 7]",
      "[10.",
    ]) {
      expect(validateCitations(`Aplica [7]${annotated}`, 9)).toEqual({
        ok: false,
        violation: "unresolved_markers",
        unresolved: [10],
      });
    }
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
      incomplete_derived_markers: 0,
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
      incomplete_derived_markers: 0,
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
