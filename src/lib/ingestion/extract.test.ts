import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanParagraphs,
  findImageMarkup,
  htmlToParagraphs,
  imageMarkupNotice,
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

  it("reads a two-column form as cells when the manifest says so (#199)", () => {
    const ficha = readFileSync(
      path.join(__dirname, "__fixtures__", "ccss-escala-ivm-rail.txt"),
      "utf8",
    );
    const spliced = textToParagraphs(ficha);
    expect(spliced.join("\n")).toMatch(/con la CONSIDERANDO aplicación/);

    const paragraphs = textToParagraphs(ficha, { labelRail: true });
    expect(paragraphs.join("\n")).not.toMatch(/con la CONSIDERANDO aplicación/);
    expect(paragraphs).toContain(
      "PROPUESTAS DE ACUERDO: • Afiliado: 0,16 p.p. • Estado (Cuota complementaria): 0,16 p.p. • Estado como Tal: 0,18 p.p.",
    );
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

describe("imageMarkupNotice", () => {
  const fixture = (name: string) =>
    readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

  const WITH_TABLES_SRC =
    "https://sinalevi.go.cr/ImagenesSINALEVI\\Normativa\\2020-2029\\2024\\S_27_0_103276\\1701B7\\image007.jpg";
  const WITHOUT_TABLES_SRC =
    "https://sinalevi.go.cr/ImagenesSINALEVI\\Normativa\\2010-2019\\2017\\D_0_0_87782\\1A2B3C\\image005.png";

  it("says nothing for a payload with no images", () => {
    expect(imageMarkupNotice("ley-iva", "<p>Artículo 1.</p>")).toBeNull();
  });

  it("names the doc, the count and every src when tables are present", () => {
    const notice = imageMarkupNotice(
      "disposiciones-v44",
      fixture("images-with-tables.html"),
    );
    expect(notice?.level).toBe("warn");
    expect(notice?.message).toContain("disposiciones-v44");
    expect(notice?.message).toContain("1 image");
    expect(notice?.message).toContain("1 table");
    expect(notice?.message).toContain("image007.jpg");
    expect(notice?.message).toContain("#150");
  });

  it("is louder for the #114 shape: images and no table markup", () => {
    const notice = imageMarkupNotice(
      "ccss-bmc",
      fixture("images-without-tables.html"),
    );
    expect(notice?.level).toBe("warn");
    expect(notice?.message).toContain("ccss-bmc");
    expect(notice?.message).toContain("no table markup");
    expect(notice?.message).toContain("#114");
    expect(notice?.message).toContain("image005.png");
  });

  it("distinguishes the two shapes — the loud line appears only without tables", () => {
    const withTables = imageMarkupNotice(
      "a",
      fixture("images-with-tables.html"),
    );
    const without = imageMarkupNotice(
      "b",
      fixture("images-without-tables.html"),
    );
    expect(withTables?.message).not.toContain("no table markup");
    expect(without?.message).toContain("no table markup");
  });

  it("pluralises counts", () => {
    const one = imageMarkupNotice("a", '<img src="a.png"><table></table>');
    const two = imageMarkupNotice(
      "b",
      '<img src="a.png"><img src="b.png"><table></table><table></table>',
    );
    expect(one?.message).toContain("1 image");
    expect(one?.message).toContain("1 table");
    expect(two?.message).toContain("2 images");
    expect(two?.message).toContain("2 tables");
  });

  describe("imagesAudited (#177)", () => {
    it("shape 1 — every payload image audited: one quiet line, no src list", () => {
      const notice = imageMarkupNotice(
        "disposiciones-v44",
        fixture("images-with-tables.html"),
        [WITH_TABLES_SRC],
      );
      expect(notice).toEqual({
        level: "info",
        message: "disposiciones-v44: 1 image, audited (#150)",
      });
    });

    it("shape 1 — the audited set may be a superset, and duplicates count once", () => {
      const notice = imageMarkupNotice(
        "d",
        '<img src="a.png"><img src="a.png"><table></table>',
        ["a.png", "b.png"],
      );
      expect(notice).toEqual({
        level: "info",
        message: "d: 2 images, audited (#150)",
      });
    });

    it("shape 2 — an unaudited image restores the full warning and names it", () => {
      const html =
        fixture("images-with-tables.html") + '<p><img src="image042.png"></p>';
      const notice = imageMarkupNotice("disposiciones-v44", html, [
        WITH_TABLES_SRC,
      ]);
      expect(notice?.level).toBe("warn");
      // The full warning, unchanged: headline, count, and every src.
      expect(notice?.message).toContain("2 images");
      expect(notice?.message).toContain("1 table");
      expect(notice?.message).toContain("image007.jpg");
      // Plus the drift call-out, naming only what the audit never saw.
      expect(notice?.message).toContain("#177");
      expect(notice?.message).toContain("not in the audited set");
      expect(notice?.message).toContain("image042.png");
    });

    it("shape 2 — drift keeps the loud #114 headline when there are no tables", () => {
      const notice = imageMarkupNotice(
        "ccss-bmc",
        fixture("images-without-tables.html"),
        ["some-other-image.png"],
      );
      expect(notice?.level).toBe("warn");
      expect(notice?.message).toContain("no table markup");
      expect(notice?.message).toContain("not in the audited set");
      expect(notice?.message).toContain(WITHOUT_TABLES_SRC);
    });

    it("shape 2 — an empty audited list is drift, not a clean bill of health", () => {
      const notice = imageMarkupNotice(
        "ccss-bmc",
        fixture("images-without-tables.html"),
        [],
      );
      expect(notice?.level).toBe("warn");
      expect(notice?.message).toContain("not in the audited set");
    });

    it("shape 3 — no audited list at all leaves the warning untouched", () => {
      const withList = imageMarkupNotice(
        "ccss-bmc",
        fixture("images-without-tables.html"),
        ["x.png"],
      );
      const without = imageMarkupNotice(
        "ccss-bmc",
        fixture("images-without-tables.html"),
      );
      expect(without?.level).toBe("warn");
      expect(without?.message).not.toContain("audited");
      // Same headline and src list; only the drift call-out differs.
      expect(withList?.message).toContain(without!.message);
    });

    it("says nothing for an audited doc whose payload lost its images", () => {
      expect(
        imageMarkupNotice("d", "<p>Artículo 1.</p>", ["a.png"]),
      ).toBeNull();
    });
  });
});
