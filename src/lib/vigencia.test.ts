import { describe, expect, it } from "vitest";
import {
  annualSeries,
  annualVigencia,
  coversFiscalYear,
  crFiscalYear,
  withinFiscalYear,
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
    ).toEqual({ uncovered: [], dueForNextYear: [], expired: [] });
    expect(annualVigencia(TURN_OF_YEAR, crMidnight("2026-12-01"))).toEqual({
      uncovered: [],
      dueForNextYear: ["ccss-escala-salud"],
      expired: [],
    });
  });

  it("on 1 January gates the series nobody covered and lists what is left behind", () => {
    expect(annualVigencia(TURN_OF_YEAR, IN_2027)).toEqual({
      uncovered: ["ccss-escala-salud"],
      dueForNextYear: [],
      expired: ["tramos-renta-2026", "ccss-escala-salud"],
    });
  });
});

describe("withinFiscalYear", () => {
  const chunks = [
    { docKey: "ley-7092" },
    { docKey: "tramos-renta-2026" },
    { docKey: "tramos-renta-2027" },
    { docKey: "ccss-escala-salud" },
    { docKey: "fixture-not-in-the-manifest" },
  ];

  it("hands each fiscal year its own annual sources and no other", () => {
    expect(
      withinFiscalYear(chunks, crMidnight("2026-12-31"), TURN_OF_YEAR).map(
        (c) => c.docKey,
      ),
    ).toEqual([
      "ley-7092",
      "tramos-renta-2026",
      "ccss-escala-salud",
      "fixture-not-in-the-manifest",
    ]);
    expect(
      withinFiscalYear(chunks, IN_2027, TURN_OF_YEAR).map((c) => c.docKey),
    ).toEqual(["ley-7092", "tramos-renta-2027", "fixture-not-in-the-manifest"]);
  });

  it("drops a retired doc_key whatever the year", () => {
    const retiring = { ...TURN_OF_YEAR, retiredDocKeys: ["ley-7092"] };
    expect(
      withinFiscalYear(chunks, IN_2026, retiring).map((c) => c.docKey),
    ).not.toContain("ley-7092");
  });
});
