import { describe, expect, it } from "vitest";
import { typoRuns } from "./typo";

describe("typoRuns", () => {
  it("finds the doubled initial letter that shipped (#490 item 3)", () => {
    expect(typoRuns("El monto ya ppagado se acredita [2].")).toEqual([
      "ppagado",
    ]);
  });

  it("finds a tripled letter and a doubled syllable", () => {
    expect(typoRuns("Debe deeeclarar y dedeclarar a tiempo.")).toEqual([
      "deeeclarar",
      "dedeclarar",
    ]);
  });

  it.each([
    // Roman numerals: incisos and transitorios.
    "Según el inciso iii) y el Transitorio XXX.",
    // Acronyms and addresses.
    "Consulte a la CCSS en https://www.ccss.sa.cr o en ccss.sa.cr.",
    // «ll» starts real words; «vivienda» starts with a real «vivi».
    "Debe llevar el registro de su vivienda.",
    // Doubled letters inside a word are Spanish.
    "La declaración se presenta en el periodo correcto: acción, perenne.",
  ])("leaves alone: %s", (text) => {
    expect(typoRuns(text)).toEqual([]);
  });

  it("reports each run once", () => {
    expect(typoRuns("ppagado y ppagado")).toEqual(["ppagado"]);
  });
});
