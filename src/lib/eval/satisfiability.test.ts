import { describe, expect, it } from "vitest";
import type { EvalCase } from "./dataset";
import {
  censusTargets,
  describeTarget,
  formatCensus,
  unsatisfiableTargets,
} from "./satisfiability";

const evalCase = (id: string, expected: EvalCase["expected"]): EvalCase => ({
  id,
  seed: "corpus",
  question: "¿?",
  expected,
  blocking: false,
  tier: 2,
  heldOut: false,
});

describe("censusTargets", () => {
  it("counts every target on its own, not per case", () => {
    const census = censusTargets(
      [
        evalCase("multi", [
          { docKey: "ley-iva", articulo: "Artículo 8" },
          { docKey: "ley-iva", articulo: "Artículo 999" },
        ]),
      ],
      [
        { docKey: "ley-iva", articulo: "Artículo 8", path: [] },
        { docKey: "ley-iva", articulo: "Artículo 8", path: [] },
      ],
    );
    expect(census.map((row) => row.matchCount)).toEqual([2, 0]);
  });

  it("honours pathIncludes when one label repeats across títulos", () => {
    const census = censusTargets(
      [
        evalCase("titled", [
          {
            docKey: "ley-9635",
            articulo: "Artículo 15",
            pathIncludes: "TÍTULO I",
          },
        ]),
      ],
      [{ docKey: "ley-9635", articulo: "Artículo 15", path: ["TÍTULO II"] }],
    );
    expect(census[0].matchCount).toBe(0);
  });
});

describe("unsatisfiableTargets", () => {
  it("names the case and the target of every miss", () => {
    const census = censusTargets(
      [evalCase("gap", [{ docKey: "ley-iva", articulo: "Artículo 999" }])],
      [],
    );
    expect(unsatisfiableTargets(census)).toEqual([
      "gap → ley-iva · Artículo 999",
    ]);
  });

  it("is empty when every target matches", () => {
    const census = censusTargets(
      [evalCase("ok", [{ docKey: "cabys-dev" }])],
      [{ docKey: "cabys-dev", articulo: null, path: [] }],
    );
    expect(unsatisfiableTargets(census)).toEqual([]);
  });
});

describe("describeTarget", () => {
  it("renders docKey, artículo and path qualifier", () => {
    expect(
      describeTarget({
        docKey: "ley-9635",
        articulo: "Artículo 8",
        pathIncludes: "TÍTULO I",
      }),
    ).toBe("ley-9635 · Artículo 8 · @TÍTULO I");
  });

  it("renders a document-wide target as just its docKey", () => {
    expect(describeTarget({ docKey: "cabys-dev" })).toBe("cabys-dev");
  });
});

describe("formatCensus", () => {
  it("heads the report with the satisfiable share and flags misses", () => {
    const census = censusTargets(
      [
        evalCase("a", [{ docKey: "cabys-dev" }]),
        evalCase("b", [{ docKey: "missing-doc" }]),
      ],
      [{ docKey: "cabys-dev", articulo: null, path: [] }],
    );
    const report = formatCensus(census, 1);
    expect(report).toContain("(1 chunks): 1/2 targets satisfiable");
    expect(report).toContain("MISS");
  });
});
