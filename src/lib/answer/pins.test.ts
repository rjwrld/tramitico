import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { noneWithheld } from "../test-support/withheld";
import type { ArticuloLookup } from "./cross-references";
import type { DerivedFigure } from "./derived";
import { pinAnswerSet, type PinName } from "./pins";

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

const NOTHING_WITHHELD = noneWithheld();

/** A question that names no source, for the tests of the first two pins. */
const QUESTION = "¿Cuánto pago?";

describe("pinAnswerSet", () => {
  beforeEach(() => {
    vi.stubEnv("PIN_CROSS_REFERENCES", "on");
    vi.stubEnv("PIN_DERIVED_INPUTS", "on");
    vi.stubEnv("PIN_NAMED_SOURCES", "on");
    vi.stubEnv("PIN_SALARIO_BASE", "on");
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
      QUESTION,
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
      QUESTION,
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
    const pinned = await pinAnswerSet([naming], [naming, inputB], QUESTION, {
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
      QUESTION,
      {
        lookup: lookupOf([chunk("doc-c", "Artículo 6")]),
        withheld: NOTHING_WITHHELD,
        figures: [FIGURE],
      },
    );
    expect(pinned).toEqual([naming, inputA, inputB]);
  });

  describe("a source the question names (#559)", () => {
    const options = { lookup: lookupOf([]), withheld: NOTHING_WITHHELD };
    const article4 = chunk("reglamento-comprobantes", "Artículo 4");
    const cabys = { ...chunk("cabys-dev", "—"), articulo: null };
    const cabysTail = { ...cabys, chunkId: "cabys-dev-1", part: 1 };
    const QUESTION_CABYS =
      "¿Cómo emito mi primera factura electrónica y qué código CABYS uso?";

    it("appends the named document's best pooled chunk, after the other pins", async () => {
      const pinned = await pinAnswerSet(
        [article4, inputA],
        [article4, cabys, inputA, cabysTail, inputB],
        QUESTION_CABYS,
        { ...options, figures: [FIGURE] },
      );
      expect(pinned).toEqual([article4, inputA, inputB, cabys]);
    });

    it("matches the word whatever its case and accents", async () => {
      for (const question of ["¿que codigo cabys uso?", "¿Qué CÁBYS uso?"]) {
        const pinned = await pinAnswerSet(
          [article4],
          [article4, cabys],
          question,
          options,
        );
        expect(pinned).toEqual([article4, cabys]);
      }
    });

    it("appends nothing when the set already holds a chunk of that document", async () => {
      const pinned = await pinAnswerSet(
        [article4, cabysTail],
        [article4, cabys, cabysTail],
        QUESTION_CABYS,
        options,
      );
      expect(pinned).toEqual([article4, cabysTail]);
    });

    it("appends nothing the pool lacks, nor for a word that only contains the name", async () => {
      expect(
        await pinAnswerSet([article4], [article4], QUESTION_CABYS, options),
      ).toEqual([article4]);
      expect(
        await pinAnswerSet(
          [article4],
          [article4, cabys],
          "¿Qué es un cabysario?",
          options,
        ),
      ).toEqual([article4]);
    });

    it("appends nothing under PIN_NAMED_SOURCES=off", async () => {
      vi.stubEnv("PIN_NAMED_SOURCES", "off");
      const pinned = await pinAnswerSet(
        [article4],
        [article4, cabys],
        QUESTION_CABYS,
        options,
      );
      expect(pinned).toEqual([article4]);
    });
  });

  describe("the salario base (#579)", () => {
    const multa = chunk(
      "cnpt",
      "Artículo 79",
      "tendrán una multa equivalente al cincuenta por ciento (50%) del salario base.",
    );
    const salarioBase = chunk("salario-base-2026", "Circular 246-2025");
    const cabys = { ...chunk("cabys-dev", "—"), articulo: null };

    it("appends it after the derived inputs and before a named source, and says which pin brought each", async () => {
      let pins: ReadonlyMap<string, PinName> = new Map();
      const pinned = await pinAnswerSet(
        [multa, inputA],
        [multa, inputA, inputB, cabys],
        "¿Qué código CABYS uso?",
        {
          lookup: lookupOf([]),
          withheld: NOTHING_WITHHELD,
          figures: [FIGURE],
          salarioBaseLookup: async () => [salarioBase],
          onPins: (told) => {
            pins = told;
          },
        },
      );
      expect(pinned).toEqual([multa, inputA, inputB, salarioBase, cabys]);
      expect([...pins]).toEqual([
        [inputB.chunkId, "derivedInput"],
        [salarioBase.chunkId, "salarioBase"],
        [cabys.chunkId, "namedSource"],
      ]);
    });

    it("is judged on the cut: a referenced multa brings nothing", async () => {
      const naming = chunk(
        "cnpt",
        "Artículo 80",
        "Según el artículo 79 de este código.",
      );
      const pinned = await pinAnswerSet([naming], [naming], QUESTION, {
        lookup: lookupOf([multa]),
        withheld: NOTHING_WITHHELD,
        salarioBaseLookup: async () => [salarioBase],
      });
      expect(pinned).toEqual([naming, multa]);
    });

    it("appends nothing under PIN_SALARIO_BASE=off", async () => {
      vi.stubEnv("PIN_SALARIO_BASE", "off");
      const pinned = await pinAnswerSet([multa], [multa], QUESTION, {
        lookup: lookupOf([]),
        withheld: NOTHING_WITHHELD,
        salarioBaseLookup: async () => [salarioBase],
      });
      expect(pinned).toEqual([multa]);
    });
  });
});
