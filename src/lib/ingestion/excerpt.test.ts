import { describe, expect, it } from "vitest";
import { sliceExcerpt } from "./excerpt";

const PAGE = [
  "“Artículo 23.- Aplicación de tarifas reducidas.",
  "",
  "(…)”",
  "",
  "“Artículo 31.-   Crédito aplicable respecto a bienes de capital.",
  "",
  "4) Cuando el valor de adquisición de un bien de capital supere los quince salarios base,",
  "",
  "    El ajuste en cada año deberá calcularse utilizando la siguiente fórmula:",
  "",
  "                          𝐶𝑎0 ‒ 𝐶𝑎𝑖",
  "                               4",
  "",
  "ARTÍCULO 2.- Adiciónese un inciso 46) al artículo 1, corriéndose la restante numeración",
  "",
  "46) Seguros de sobrevivencia. Son un tipo de seguros personales,",
].join("\n");

describe("sliceExcerpt", () => {
  it("keeps the lines from the `from` marker up to, but not including, `to`", () => {
    const out = sliceExcerpt(PAGE, {
      from: "Artículo 31.- Crédito aplicable respecto a bienes de capital",
      to: "ARTÍCULO 2.- Adiciónese un inciso 46)",
    });
    expect(out).toContain("𝐶𝑎0 ‒ 𝐶𝑎𝑖");
    expect(out).toContain("los quince salarios base");
    expect(out.startsWith("“Artículo 31.-")).toBe(true);
    expect(out).not.toContain("Aplicación de tarifas reducidas");
    expect(out).not.toContain("Seguros de sobrevivencia");
  });

  it("matches a marker across the run of spaces `pdftotext -layout` leaves", () => {
    const out = sliceExcerpt(PAGE, {
      from: "Artículo 31.- Crédito aplicable",
      to: "ARTÍCULO 2.-",
    });
    expect(out.startsWith("“Artículo 31.-")).toBe(true);
  });

  it("runs to the end of the text when `to` is omitted", () => {
    const out = sliceExcerpt(PAGE, { from: "ARTÍCULO 2.- Adiciónese" });
    expect(out).toContain("Seguros de sobrevivencia");
    expect(out).not.toContain("bienes de capital");
  });

  it("refuses a `from` marker no line carries", () => {
    expect(() =>
      sliceExcerpt(PAGE, { from: "Artículo 41.- Pagos a cuenta" }),
    ).toThrow(/no line carries/);
  });

  it("refuses a marker more than one line carries", () => {
    expect(() => sliceExcerpt(PAGE, { from: "Artículo" })).toThrow(
      /2 lines carry/,
    );
  });

  it("refuses a `to` marker that sits above `from`", () => {
    expect(() =>
      sliceExcerpt(PAGE, {
        from: "ARTÍCULO 2.- Adiciónese",
        to: "Artículo 31.- Crédito aplicable",
      }),
    ).toThrow(/above/);
  });
});
