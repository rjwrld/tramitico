// The bench scripts themselves are unlaned (they need the live corpus), so
// the extracted predicate is the part CI can hold: the exact-vs-prefix rule is
// the #218 regression, and it now has exactly one home (#228).
import { describe, expect, it } from "vitest";
import { matchesTarget } from "./target-match";

describe("matchesTarget", () => {
  it("matches a chunk whose doc and articulo are the target's", () => {
    expect(
      matchesTarget({ doc_key: "ley-iva", articulo: "Artículo 8" }, [
        { docKey: "ley-iva", articulo: "Artículo 8" },
      ]),
    ).toBe(true);
  });

  it("does not let 'Artículo 8' claim 'Artículo 80' (#218)", () => {
    expect(
      matchesTarget({ doc_key: "ley-iva", articulo: "Artículo 80" }, [
        { docKey: "ley-iva", articulo: "Artículo 8" },
      ]),
    ).toBe(false);
  });

  it("rejects the right articulo in the wrong document", () => {
    expect(
      matchesTarget({ doc_key: "ley-9635", articulo: "Artículo 8" }, [
        { docKey: "ley-iva", articulo: "Artículo 8" },
      ]),
    ).toBe(false);
  });

  it("counts any chunk of the doc when the target has no articulo", () => {
    expect(
      matchesTarget({ doc_key: "ccss-bmc", articulo: "Artículo 3" }, [
        { docKey: "ccss-bmc" },
      ]),
    ).toBe(true);
    expect(
      matchesTarget({ doc_key: "ccss-bmc", articulo: null }, [
        { docKey: "ccss-bmc" },
      ]),
    ).toBe(true);
  });

  it("does not match a null chunk articulo against an articulo target", () => {
    expect(
      matchesTarget({ doc_key: "ley-iva", articulo: null }, [
        { docKey: "ley-iva", articulo: "Artículo 8" },
      ]),
    ).toBe(false);
  });

  it("matches if any target matches, and none against an empty list", () => {
    const targets = [
      { docKey: "reglamento-iva", articulo: "Artículo 11" },
      { docKey: "ley-iva", articulo: "Artículo 8" },
    ];
    expect(
      matchesTarget({ doc_key: "ley-iva", articulo: "Artículo 8" }, targets),
    ).toBe(true);
    expect(matchesTarget({ doc_key: "ley-iva", articulo: null }, [])).toBe(
      false,
    );
  });
});
