import { describe, expect, it } from "vitest";
import { cleanParagraphs, htmlToParagraphs, textToParagraphs } from "./extract";

describe("cleanParagraphs", () => {
  it("drops SINALEVI navigation chrome lines", () => {
    expect(
      cleanParagraphs([
        "Anterior",
        "Artículo 1.- Texto real.",
        "Siguiente",
        "Versión de la Norma",
        "Usted está en la 3 versión de esta norma",
      ]),
    ).toEqual(["Artículo 1.- Texto real."]);
  });

  it("strips inline Ficha Artículo markers but keeps the paragraph", () => {
    expect(
      cleanParagraphs(["Ficha Artículo 5 Artículo 5.- Contenido."]),
    ).toEqual(["Artículo 5.- Contenido."]);
  });

  it("collapses whitespace and drops empty paragraphs", () => {
    expect(cleanParagraphs(["  a \t b\n c  ", "   ", ""])).toEqual(["a b c"]);
  });
});

describe("htmlToParagraphs", () => {
  it("splits on block-level tags", () => {
    expect(
      htmlToParagraphs("<p>Primero.</p><div>Segundo.</div><h2>Tercero.</h2>"),
    ).toEqual(["Primero.", "Segundo.", "Tercero."]);
  });

  it("drops styles, scripts and comments whole", () => {
    expect(
      htmlToParagraphs(
        "<style>p { color: red }</style><script>var x = 1;</script><!-- nota --><p>Texto.</p>",
      ),
    ).toEqual(["Texto."]);
  });

  it("strips inline tags and decodes entities", () => {
    expect(htmlToParagraphs("<p><b>Art&iacute;culo</b> 1 &amp; 2</p>")).toEqual(
      ["Artículo 1 & 2"],
    );
  });

  it("returns [] for empty or chrome-only input", () => {
    expect(htmlToParagraphs("")).toEqual([]);
    expect(htmlToParagraphs("<p>Anterior</p><p>Siguiente</p>")).toEqual([]);
  });
});

describe("textToParagraphs", () => {
  it("splits on blank lines and joins wrapped lines with spaces", () => {
    expect(
      textToParagraphs("Primer párrafo\ncontinúa aquí.\n\nSegundo párrafo."),
    ).toEqual(["Primer párrafo continúa aquí.", "Segundo párrafo."]);
  });

  it("treats runs of blank lines as one boundary", () => {
    expect(textToParagraphs("Uno.\n\n\n\nDos.")).toEqual(["Uno.", "Dos."]);
  });

  it("returns [] for empty input", () => {
    expect(textToParagraphs("")).toEqual([]);
  });
});
