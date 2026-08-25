import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanParagraphs,
  findImageMarkup,
  htmlToParagraphs,
  imageMarkupWarning,
  textToParagraphs,
} from "./extract";

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

describe("findImageMarkup", () => {
  const fixture = (name: string) =>
    readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

  it("reports every image src and the table count (images-with-tables)", () => {
    const found = findImageMarkup(fixture("images-with-tables.html"));
    expect(found.tables).toBe(1);
    expect(found.srcs).toEqual([
      "https://sinalevi.go.cr/ImagenesSINALEVI\\Normativa\\2020-2029\\2024\\S_27_0_103276\\1701B7\\image007.jpg",
    ]);
  });

  it("reports zero tables for the #114 shape (images-without-tables)", () => {
    const found = findImageMarkup(fixture("images-without-tables.html"));
    expect(found.tables).toBe(0);
    expect(found.srcs).toHaveLength(1);
    expect(found.srcs[0]).toContain("image005.png");
  });

  it("is the signal htmlToParagraphs cannot give: the image leaves no trace", () => {
    // The regression #114 exists to catch — the announcing sentence and the
    // note that follows survive, with nothing between them.
    expect(htmlToParagraphs(fixture("images-without-tables.html"))).toEqual([
      "Establecer la siguiente escala contributiva:",
      "Notas:",
    ]);
  });

  it("matches images across line breaks and attribute order", () => {
    const found = findImageMarkup(
      '<p><img\n  v:shapes="x"\n  src="a.png"\n  width=2></p><img src=\'b.png\'>',
    );
    expect(found.srcs).toEqual(["a.png", "b.png"]);
  });

  it("keeps duplicate srcs — the count is of tags, not of files", () => {
    expect(
      findImageMarkup('<img src="a.png"><img src="a.png">').srcs,
    ).toHaveLength(2);
  });

  it("ignores images and tables inside styles, scripts and comments", () => {
    expect(
      findImageMarkup(
        '<style>.x { background: url(<img src="s.png">) }</style>' +
          '<script>var t = "<table>";</script>' +
          '<!-- <img src="c.png"><table> -->',
      ),
    ).toEqual({ srcs: [], tables: 0 });
  });

  it("returns nothing for a payload with no images", () => {
    expect(
      findImageMarkup("<p>Artículo 1.- Texto.</p><table></table>"),
    ).toEqual({ srcs: [], tables: 1 });
  });

  it("tolerates an image with no src attribute", () => {
    expect(findImageMarkup("<img>").srcs).toEqual([]);
  });
});

describe("imageMarkupWarning", () => {
  const fixture = (name: string) =>
    readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

  it("says nothing for a payload with no images", () => {
    expect(imageMarkupWarning("ley-iva", "<p>Artículo 1.</p>")).toBeNull();
  });

  it("names the doc, the count and every src when tables are present", () => {
    const warning = imageMarkupWarning(
      "disposiciones-v44",
      fixture("images-with-tables.html"),
    );
    expect(warning).toContain("disposiciones-v44");
    expect(warning).toContain("1 image");
    expect(warning).toContain("1 table");
    expect(warning).toContain("image007.jpg");
    expect(warning).toContain("#150");
  });

  it("is louder for the #114 shape: images and no table markup", () => {
    const warning = imageMarkupWarning(
      "ccss-bmc",
      fixture("images-without-tables.html"),
    );
    expect(warning).toContain("ccss-bmc");
    expect(warning).toContain("no table markup");
    expect(warning).toContain("#114");
    expect(warning).toContain("image005.png");
  });

  it("distinguishes the two shapes — the loud line appears only without tables", () => {
    const withTables = imageMarkupWarning(
      "a",
      fixture("images-with-tables.html"),
    );
    const without = imageMarkupWarning(
      "b",
      fixture("images-without-tables.html"),
    );
    expect(withTables).not.toContain("no table markup");
    expect(without).toContain("no table markup");
  });

  it("pluralises counts", () => {
    const one = imageMarkupWarning("a", '<img src="a.png"><table></table>');
    const two = imageMarkupWarning(
      "b",
      '<img src="a.png"><img src="b.png"><table></table><table></table>',
    );
    expect(one).toContain("1 image");
    expect(one).toContain("1 table");
    expect(two).toContain("2 images");
    expect(two).toContain("2 tables");
  });
});
