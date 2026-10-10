import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { noneWithheld } from "../test-support/withheld";
import { withheldSources } from "../vigencia";
import {
  salarioBaseChunks,
  salarioBaseDocKeys,
  SALARIO_BASE_LOG_PREFIX,
  statesSanctionInSalariosBase,
  type SalarioBaseLookup,
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

  it("appends nothing under PIN_SALARIO_BASE=off", async () => {
    vi.stubEnv("PIN_SALARIO_BASE", "off");
    const lookup = lookupOf(SALARIO_BASE);
    expect(
      await salarioBaseChunks([CNPT_79], [SALARIO_BASE], options(lookup)),
    ).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });
});
