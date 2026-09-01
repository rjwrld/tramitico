import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type ChunkOptions, chunkDocument } from "./chunker";
import { type ExcerptSpec, excerptSlices, sliceExcerpt } from "./excerpt";
import { textToParagraphs } from "./extract";

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

describe("excerptSlices", () => {
  it("reads one slice and a list of slices the same way", () => {
    const one = { from: "ARTÍCULO 2.-" };
    expect(excerptSlices(one)).toEqual([one]);
    expect(excerptSlices([one, { from: "ARTÍCULO 3.-" }])).toHaveLength(2);
  });

  it("keeps an empty list empty, for sliceExcerpt to refuse", () => {
    expect(excerptSlices([])).toEqual([]);
  });
});

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

  it("joins several slices in the order the manifest gives them", () => {
    const out = sliceExcerpt(PAGE, [
      {
        from: "Artículo 23.- Aplicación de tarifas reducidas",
        to: "“Artículo 31.-",
      },
      { from: "ARTÍCULO 2.- Adiciónese" },
    ]);
    expect(out).toContain("Aplicación de tarifas reducidas");
    expect(out).toContain("Seguros de sobrevivencia");
    expect(out).not.toContain("bienes de capital");
    expect(out.indexOf("tarifas reducidas")).toBeLessThan(
      out.indexOf("sobrevivencia"),
    );
  });

  it("refuses slices given out of document order", () => {
    expect(() =>
      sliceExcerpt(PAGE, [
        { from: "ARTÍCULO 2.- Adiciónese" },
        { from: "Artículo 23.- Aplicación de tarifas reducidas" },
      ]),
    ).toThrow(/overlap or are out of document order/);
  });

  it("refuses two bounded slices that overlap", () => {
    expect(() =>
      sliceExcerpt(PAGE, [
        {
          from: "Artículo 23.- Aplicación de tarifas reducidas",
          to: "ARTÍCULO 2.- Adiciónese",
        },
        { from: "“Artículo 31.-", to: "ARTÍCULO 2.- Adiciónese" },
      ]),
    ).toThrow(/overlap or are out of document order/);
  });

  it("allows two slices that meet exactly, with nothing dropped between", () => {
    const out = sliceExcerpt(PAGE, [
      { from: "Artículo 23.- Aplicación", to: "“Artículo 31.-" },
      { from: "“Artículo 31.-", to: "ARTÍCULO 2.- Adiciónese" },
    ]);
    expect(out).toContain("tarifas reducidas");
    expect(out).toContain("bienes de capital");
    expect(out).not.toContain("Seguros de sobrevivencia");
  });

  it("refuses an empty list of slices", () => {
    expect(() => sliceExcerpt(PAGE, [])).toThrow(/no slices/);
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

/**
 * The manifest's claim about `ccss-escala-salud`, run against the acta itself
 * (#198), and then all the way to the chunk a reader is served.
 *
 * The fixture is `pdftotext -layout -f 105 -l 108` of acta 8999, so the
 * markers are resolved exactly as ingestion resolves them and a marker that
 * has drifted fails here. It cannot notice a CCSS *re-publication* on its own
 * — nothing local can, until the PDF is re-fetched; `pnpm ingest` is what
 * catches that, and it throws on the same markers (scripts/ingest.ts).
 *
 * What the slices are for: pages 104–108 carry four tables and no page cut
 * separates them — Tabla N°2, «vigente hasta el 30 de setiembre de 2018»,
 * straddles the 104/105 break and the vigente Salud escala sits on 105 beside
 * its tail. Three slices keep the Salud escala and the four acuerdos while
 * dropping both superseded IVM figures: the 8.92% conjunta of the 2018 escala,
 * and the 1.24% Estado como tal in ACUERDO PRIMERO's notes. `ccss-escala-ivm`
 * answers for IVM, at 9.91% and 1.75%.
 */
describe("the ccss-escala-salud acta (#198)", () => {
  const acta = readFileSync(
    path.join(__dirname, "__fixtures__", "ccss-escala-salud-acta.txt"),
    "utf8",
  );
  const manifest = JSON.parse(
    readFileSync(path.join(process.cwd(), "corpus", "manifest.json"), "utf8"),
  ) as {
    documents: {
      doc_key: string;
      source: { pages?: string; excerpt?: unknown };
      chunking?: ChunkOptions;
    }[];
  };
  const doc = manifest.documents.find(
    (d) => d.doc_key === "ccss-escala-salud",
  )!;
  const spec = doc.source.excerpt as ExcerptSpec[];

  const excerpt = () => sliceExcerpt(acta, spec);

  /**
   * The whole pipeline the manifest drives, so an assertion here is about the
   * text a reader is actually served — not about an intermediate the chunker
   * still gets to rewrite. `articulo` chunking joins every paragraph with a
   * space, so the blank line between slices does not survive as a boundary.
   */
  const chunks = () =>
    chunkDocument(
      doc.doc_key,
      "CCSS — Escala Salud",
      textToParagraphs(excerpt()),
      doc.chunking!,
    );

  it("is the three slices the manifest records, over pages 105-108", () => {
    expect(doc.source.pages).toBe("105-108");
    expect(spec).toHaveLength(3);
    expect(() => excerpt()).not.toThrow();
  });

  it("keeps the vigente Salud escala, its brackets and its rates", () => {
    const out = excerpt();
    expect(out).toContain("De 0.9295 SM");
    expect(out).toContain("2.89%");
    expect(out).toContain("10.69%");
    expect(out).toContain("12.00%");
  });

  it("keeps the 0.25% Estado como tal this document is cited for", () => {
    expect(excerpt()).toContain(
      "la contribución del Estado como tal es de 0.25%",
    );
  });

  it("keeps all four acuerdos, the operative text of the artículo", () => {
    const out = excerpt();
    for (const a of ["PRIMERO", "SEGUNDO", "TERCERO", "CUARTO"]) {
      expect(out).toContain(`ACUERDO ${a}`);
    }
  });

  it("drops the escala superseded on 2018-09-30, and every figure in it", () => {
    const out = excerpt();
    expect(out).not.toContain("Tabla N°2");
    expect(out).not.toContain("0.8590 SM");
  });

  it("carries no page furniture inside a data row", () => {
    expect(excerpt()).not.toMatch(/10[45]\s+Nº 8999/);
  });

  it("stops before the unrelated Junta Directiva business below it", () => {
    const out = excerpt();
    expect(out).not.toContain("ARTICULO 31º");
    expect(out).not.toContain("MIPYMES");
    expect(out).not.toContain("Tabla N°1");
  });

  /**
   * The claim the manifest makes in words — «ccss-escala-ivm owns IVM» —
   * asserted on the served chunk, and on *both* the figures that claim
   * disqualifies. 8.92% is the 2018 conjunta (now 9.91%); 1.24% is the 2018
   * Estado como tal (now 1.75%), and it hides in a notes line whose other
   * half, the 0.25% Salud figure, is legitimately ours — which is why the
   * line is cut rather than kept, and why this test names the number.
   */
  it("serves one chunk carrying no IVM figure at all", () => {
    const served = chunks();
    expect(served).toHaveLength(1);
    expect(served[0].content).toContain("2.89%");
    expect(served[0].content).not.toContain("8.92");
    expect(served[0].content).not.toContain("1.24%");
  });
});
