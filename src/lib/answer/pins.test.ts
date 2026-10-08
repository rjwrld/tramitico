import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import type { ArticuloLookup } from "./cross-references";
import type { DerivedFigure } from "./derived";
import { pinAnswerSet } from "./pins";

function chunk(
  docKey: string,
  articulo: string,
  content = "Texto sin referencias.",
): RetrievedChunk {
  return {
    chunkId: `${docKey}-${articulo}`,
    docKey,
    docTitle: docKey,
    norma: null,
    articulo,
    path: [],
    part: 0,
    content: `[${docKey} — ${articulo}] ${content}`,
    source: {},
    fetchedAt: null,
    score: 0.1,
    vectorRank: 1,
    lexicalRank: 1,
  };
}

const FIGURE: DerivedFigure = {
  id: "figura",
  label: "Figura",
  formula: "a * b",
  decimals: 0,
  inputs: [
    {
      name: "a",
      value: 2,
      decimals: 0,
      docKey: "doc-a",
      articulo: "Artículo 1",
    },
    {
      name: "b",
      value: 3,
      decimals: 0,
      docKey: "doc-b",
      articulo: "Artículo 1",
    },
  ],
};

const lookupOf =
  (corpus: RetrievedChunk[]): ArticuloLookup =>
  async (references) =>
    corpus.filter((c) =>
      references.some(
        (r) => r.docKey === c.docKey && c.articulo === `Artículo ${r.articulo}`,
      ),
    );

const NOTHING_WITHHELD = {
  outOfPeriod: new Set<string>(),
  yearFigures: new Map(),
  datedFacts: new Map(),
  retired: new Set<string>(),
};

describe("pinAnswerSet", () => {
  beforeEach(() => {
    vi.stubEnv("PIN_CROSS_REFERENCES", "on");
    vi.stubEnv("PIN_DERIVED_INPUTS", "on");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const inputA = chunk("doc-a", "Artículo 1");
  const inputB = chunk("doc-b", "Artículo 1");

  it("appends the cut's references, then the derived inputs, after the cut", async () => {
    const naming = chunk(
      "doc-c",
      "Artículo 5",
      "Según el artículo 6 de esta ley.",
    );
    const named = chunk("doc-c", "Artículo 6");
    const pinned = await pinAnswerSet(
      [naming, inputA],
      [naming, inputA, inputB],
      {
        lookup: lookupOf([named]),
        withheld: NOTHING_WITHHELD,
        figures: [FIGURE],
      },
    );
    expect(pinned).toEqual([naming, inputA, named, inputB]);
  });

  it("appends a chunk both pins want once", async () => {
    const naming = chunk(
      "doc-b",
      "Artículo 2",
      "Según el artículo 1 de esta ley.",
    );
    const pinned = await pinAnswerSet(
      [naming, inputA],
      [naming, inputA, inputB],
      {
        lookup: lookupOf([inputB]),
        withheld: NOTHING_WITHHELD,
        figures: [FIGURE],
      },
    );
    expect(pinned).toEqual([naming, inputA, inputB]);
  });

  it("does not let a referenced chunk qualify a derived figure", async () => {
    // The reference brings input A; the figure's eligibility is judged on the
    // cut, which holds neither input, so B stays out: no chain.
    const naming = chunk(
      "doc-a",
      "Artículo 2",
      "Según el artículo 1 de esta ley.",
    );
    const pinned = await pinAnswerSet([naming], [naming, inputB], {
      lookup: lookupOf([inputA]),
      withheld: NOTHING_WITHHELD,
      figures: [FIGURE],
    });
    expect(pinned).toEqual([naming, inputA]);
  });

  it("is the derived pin alone under PIN_CROSS_REFERENCES=off", async () => {
    vi.stubEnv("PIN_CROSS_REFERENCES", "off");
    const naming = chunk(
      "doc-c",
      "Artículo 5",
      "Según el artículo 6 de esta ley.",
    );
    const pinned = await pinAnswerSet(
      [naming, inputA],
      [naming, inputA, inputB],
      {
        lookup: lookupOf([chunk("doc-c", "Artículo 6")]),
        withheld: NOTHING_WITHHELD,
        figures: [FIGURE],
      },
    );
    expect(pinned).toEqual([naming, inputA, inputB]);
  });
});
