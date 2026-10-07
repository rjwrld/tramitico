import { describe, expect, it } from "vitest";
import {
  annualSeries,
  annualVigencia,
  coversFiscalYear,
  crFiscalYear,
  isWithheld,
  withheldSources,
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
    return docKeys.filter((docKey) => !isWithheld(withheld, docKey));
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
