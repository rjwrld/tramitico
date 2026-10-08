import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../../../corpus/manifest.json";
import { KNOB_ERROR_PREFIX } from "../knobs";
import type { RetrievedChunk } from "../retrieval";
import type { WithheldSources } from "../vigencia";
import {
  articuloKey,
  CROSS_REFERENCE_CAP,
  CROSS_REFERENCE_LOG_PREFIX,
  crossReferencedChunks,
  crossReferences,
  crossReferencesEnabled,
  DOCUMENT_LINKS,
  type ArticuloLookup,
  type ArticuloReference,
  type DocumentLink,
} from "./cross-references";

const LINKS: ReadonlyMap<string, DocumentLink> = new Map([
  [
    "ley-iva",
    {
      docKey: "ley-iva",
      title: "Ley del Impuesto sobre el Valor Agregado (texto consolidado)",
      norma: "Ley 6826",
    },
  ],
  [
    "reglamento-iva",
    {
      docKey: "reglamento-iva",
      title: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
      norma: "Decreto Ejecutivo 41779",
      regulates: "ley-iva",
    },
  ],
]);

/** `crossReferences` on one sentence of a chunk's body. */
function refs(
  sentence: string,
  docKey = "ley-iva",
  articulo: string | null = "Artículo 30",
): ArticuloReference[] {
  return crossReferences(
    {
      docKey,
      articulo,
      content: `[Título — Capítulo — ${articulo}] ${articulo}- Texto. ${sentence}`,
    },
    LINKS,
  );
}

const iva = (...articulos: string[]) =>
  articulos.map((articulo) => ({ docKey: "ley-iva", articulo }));

describe("articuloKey", () => {
  it("reads the number every label spelling shares", () => {
    expect(articuloKey("Artículo 10")).toBe("10");
    expect(articuloKey("ARTICULO 10")).toBe("10");
    expect(articuloKey("ARTÍCULO 1")).toBe("1");
    expect(articuloKey("Artículo 8º")).toBe("8");
    expect(articuloKey("Artículo 11 bis")).toBe("11 BIS");
    expect(articuloKey("Artículo 28 quáter")).toBe("28 QUATER");
  });

  it("is null for a label that is not one numbered artículo", () => {
    expect(articuloKey(null)).toBeNull();
    expect(articuloKey("Transitorio IX")).toBeNull();
    expect(articuloKey("Preámbulo")).toBeNull();
    expect(articuloKey("Artículo 4°, sesión 9570")).toBeNull();
    expect(articuloKey("¿Cómo me afilio?")).toBeNull();
  });
});

describe("crossReferences", () => {
  it("follows «la tarifa referida en el artículo 10 de la presente ley» (#490)", () => {
    expect(
      refs(
        "La percepción será conforme a la tarifa referida en el artículo 10 de la presente ley.",
      ),
    ).toEqual(iva("10"));
  });

  it("reads «de esta ley», a bare «el artículo N» and its list forms", () => {
    expect(refs("Según el artículo 4 de esta ley.")).toEqual(iva("4"));
    expect(refs("Se aplica lo dispuesto en el artículo 22.")).toEqual(
      iva("22"),
    );
    expect(refs("Los bienes de los artículos 8 y 9 de esta ley.")).toEqual(
      iva("8", "9"),
    );
    expect(refs("Conforme a los artículos 18, 19 y 23 de esta ley.")).toEqual(
      iva("18", "19", "23"),
    );
  });

  it("reads Spanish ordinals and «bis»", () => {
    expect(refs("Conforme al artículo 2º de esta ley.")).toEqual(iva("2"));
    expect(refs("Conforme al artículo 1.º de esta ley.")).toEqual(iva("1"));
    expect(refs("Conforme al artículo 4° de esta ley.")).toEqual(iva("4"));
    expect(refs("Lo señala el artículo primero de esta ley.")).toEqual(
      iva("1"),
    );
    expect(refs("Según el artículo décimo de esta ley.")).toEqual(iva("10"));
    expect(refs("Según el artículo 10 bis de esta ley.")).toEqual(
      iva("10 BIS"),
    );
    expect(refs("Según el artículo 85 BIS de esta ley.")).toEqual(
      iva("85 BIS"),
    );
  });

  it("reads past a subdivision to the instrument it belongs to", () => {
    expect(
      refs("Según el párrafo segundo del artículo 4, inciso b), de esta ley."),
    ).toEqual(iva("4"));
    expect(
      refs(
        "Tal como se define en el artículo 1 Apartado B) Inciso iv) de la Ley:",
        "reglamento-iva",
        "Artículo 3",
      ),
    ).toEqual(iva("1"));
  });

  it("does not follow a reference to another instrument", () => {
    for (const sentence of [
      "Se sancionará conforme al artículo 83 de la Ley N.° 4755, Código de Normas y Procedimientos Tributarios.",
      "Según el artículo 104 del Código de Normas y Procedimientos Tributarios.",
      "Conforme al artículo 8 de dicha ley.",
      "(Así reformado por el artículo 12 de la Ley de Justicia Tributaria No.7535)",
      "(Así reformado por el artículo 1, inciso 1.1, de la ley Nº 7257)",
      "(Así reformado por el artículo 2° del decreto ejecutivo N° 42706)",
      "Lo dispuesto en el artículo 81 de la Constitución Política.",
    ]) {
      expect(refs(sentence)).toEqual([]);
    }
  });

  it("does not read a range, a renumbering note or a carried-over heading", () => {
    expect(refs("Lo previsto en los artículos 5 al 9 de esta ley.")).toEqual(
      [],
    );
    expect(refs("Traspasando el antiguo artículo 72 al actual 87.")).toEqual(
      [],
    );
    expect(refs("Artículo 31- Otra cosa. ARTÍCULO 32.- Más.")).toEqual([]);
  });

  it("never names the chunk's own artículo, and each artículo once", () => {
    expect(
      refs(
        "Lo dispuesto en el artículo 30, y en el artículo 10 y el artículo 10.",
      ),
    ).toEqual(iva("10"));
  });

  it("reads nothing in a preámbulo, which cites the instrument's legal basis", () => {
    expect(
      refs(
        "Con fundamento en el artículo 3 incisos 1 y 3.",
        "ley-iva",
        "Preámbulo",
      ),
    ).toEqual([]);
  });

  describe("in a reglamento that declares the law it regulates", () => {
    const reglamento = (sentence: string) =>
      refs(sentence, "reglamento-iva", "Artículo 22");

    it("reads «de la Ley», the defined term, as that law (#508)", () => {
      expect(
        reglamento(
          "La tarifa general es del trece por ciento (13%) de acuerdo a lo establecido en el artículo 10 de la Ley.",
        ),
      ).toEqual(iva("10"));
      expect(
        reglamento("Según el artículo 29 de la ley, el porcentaje."),
      ).toEqual(iva("29"));
    });

    it("reads the law by its title or its number", () => {
      expect(
        reglamento(
          "Con la tarifa general prevista en el artículo 10 de la Ley del Impuesto sobre el Valor Agregado.",
        ),
      ).toEqual(iva("10"));
      expect(reglamento("Según el artículo 11 de la Ley N° 6826.")).toEqual(
        iva("11"),
      );
    });

    it("reads «de la presente ley» as that law, «de este Reglamento» as itself", () => {
      expect(
        reglamento(
          "No exonerados por el artículo 9, ambos de la presente Ley.",
        ),
      ).toEqual(iva("9"));
      expect(
        reglamento(
          "Según el artículo 11 de este Reglamento y el artículo 66 del presente Reglamento.",
        ),
      ).toEqual([
        { docKey: "reglamento-iva", articulo: "11" },
        { docKey: "reglamento-iva", articulo: "66" },
      ]);
      expect(reglamento("Según el artículo 13.")).toEqual([
        { docKey: "reglamento-iva", articulo: "13" },
      ]);
    });

    it("does not read another law as the one it regulates", () => {
      expect(
        reglamento("Según el artículo 8 inciso b) de la Ley N° 1362."),
      ).toEqual([]);
      expect(
        reglamento(
          "Definidos en el artículo 93 de la Ley Reguladora del Contrato de Seguros, N° 8956.",
        ),
      ).toEqual([]);
      expect(
        reglamento("Según el artículo 160 de la Ley General de Aduanas."),
      ).toEqual([]);
    });
  });

  it("reads «de la Ley» in a law, which regulates nothing, as another law", () => {
    expect(refs("Según el artículo 10 de la Ley.")).toEqual([]);
  });
});

describe("corpus/manifest.json `regulates`", () => {
  it("names a law the manifest carries, never the entry itself", () => {
    const declared = (
      manifest.documents as { doc_key: string; regulates?: string }[]
    ).filter((doc) => doc.regulates !== undefined);
    expect(declared.length).toBeGreaterThan(0);
    for (const doc of declared) {
      expect(doc.regulates).not.toBe(doc.doc_key);
      expect(DOCUMENT_LINKS.has(doc.regulates!), doc.doc_key).toBe(true);
      expect(DOCUMENT_LINKS.get(doc.regulates!)?.regulates).toBeUndefined();
    }
  });

  it("links the IVA reglamento to the IVA law, the reference #508 is about", () => {
    expect(DOCUMENT_LINKS.get("reglamento-iva")?.regulates).toBe("ley-iva");
  });
});

function chunk(
  docKey: string,
  articulo: string,
  content = "Texto sin referencias.",
  part = 0,
): RetrievedChunk {
  return {
    chunkId: `${docKey}-${articulo}-${part}`,
    docKey,
    docTitle: docKey,
    norma: null,
    articulo,
    path: [],
    part,
    content: `[${docKey} — ${articulo}] ${content}`,
    source: {},
    fetchedAt: null,
    score: 0.1,
    vectorRank: 1,
    lexicalRank: 1,
  };
}

const NOTHING_WITHHELD: WithheldSources = {
  outOfPeriod: new Set(),
  retired: new Set(),
};

/** A lookup over a fixed corpus, recording what it was asked. */
function fakeLookup(corpus: RetrievedChunk[]) {
  const asked: ArticuloReference[][] = [];
  const lookup: ArticuloLookup = async (references) => {
    asked.push([...references]);
    return corpus.filter((c) =>
      references.some(
        (r) =>
          r.docKey === c.docKey &&
          r.articulo === articuloKey(c.articulo) &&
          c.part === 0,
      ),
    );
  };
  return { lookup, asked };
}

describe("crossReferencedChunks", () => {
  beforeEach(() => {
    vi.stubEnv("PIN_CROSS_REFERENCES", "on");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const art10 = chunk("ley-iva", "Artículo 10", "Tarifa del 13 %.");
  const art4 = chunk("ley-iva", "Artículo 4", "Contribuyentes.");
  const art8 = chunk("ley-iva", "Artículo 8", "Exenciones.");
  const art30 = chunk(
    "ley-iva",
    "Artículo 30",
    "Según el artículo 4 de esta ley y la tarifa referida en el artículo 10 de la presente ley; y los artículos 8 y 9 de esta ley.",
  );
  const options = (lookup: ArticuloLookup) => ({
    lookup,
    links: LINKS,
    withheld: NOTHING_WITHHELD,
  });

  it("fetches the artículo the answer set names (#508)", async () => {
    const answerSet = [
      chunk(
        "reglamento-iva",
        "Artículo 22",
        "La tarifa es del 13% de acuerdo a lo establecido en el artículo 10 de la Ley.",
      ),
    ];
    const { lookup, asked } = fakeLookup([art10]);
    expect(
      await crossReferencedChunks(answerSet, answerSet, options(lookup)),
    ).toEqual([art10]);
    expect(asked).toEqual([iva("10")]);
  });

  it(`appends at most ${CROSS_REFERENCE_CAP}, in the order the set names them`, async () => {
    const { lookup } = fakeLookup([art4, art10, art8]);
    expect(
      await crossReferencedChunks([art30], [art30], options(lookup)),
    ).toEqual([art4, art10]);
  });

  it("does not fetch an artículo the set already holds, in any part", async () => {
    const art4Part1 = chunk("ley-iva", "Artículo 4", "Sigue.", 1);
    const { lookup, asked } = fakeLookup([art4, art10, art8]);
    expect(
      await crossReferencedChunks(
        [art30, art4Part1],
        [art30, art4Part1],
        options(lookup),
      ),
    ).toEqual([art10, art8]);
    expect(asked[0].map((r) => r.articulo)).not.toContain("4");
  });

  it("takes a referenced artículo from the pool before asking the database", async () => {
    const { lookup, asked } = fakeLookup([]);
    expect(
      await crossReferencedChunks(
        [art30],
        [art30, art10, art4],
        options(lookup),
      ),
    ).toEqual([art4, art10]);
    expect(asked[0].map((r) => r.articulo)).toEqual(["8", "9"]);
  });

  it("never follows a reference an appended chunk makes", async () => {
    const art10Naming1 = chunk(
      "ley-iva",
      "Artículo 10",
      "Tarifa, según el artículo 1 de esta ley.",
    );
    const art1 = chunk("ley-iva", "Artículo 1", "Objeto.");
    const answerSet = [
      chunk("reglamento-iva", "Artículo 22", "Ver el artículo 10 de la Ley."),
    ];
    const { lookup } = fakeLookup([art10Naming1, art1]);
    expect(
      await crossReferencedChunks(answerSet, answerSet, options(lookup)),
    ).toEqual([art10Naming1]);
  });

  it("skips a reference the corpus does not hold, and fills the cap past it", async () => {
    const { lookup } = fakeLookup([art10, art8]);
    expect(
      await crossReferencedChunks([art30], [art30], options(lookup)),
    ).toEqual([art10, art8]);
  });

  it("does not fetch from a withheld source (#505)", async () => {
    const { lookup, asked } = fakeLookup([art10]);
    expect(
      await crossReferencedChunks([art30], [art30], {
        lookup,
        links: LINKS,
        withheld: { outOfPeriod: new Set(["ley-iva"]), retired: new Set() },
      }),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("logs a failed lookup and appends nothing, without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: ArticuloLookup = async () => {
      throw new Error("PostgREST down");
    };
    expect(
      await crossReferencedChunks([art30], [art30], options(failing)),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      new RegExp(`^${CROSS_REFERENCE_LOG_PREFIX} error=`),
    );
  });

  it("asks nothing when the set names nothing", async () => {
    const { lookup, asked } = fakeLookup([art10]);
    expect(
      await crossReferencedChunks([art10], [art10], options(lookup)),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("is off under PIN_CROSS_REFERENCES=off, the measured baseline", async () => {
    vi.stubEnv("PIN_CROSS_REFERENCES", "off");
    const { lookup, asked } = fakeLookup([art10]);
    expect(
      await crossReferencedChunks([art30], [art30], options(lookup)),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("reads unset and empty as on, and an unknown value as on, loudly", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("PIN_CROSS_REFERENCES", "");
    expect(crossReferencesEnabled()).toBe(true);
    vi.stubEnv("PIN_CROSS_REFERENCES", "of");
    expect(crossReferencesEnabled()).toBe(true);
    expect(errors.mock.calls[0][0]).toContain(KNOB_ERROR_PREFIX);
  });
});
