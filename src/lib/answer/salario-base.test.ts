import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { noneWithheld } from "../test-support/withheld";
import { withheldSources } from "../vigencia";
import {
  salarioBaseChunks,
  salarioBaseDocKeys,
  namesLey7337,
  SALARIO_BASE_LOG_PREFIX,
  statesAmountInSalariosBase,
  statesSanctionInSalariosBase,
  triggersSalarioBase,
  type SalarioBaseLookup,
  type SalarioBaseOutcome,
} from "./salario-base";

function chunk(
  docKey: string,
  articulo: string,
  content = "Texto sin cifras.",
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

// Verbatim from the corpus (local stack, 2026-10-09).
const CNPT_79 = chunk(
  "cnpt",
  "Artículo 79",
  "Los sujetos pasivos que presenten las declaraciones tributarias fuera del plazo legal establecido, tendrán una multa equivalente al cincuenta por ciento (50%) del salario base.",
);
const CNPT_78 = chunk(
  "cnpt",
  "Artículo 78",
  "deberán liquidar y pagar una sanción equivalente al cincuenta por ciento (50%) de un salario base por cada mes o fracción de mes",
);
const SALARIO_BASE = chunk(
  "salario-base-2026",
  "Circular 246-2025",
  "El salario base que regirá durante el año 2026 será de ¢462.200,00.",
);
const UNRELATED = chunk("ley-iva", "Artículo 1");
// #591: an exemption threshold, not a sanción. Its chunk names Ley 7337.
const LEY_IVA_8 = chunk(
  "ley-iva",
  "Artículo 8",
  "siempre y cuando el monto de la renta mensual sea igual o inferior al uno coma cinco (1,5) del salario base. La denominación salario base utilizada en este inciso debe entenderse como la contenida en el artículo 2 de la Ley N.° 7337, Crea Concepto Salario Base para Delitos Especiales del Código Penal.",
);
// #599: Wave G's three groundedness failures were triggered by these, and
// none names Ley 7337 (local stack, 2026-10-10).
const BIENES_CAPITAL_31 = chunk(
  "reglamento-iva-bienes-capital",
  "Artículo 31",
  "Cuando el valor de adquisición de un bien de capital supere los quince salarios base, y este se utilice o prevea utilizar indistintamente en operaciones con diferentes tarifas",
);
const RTS_2 = chunk(
  "reglamento-rts",
  "Artículo 2",
  "Además, su precio de venta no debe superar el 50% de un salario base. (Así reformado el inciso anterior por el artículo 1° del decreto ejecutivo N° 45209 del 11 de agosto de 2025)",
);
const RTS_3 = chunk(
  "reglamento-rts",
  "Artículo 3",
  "que el valor de sus compras anuales, realizadas del primero de enero al treinta y uno de diciembre de cada año, no supere los ciento ochenta y seis salarios base.",
);

const lookupOf = (...found: RetrievedChunk[]): SalarioBaseLookup =>
  vi.fn(async () => found);

describe("statesSanctionInSalariosBase", () => {
  it.each([
    ["cnpt 79", CNPT_79.content],
    ["cnpt 78", CNPT_78.content],
    [
      "cnpt 81",
      "Siempre que la base de la sanción sea igual o inferior al equivalente de quinientos salarios base, se aplicarán las sanciones",
    ],
    [
      "ley-iva 85 bis",
      "Esta infracción se sancionará con una multa equivalente a un salario base, sin perjuicio de lo establecido en el artículo 92.",
    ],
    ["a number inside the clause", "una multa de 1.000 salarios base"],
  ])("reads %s as a sanción in salarios base", (_, content) => {
    expect(statesSanctionInSalariosBase({ content })).toBe(true);
  });

  it.each([
    [
      "ley-iva 8, the alquiler exemption",
      "cuando el monto de la renta mensual sea igual o inferior al uno coma cinco (1,5) del salario base.",
    ],
    [
      "reglamento-iva 31, bienes de capital",
      "Cuando el valor de adquisición de un bien de capital supere los quince salarios base",
    ],
    [
      "a multa and a salario base in different sentences",
      "Se aplica una multa. El tope exento es un salario base.",
    ],
    ["the header alone", "[Multas — salario base] Texto sin cifras."],
  ])("does not read %s as one", (_, content) => {
    expect(statesSanctionInSalariosBase({ content })).toBe(false);
  });
});

describe("statesAmountInSalariosBase", () => {
  // Every phrase is verbatim from the local corpus (2026-10-10), the census
  // in eval/runs/2026-10-10-591/.
  it.each([
    ["cnpt 79, a fraction in words and figures", CNPT_79.content],
    ["cnpt 78, «de un salario base»", CNPT_78.content],
    [
      "cnpt 81, a count in words",
      "la base de la sanción sea igual o inferior al equivalente de quinientos salarios base",
    ],
    [
      "ley-iva 85 bis, «un salario base»",
      "una multa equivalente a un salario base",
    ],
    ["ley-iva 8, the alquiler exemption", LEY_IVA_8.content],
    [
      "reglamento-iva 11, «(1,5) uno coma cinco del salario base»",
      "sea igual o inferior a (1,5) uno coma cinco del salario base",
    ],
    [
      "reglamento-iva 11, a bare decimal",
      "alquileres que no superen el 1,5 del salario base mensual",
    ],
    [
      "ley-renta 31 ter, the tramos",
      "Sobre el exceso de un salario base y hasta dos salarios base, pagarán un siete por ciento (7%)",
    ],
    [
      "ley-iva 11 bis, «medio salario base»",
      "cuyo precio no supere medio salario base fijado conforme al artículo 2",
    ],
    [
      "ley-renta 13, a count in parentheses",
      "el monto equivalente a doscientos cincuenta (250) salarios base",
    ],
    [
      "reglamento-iva 31, bienes de capital",
      "Cuando el valor de adquisición de un bien de capital supere los quince salarios base",
    ],
    ["reglamento-iva 64, a count in figures", "superenlos 15 salarios base"],
    [
      "reglamento-renta 81, «1,000 (mil)»",
      "superen el monto equivalente a 1,000 (mil) salarios base en el año",
    ],
    [
      "reglamento-rts 3, a compound count",
      "no supere los ciento ochenta y seis salarios base",
    ],
    [
      "a percentage in words alone",
      "el cincuenta por ciento de un salario base",
    ],
  ])("reads %s as an amount in salarios base", (_, content) => {
    expect(statesAmountInSalariosBase({ content })).toBe(true);
  });

  it.each([
    [
      "reglamento-renta 22, a definition",
      "Para efectos de este artículo se entiende como salario base (*) la contenida en el artículo 2º de la ley Nº 7337",
    ],
    [
      "ley-renta 13's note",
      "(Sobre monto actualizado del salario base, ver observaciones de esta ley)",
    ],
    [
      "ley-iva 8's naming of the term",
      "La denominación salario base utilizada en este inciso debe entenderse como la contenida en el artículo 2",
    ],
    [
      "the law's title",
      "Ley N.° 7337, Crea Concepto Salario Base para Delitos Especiales del Código Penal",
    ],
    ["the circular itself", SALARIO_BASE.content],
    ["the header alone", "[Tres salarios base] Texto sin cifras."],
    ["a number in another sentence", "Son 3. Salario base vigente."],
  ])("does not read %s as one", (_, content) => {
    expect(statesAmountInSalariosBase({ content })).toBe(false);
  });

  it("reads every sanción #579 read", () => {
    for (const content of [CNPT_78.content, CNPT_79.content]) {
      expect(statesSanctionInSalariosBase({ content })).toBe(true);
      expect(statesAmountInSalariosBase({ content })).toBe(true);
    }
  });
});

describe("namesLey7337", () => {
  // The first four are verbatim from the chunks that name it (local stack,
  // 2026-10-10); the rest are the spellings a citation can take.
  it.each([
    ["ley-iva 8", "en el artículo 2 de la Ley N.° 7337, Crea Concepto"],
    ["ley-renta 13", "en el artículo 2 de la Ley No. 7337. (Así reformado"],
    ["reglamento-iva 38 bis", "el artículo 2 de la Ley Nº7337, del 5 de mayo"],
    ["reglamento-renta 22", "en el artículo 2º de la ley Nº 7337."],
    ["«Ley 7337»", "conforme al artículo 2 de la Ley 7337, del 5 de mayo"],
    ["«Ley número 7337»", "la Ley número 7337"],
    ["a thousands point", "la Ley N° 7.337"],
    ["at the end of the text", "según la Ley 7337"],
  ])("reads %s", (_, content) => {
    expect(namesLey7337({ content })).toBe(true);
  });

  it.each([
    ["another law", "la Ley N.° 10.620, de Presupuesto"],
    ["a longer number", "la Ley 17337"],
    ["a longer number after it", "la Ley 73370"],
    ["a decimal", "la Ley 7337,5"],
    ["a decree", "el decreto ejecutivo N° 7337"],
    ["an amount", "un monto de ¢7337"],
    ["another figure between", "la Ley 10.620 y el artículo 7337"],
    ["the header alone", "[Ley 7337] Texto sin cifras."],
  ])("does not read %s", (_, content) => {
    expect(namesLey7337({ content })).toBe(false);
  });
});

describe("triggersSalarioBase (#599)", () => {
  it.each([
    ["cnpt 79, a sanción that names no law", CNPT_79],
    ["cnpt 78", CNPT_78],
    ["ley-iva 8, an amount beside Ley 7337", LEY_IVA_8],
    [
      "ley-iva 11 bis",
      chunk(
        "ley-iva",
        "Artículo 11 bis",
        "cuyo precio no supere medio salario base fijado conforme al artículo 2 de la Ley 7337, del 5 de mayo de 1993.",
      ),
    ],
  ])("fires on %s", (_, c) => {
    expect(triggersSalarioBase(c)).toBe(true);
  });

  it.each([
    ["reglamento-iva-bienes-capital 31", BIENES_CAPITAL_31],
    ["reglamento-rts 2", RTS_2],
    ["reglamento-rts 3", RTS_3],
    [
      "reglamento-renta 22, the law with no amount",
      chunk(
        "reglamento-renta",
        "Artículo 22",
        "se entiende como salario base (*) la contenida en el artículo 2º de la ley Nº 7337.",
      ),
    ],
    ["the circular itself", SALARIO_BASE],
  ])("does not fire on %s", (_, c) => {
    expect(statesSanctionInSalariosBase(c)).toBe(false);
    expect(triggersSalarioBase(c)).toBe(false);
  });

  it("reads the law in the same chunk, not elsewhere in the set", () => {
    expect(statesAmountInSalariosBase(BIENES_CAPITAL_31)).toBe(true);
    expect(namesLey7337(LEY_IVA_8)).toBe(true);
    expect(triggersSalarioBase(BIENES_CAPITAL_31)).toBe(false);
  });
});

describe("salarioBaseDocKeys", () => {
  it("is the series entry the year serves, never a hard-coded year", () => {
    const keys = ["cnpt", "salario-base-2025", "salario-base-2026"];
    const withheld = noneWithheld({
      outOfPeriod: new Set(["salario-base-2025"]),
    });
    expect(salarioBaseDocKeys(withheld, keys)).toEqual(["salario-base-2026"]);
  });

  it("reads the manifest against #505's clock", () => {
    // 2026 is the manifest's one salario base year: served in 2026, withheld
    // in 2027 until next year's circular is ingested.
    expect(
      salarioBaseDocKeys(withheldSources(new Date("2026-06-01T12:00:00Z"))),
    ).toEqual(["salario-base-2026"]);
    expect(
      salarioBaseDocKeys(withheldSources(new Date("2027-01-02T12:00:00Z"))),
    ).toEqual([]);
  });
});

describe("salarioBaseChunks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const options = (lookup: SalarioBaseLookup) => ({
    salarioBaseLookup: lookup,
    withheld: noneWithheld(),
  });

  /** Runs the pin and returns what it appended and every outcome it told. */
  async function told(
    answerSet: readonly RetrievedChunk[],
    pool: readonly RetrievedChunk[],
    lookup: SalarioBaseLookup,
    withheld = noneWithheld(),
  ) {
    const outcomes: SalarioBaseOutcome[] = [];
    const found = await salarioBaseChunks(answerSet, pool, {
      salarioBaseLookup: lookup,
      withheld,
      onSalarioBase: (outcome) => outcomes.push(outcome),
    });
    return { found, outcomes };
  }

  it("looks the salario base up when a multa enters without it (#579)", async () => {
    const lookup = lookupOf(SALARIO_BASE);
    const found = await salarioBaseChunks(
      [UNRELATED, CNPT_79],
      [UNRELATED, CNPT_79],
      options(lookup),
    );
    expect(found).toEqual([SALARIO_BASE]);
    expect(lookup).toHaveBeenCalledWith(
      ["salario-base-2026"],
      expect.any(AbortSignal),
    );
  });

  it("takes the pool's chunk without a lookup", async () => {
    const lookup = lookupOf();
    const found = await salarioBaseChunks(
      [CNPT_79],
      [CNPT_79, SALARIO_BASE],
      options(lookup),
    );
    expect(found).toEqual([SALARIO_BASE]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("appends nothing when the set already holds it", async () => {
    const lookup = lookupOf(SALARIO_BASE);
    expect(
      await salarioBaseChunks([CNPT_79, SALARIO_BASE], [], options(lookup)),
    ).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("appends nothing to a set with no sanción in salarios base", async () => {
    const lookup = lookupOf(SALARIO_BASE);
    expect(
      await salarioBaseChunks([UNRELATED], [SALARIO_BASE], options(lookup)),
    ).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("appends at most one chunk", async () => {
    const found = await salarioBaseChunks(
      [CNPT_78, CNPT_79],
      [],
      options(lookupOf(SALARIO_BASE, { ...SALARIO_BASE, chunkId: "other" })),
    );
    expect(found).toHaveLength(1);
  });

  it("serves nothing of a year #505 withholds", async () => {
    const lookup = lookupOf(SALARIO_BASE);
    const found = await salarioBaseChunks([CNPT_79], [SALARIO_BASE], {
      salarioBaseLookup: lookup,
      withheld: noneWithheld({ outOfPeriod: new Set(["salario-base-2026"]) }),
    });
    expect(found).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("fails open, logged, when the lookup throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const found = await salarioBaseChunks([CNPT_79], [], {
      salarioBaseLookup: async () => {
        throw new Error("boom");
      },
      withheld: noneWithheld(),
    });
    expect(found).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(SALARIO_BASE_LOG_PREFIX),
    );
  });

  it("leaves Wave G's three triggers alone (#599)", async () => {
    for (const set of [[BIENES_CAPITAL_31], [RTS_2, RTS_3]]) {
      const lookup = lookupOf(SALARIO_BASE);
      expect(await told([UNRELATED, ...set], [SALARIO_BASE], lookup)).toEqual({
        found: [],
        outcomes: ["not_triggered"],
      });
      expect(lookup).not.toHaveBeenCalled();
    }
  });

  it("does not take the law from another chunk of the set (#599)", async () => {
    const reglamentoRenta22 = chunk(
      "reglamento-renta",
      "Artículo 22",
      "se entiende como salario base (*) la contenida en el artículo 2º de la ley Nº 7337.",
    );
    expect(
      await told([BIENES_CAPITAL_31, reglamentoRenta22], [], lookupOf()),
    ).toEqual({ found: [], outcomes: ["not_triggered"] });
  });

  it("looks the salario base up for an exemption threshold that names Ley 7337 (#591, #599)", async () => {
    const lookup = lookupOf(SALARIO_BASE);
    expect(await told([UNRELATED, LEY_IVA_8], [], lookup)).toEqual({
      found: [SALARIO_BASE],
      outcomes: ["appended"],
    });
  });

  describe("tells what it did, once (#591)", () => {
    it("not_triggered: no amount in salarios base", async () => {
      expect(await told([UNRELATED], [SALARIO_BASE], lookupOf())).toEqual({
        found: [],
        outcomes: ["not_triggered"],
      });
    });

    it("not_triggered: the circular alone triggers nothing", async () => {
      expect(await told([SALARIO_BASE], [], lookupOf())).toEqual({
        found: [],
        outcomes: ["not_triggered"],
      });
    });

    it("already_in_set", async () => {
      const lookup = lookupOf(SALARIO_BASE);
      expect(await told([LEY_IVA_8, SALARIO_BASE], [], lookup)).toEqual({
        found: [],
        outcomes: ["already_in_set"],
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it("appended, from the pool", async () => {
      expect(
        await told([CNPT_79], [CNPT_79, SALARIO_BASE], lookupOf()),
      ).toEqual({ found: [SALARIO_BASE], outcomes: ["appended"] });
    });

    it("appended, from the lookup", async () => {
      expect(await told([CNPT_79], [], lookupOf(SALARIO_BASE))).toEqual({
        found: [SALARIO_BASE],
        outcomes: ["appended"],
      });
    });

    it("missing: the year serves no circular", async () => {
      const lookup = lookupOf(SALARIO_BASE);
      expect(
        await told(
          [CNPT_79],
          [SALARIO_BASE],
          lookup,
          noneWithheld({ outOfPeriod: new Set(["salario-base-2026"]) }),
        ),
      ).toEqual({ found: [], outcomes: ["missing"] });
      expect(lookup).not.toHaveBeenCalled();
    });

    it("missing: the lookup answered with none of it", async () => {
      expect(await told([CNPT_79], [], lookupOf())).toEqual({
        found: [],
        outcomes: ["missing"],
      });
    });

    it("failed: the lookup threw", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(
        await told([CNPT_79], [], async () => {
          throw new Error("boom");
        }),
      ).toEqual({ found: [], outcomes: ["failed"] });
    });

    it("nothing under PIN_SALARIO_BASE=off", async () => {
      vi.stubEnv("PIN_SALARIO_BASE", "off");
      expect(await told([CNPT_79], [], lookupOf(SALARIO_BASE))).toEqual({
        found: [],
        outcomes: [],
      });
    });
  });

  it("appends nothing under PIN_SALARIO_BASE=off", async () => {
    vi.stubEnv("PIN_SALARIO_BASE", "off");
    const lookup = lookupOf(SALARIO_BASE);
    expect(
      await salarioBaseChunks([CNPT_79], [SALARIO_BASE], options(lookup)),
    ).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });
});
