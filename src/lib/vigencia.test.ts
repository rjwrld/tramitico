import { describe, expect, it } from "vitest";
import {
  annualSeries,
  annualVigencia,
  coversFiscalYear,
  crFiscalYear,
  DATED_FACT_NOTICE_DAYS,
  datedFactLabel,
  datedFactVigencia,
  isWithheld,
  searchCount,
  withheldSources,
  withholdsAny,
  yearFigureLabel,
  yearFigureVigencia,
  type VigenciaManifest,
} from "./vigencia";

/** Costa Rica midnight, as an instant: CR is UTC-6 all year. */
const crMidnight = (date: string) => new Date(`${date}T06:00:00Z`);
const IN_2026 = crMidnight("2026-06-15");
const IN_2027 = crMidnight("2027-01-01");

describe("crFiscalYear", () => {
  it("turns over at Costa Rica's midnight, not UTC's", () => {
    expect(crFiscalYear(new Date("2027-01-01T05:59:59Z"))).toBe(2026);
    expect(crFiscalYear(new Date("2027-01-01T06:00:00Z"))).toBe(2027);
  });
});

describe("coversFiscalYear", () => {
  it("holds a dated entry to its own year", () => {
    const tramos = {
      doc_key: "tramos-renta-2026",
      effective_date: "2026-01-01",
    };
    expect(coversFiscalYear(tramos, 2025)).toBe(false);
    expect(coversFiscalYear(tramos, 2026)).toBe(true);
    expect(coversFiscalYear(tramos, 2027)).toBe(false);
  });

  it("runs an unchanged older rule through its verified year", () => {
    const salud = {
      doc_key: "ccss-escala-salud",
      effective_date: "2018-10-01",
      verifiedForFiscalYear: 2026,
    };
    expect(coversFiscalYear(salud, 2018)).toBe(true);
    expect(coversFiscalYear(salud, 2026)).toBe(true);
    expect(coversFiscalYear(salud, 2027)).toBe(false);
    // Carried over ahead, in December: still good for the year it is in.
    const carried = { ...salud, verifiedForFiscalYear: 2027 };
    expect(coversFiscalYear(carried, 2026)).toBe(true);
    expect(coversFiscalYear(carried, 2027)).toBe(true);
  });

  it("opens an undated entry at the start, and fails one with no year closed", () => {
    expect(
      coversFiscalYear(
        { doc_key: "ccss-bmc", verifiedForFiscalYear: 2026 },
        2026,
      ),
    ).toBe(true);
    expect(coversFiscalYear({ doc_key: "ccss-bmc" }, 2026)).toBe(false);
  });

  it("covers no year when the verified year precedes the effective one", () => {
    const muddled = {
      doc_key: "x",
      effective_date: "2027-01-01",
      verifiedForFiscalYear: 2026,
    };
    expect(coversFiscalYear(muddled, 2026)).toBe(false);
    expect(coversFiscalYear(muddled, 2027)).toBe(false);
  });
});

describe("annualSeries", () => {
  it("strips a trailing year and nothing else", () => {
    expect(annualSeries("tramos-renta-2027")).toBe("tramos-renta");
    expect(annualSeries("salarios-minimos")).toBe("salarios-minimos");
    expect(annualSeries("ley-10363")).toBe("ley-10363");
  });
});

/** This year's tramos, next year's beside it, and a carried-over escala. */
const TURN_OF_YEAR: VigenciaManifest = {
  documents: [
    { doc_key: "ley-7092", effective_date: "1988-04-21" },
    {
      doc_key: "tramos-renta-2026",
      effective_date: "2026-01-01",
      annualChurn: true,
    },
    {
      doc_key: "tramos-renta-2027",
      effective_date: "2027-01-01",
      annualChurn: true,
    },
    {
      doc_key: "ccss-escala-salud",
      effective_date: "2018-10-01",
      annualChurn: true,
      verifiedForFiscalYear: 2026,
    },
  ],
};

describe("annualVigencia", () => {
  it("is quiet through November, and from 1 December names what next year lacks", () => {
    expect(
      annualVigencia(TURN_OF_YEAR, new Date("2026-12-01T05:59:59Z")),
    ).toEqual({ uncovered: [], dueForNextYear: [], superseded: [] });
    expect(annualVigencia(TURN_OF_YEAR, crMidnight("2026-12-01"))).toEqual({
      uncovered: [],
      dueForNextYear: ["ccss-escala-salud"],
      superseded: [],
    });
  });

  it("on 1 January gates the series nobody covered and lists what a newer entry superseded", () => {
    // The escala is not superseded: nothing replaced it, so it is a
    // review (carry it over or replace it), and only the gate names it.
    expect(annualVigencia(TURN_OF_YEAR, IN_2027)).toEqual({
      uncovered: ["ccss-escala-salud"],
      dueForNextYear: [],
      superseded: ["tramos-renta-2026"],
    });
  });
});

describe("withheldSources", () => {
  const docKeys = [
    "ley-7092",
    "tramos-renta-2026",
    "tramos-renta-2027",
    "ccss-escala-salud",
    "fixture-not-in-the-manifest",
  ];
  const served = (now: Date, source: VigenciaManifest) => {
    const withheld = withheldSources(now, source);
    return docKeys.filter(
      (docKey) =>
        !isWithheld(withheld, { docKey, articulo: null, content: "" }),
    );
  };

  it("hands each fiscal year its own annual sources and no other", () => {
    expect(served(crMidnight("2026-12-31"), TURN_OF_YEAR)).toEqual([
      "ley-7092",
      "tramos-renta-2026",
      "ccss-escala-salud",
      "fixture-not-in-the-manifest",
    ]);
    expect(served(IN_2027, TURN_OF_YEAR)).toEqual([
      "ley-7092",
      "tramos-renta-2027",
      "fixture-not-in-the-manifest",
    ]);
  });

  it("withholds a retired doc_key whatever the year", () => {
    const retiring = { ...TURN_OF_YEAR, retiredDocKeys: ["ley-7092"] };
    expect(served(IN_2026, retiring)).not.toContain("ley-7092");
  });
});

/** The decree notes SINALEVI writes into Ley 7092 beside each year's figures. */
const NOTE_2026 = "a partir del 01 de enero del 2026";
const NOTE_2027 = "a partir del 01 de enero del 2027";
const art34 = (note: string) => ({
  docKey: "ley-renta",
  articulo: "ARTICULO 34",
  content: `ARTICULO 34.- Por cada hijo, la suma de … (decreto ejecutivo, ${note})`,
});

/** A source that is not annual, with one artículo stating 2026's figures. */
const LEY_RENTA: VigenciaManifest = {
  documents: [
    {
      doc_key: "ley-renta",
      yearFigures: [
        {
          articulo: "ARTICULO 34",
          fiscalYear: 2026,
          evidence: NOTE_2026,
        },
      ],
    },
  ],
};

/** The same artículo after the owner's bump to 2027. */
const LEY_RENTA_2027: VigenciaManifest = {
  documents: [
    {
      doc_key: "ley-renta",
      yearFigures: [
        { articulo: "ARTICULO 34", fiscalYear: 2027, evidence: NOTE_2027 },
      ],
    },
  ],
};

describe("year-figure artículos (#518)", () => {
  const articulos = ["ARTICULO 34", "ARTICULO 35", null];
  const served = (now: Date) => {
    const withheld = withheldSources(now, LEY_RENTA);
    return articulos.filter(
      (articulo) => !isWithheld(withheld, { ...art34(NOTE_2026), articulo }),
    );
  };

  it("withholds the artículo outside its fiscal year and leaves the rest of the source", () => {
    expect(served(IN_2026)).toEqual(articulos);
    expect(withholdsAny(withheldSources(IN_2026, LEY_RENTA))).toBe(false);

    expect(served(IN_2027)).toEqual(["ARTICULO 35", null]);
    expect(withholdsAny(withheldSources(IN_2027, LEY_RENTA))).toBe(true);
  });

  it("does not reach another source's artículo of the same name", () => {
    const withheld = withheldSources(IN_2027, LEY_RENTA);
    expect(
      isWithheld(withheld, { ...art34(NOTE_2026), docKey: "reglamento-renta" }),
    ).toBe(false);
  });

  it("warns from 1 December, and names what 1 January withheld", () => {
    expect(yearFigureVigencia(LEY_RENTA, crMidnight("2026-11-30"))).toEqual({
      withheld: [],
      dueForNextYear: [],
    });
    expect(
      yearFigureVigencia(
        LEY_RENTA,
        crMidnight("2026-12-01"),
      ).dueForNextYear.map(yearFigureLabel),
    ).toEqual(["ley-renta · ARTICULO 34 (2026)"]);
    expect(
      yearFigureVigencia(LEY_RENTA, IN_2027).withheld.map(yearFigureLabel),
    ).toEqual(["ley-renta · ARTICULO 34 (2026)"]);
    // Moved to next year's figures in December: withheld until 1 January,
    // which is right, and nothing to warn about.
    expect(
      yearFigureVigencia(LEY_RENTA_2027, crMidnight("2026-12-15")),
    ).toEqual({ withheld: [], dueForNextYear: [] });
    expect(
      isWithheld(
        withheldSources(crMidnight("2026-12-15"), LEY_RENTA_2027),
        art34(NOTE_2027),
      ),
    ).toBe(true);
  });

  /**
   * One doc_key across years means the manifest and the rows move at
   * different moments. Whichever lands first, text and declaration disagree,
   * and the chunk is withheld until the other catches up.
   */
  it("withholds a chunk whose text does not carry its declared evidence, in both directions", () => {
    // The bump merged and deployed; production still holds the 2026 text
    // until the owner's re-crawl, which runs only from merged main.
    expect(
      isWithheld(withheldSources(IN_2027, LEY_RENTA_2027), art34(NOTE_2026)),
    ).toBe(true);
    // The re-crawl landed the 2027 text; the bump has not merged yet.
    expect(
      isWithheld(withheldSources(IN_2027, LEY_RENTA), art34(NOTE_2027)),
    ).toBe(true);
    expect(
      isWithheld(
        withheldSources(crMidnight("2026-12-15"), LEY_RENTA),
        art34(NOTE_2027),
      ),
    ).toBe(true);
    // Both caught up.
    expect(
      isWithheld(withheldSources(IN_2027, LEY_RENTA_2027), art34(NOTE_2027)),
    ).toBe(false);
  });
});

/** The CCSS FAQ's condonación answer, as the 2026-09 crawl wrote it. */
const CONDONACION =
  "¿Hasta cuándo puedo solicitar la condonación de recargos, multas, intereses y facturas por servicios médicos en aplicación de la Ley N°10.232, sus ampliaciones y reglamento?";
const condonacion = (day: string) => ({
  docKey: "ccss-faq",
  articulo: CONDONACION,
  content: `La posibilidad de solicitar la condonación de recargos, multas, intereses y facturas por servicios médicos estará disponible hasta el día ${day}.`,
});

/** A source with one artículo stating a deadline. */
const CCSS_FAQ: VigenciaManifest = {
  documents: [
    {
      doc_key: "ccss-faq",
      datedFacts: [
        {
          articulo: CONDONACION,
          lastDay: "2026-11-11",
          evidence: "11 de noviembre del 2026",
        },
      ],
    },
  ],
};

describe("dated facts (#531)", () => {
  const served = (now: Date, chunk = condonacion("11 de noviembre del 2026")) =>
    !isWithheld(withheldSources(now, CCSS_FAQ), chunk);

  it("serves the fact through its last day, Costa Rica time, and withholds it from the next", () => {
    expect(served(IN_2026)).toBe(true);
    // 23:59:59 on 11 November in Costa Rica is already the 12th in UTC.
    expect(served(new Date("2026-11-12T05:59:59Z"))).toBe(true);
    expect(served(crMidnight("2026-11-12"))).toBe(false);
    expect(served(IN_2027)).toBe(false);
  });

  it("leaves the rest of the source, and other sources, alone", () => {
    const withheld = withheldSources(crMidnight("2026-11-12"), CCSS_FAQ);
    const chunk = condonacion("11 de noviembre del 2026");
    expect(
      isWithheld(withheld, { ...chunk, articulo: "¿Otra pregunta?" }),
    ).toBe(false);
    expect(
      isWithheld(withheld, { ...chunk, docKey: "ccss-reglamento-ti" }),
    ).toBe(false);
  });

  it("withholds a text that moved the date until the manifest moves with it", () => {
    // The CCSS extends the window; the re-crawl lands before the manifest PR.
    expect(served(IN_2026, condonacion("11 de mayo del 2027"))).toBe(false);
  });

  it("asks for one more row per fact past its last day, not twice the count", () => {
    expect(
      searchCount(withheldSources(crMidnight("2026-11-11"), CCSS_FAQ), 8),
    ).toBe(8);
    const after = withheldSources(crMidnight("2026-11-12"), CCSS_FAQ);
    expect(withholdsAny(after)).toBe(false);
    expect(searchCount(after, 8)).toBe(9);
    // Beside an out-of-period year figure, the doubling and the extra row add.
    expect(
      searchCount(
        withheldSources(IN_2027, {
          documents: [...CCSS_FAQ.documents, ...LEY_RENTA.documents],
        }),
        8,
      ),
    ).toBe(17);
  });

  it(`warns ${DATED_FACT_NOTICE_DAYS} days either side of the last day, then goes quiet`, () => {
    const label = "ccss-faq · " + CONDONACION + " (hasta 2026-11-11)";
    const read = (day: string) => {
      const { endingSoon, justEnded } = datedFactVigencia(
        CCSS_FAQ,
        crMidnight(day),
      );
      return {
        endingSoon: endingSoon.map(datedFactLabel),
        justEnded: justEnded.map(datedFactLabel),
      };
    };
    const quiet = { endingSoon: [], justEnded: [] };
    expect(read("2026-11-03")).toEqual(quiet);
    expect(read("2026-11-04")).toEqual({ endingSoon: [label], justEnded: [] });
    expect(read("2026-11-11")).toEqual({ endingSoon: [label], justEnded: [] });
    expect(read("2026-11-12")).toEqual({ endingSoon: [], justEnded: [label] });
    expect(read("2026-11-18")).toEqual({ endingSoon: [], justEnded: [label] });
    // Still withheld, but a closed window asks nothing more of anyone.
    expect(read("2026-11-19")).toEqual(quiet);
    expect(served(crMidnight("2026-11-19"))).toBe(false);
  });
});
