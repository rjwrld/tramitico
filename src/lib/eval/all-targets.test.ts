import { describe, expect, it } from "vitest";
import {
  allTargetsReached,
  formatAllTargetsLine,
  loggedReading,
  parseHitRateLog,
} from "./all-targets";
import { caseHit } from "./dataset";

const chunk = (docKey: string, articulo: string | null = null) => ({
  docKey,
  articulo,
  path: [],
});

describe("allTargetsReached", () => {
  const expected = [
    { docKey: "reglamento-comprobantes", articulo: "Artículo 4" },
    { docKey: "cabys-dev" },
  ];

  it("is false where caseHit is true but a second target is cut", () => {
    const answerSet = [chunk("reglamento-comprobantes", "Artículo 4")];
    expect(caseHit(answerSet, expected)).toBe(true);
    expect(allTargetsReached(answerSet, expected)).toBe(false);
  });

  it("is true when every target has a chunk", () => {
    expect(
      allTargetsReached(
        [chunk("cabys-dev"), chunk("reglamento-comprobantes", "Artículo 4")],
        expected,
      ),
    ).toBe(true);
  });
});

describe("formatAllTargetsLine", () => {
  it("counts every-target cases and names the hits with a target cut", () => {
    expect(
      formatAllTargetsLine([
        { id: "a", hit: true, allReached: true },
        { id: "b", hit: true, allReached: false },
        { id: "c", hit: false, allReached: false },
      ]),
    ).toBe(
      "all expected targets reached (#570, reported): 1/3 — hit with a target cut: b",
    );
  });
});

// Shaped like the lane's console (eval/runs/2026-10-09-497-wave-d/).
const LOG = `
retrieval hit-rate (rerank=voyage rerank-2.5-lite, pool 40 → top 8): 1/2
  hit   pool#1  top=0.0750  ho-cabys-paginas-web
        ↳ ¿Qué código de actividad económica debo registrar en Hacienda?
        ⤳ Código CABYS aplicable a la actividad económica de diseño web.
        ⊕ steps=T1-C (dataset T1-C)
          pool#1  rr#1  top    cabys-dev · *
          pool#13 rr#20 cut    reglamento-comprobantes · Artículo 13
          pool#2  rr#2  top    reglamento-comprobantes · Artículo 4 (catálogo)
          pool#11 rr#22 pinned reglamento-comprobantes · Artículo 9 (catálogo)
  MISS  pool#—  top=0.0300  some-miss
        ⊕ steps=—
          pool#—  rr#—  cut    ley-iva · Artículo 10
  hit   pool#3  top=0.0654  pinned-only
        ⊕ steps=—
          pool#3  rr#9  pinned ccss-escala-salud · *
          pool#14 rr#6  top    ccss-reglamento-ti · Artículo 1 (carrier)

  cut between pool and top-8: some-miss
    #1 ley-iva · Artículo 11
`;

describe("parseHitRateLog", () => {
  const cases = parseHitRateLog(LOG);

  it("reads every case line, hit or miss", () => {
    expect(cases.map((c) => [c.id, c.hit])).toEqual([
      ["ho-cabys-paginas-web", true],
      ["some-miss", false],
      ["pinned-only", true],
    ]);
  });

  it("keeps the dataset's targets and leaves the catalogue's and carriers' out", () => {
    expect(cases[0].targets).toEqual([
      { target: "cabys-dev · *", place: "top" },
      { target: "reglamento-comprobantes · Artículo 13", place: "cut" },
    ]);
    expect(cases[2].targets).toEqual([
      { target: "ccss-escala-salud · *", place: "pinned" },
    ]);
  });

  it("reads a pinned target as reached and a cut one as not", () => {
    expect(cases.map(loggedReading)).toEqual([
      { id: "ho-cabys-paginas-web", hit: true, allReached: false },
      { id: "some-miss", hit: false, allReached: false },
      { id: "pinned-only", hit: true, allReached: true },
    ]);
  });

  it("returns cases with no targets from a log before #304", () => {
    const old = parseHitRateLog("  hit   pool#1  top=0.0750  a-case\n");
    expect(old).toEqual([{ id: "a-case", hit: true, targets: [] }]);
    expect(loggedReading(old[0]).allReached).toBe(false);
  });
});
