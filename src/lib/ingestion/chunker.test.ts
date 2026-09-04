import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToParagraphs, textToParagraphs } from "./extract";
import {
  assertChunksCarryContent,
  chunkDocument,
  chunkQuestions,
  type Chunk,
} from "./chunker";

const SAMPLES = path.resolve(__dirname, "../../../docs/corpus-samples");

function loadHtml(file: string): string {
  return readFileSync(path.join(SAMPLES, file), "utf8");
}

describe("htmlToParagraphs", () => {
  it("strips SINALEVI navigation chrome", () => {
    const paras = htmlToParagraphs(
      loadHtml("ley-10363-trabajador-independiente.html"),
    );
    const joined = paras.join("\n");
    expect(joined).not.toMatch(/Usted está en la/);
    expect(joined).not.toMatch(/Ficha Art[íi]culo/);
    expect(joined).toMatch(/ASAMBLEA LEGISLATIVA/);
  });
});

describe("chunkDocument — Ley 10.363 (small, article-structured)", () => {
  const chunks = chunkDocument(
    "ley-10363",
    "Ley del Trabajador Independiente (Ley 10.363)",
    htmlToParagraphs(loadHtml("ley-10363-trabajador-independiente.html")),
  );

  it("finds the prescripción artículo as its own chunk", () => {
    const art2 = chunks.find((c) => /ART[ÍI]CULO 2/i.test(c.articulo ?? ""));
    expect(art2).toBeDefined();
    expect(art2!.content).toMatch(/prescripción/i);
    expect(art2!.content).toMatch(/cuatro años|4 años/i);
  });

  // SPEC §4 rule 3: the title block ("Ley 10363 / N° 10363 / LA ASAMBLEA
  // LEGISLATIVA … DECRETA: / LEY DEL TRABAJADOR INDEPENDIENTE") is doc
  // metadata. This ley carries no considerandos, so it has no preámbulo at
  // all — and the boilerplate must not become a retrievable chunk (#216).
  it("drops the title block instead of emitting it as an untagged chunk", () => {
    expect(chunks.some((c) => /ASAMBLEA LEGISLATIVA/.test(c.content))).toBe(
      false,
    );
  });

  it("emits no preámbulo chunk when there are no considerandos", () => {
    expect(chunks.some((c) => c.articulo === "Preámbulo")).toBe(false);
  });

  it("captures transitorios as chunks", () => {
    expect(chunks.some((c) => /^Transitorio/i.test(c.articulo ?? ""))).toBe(
      true,
    );
  });

  it("prepends the context header to every chunk", () => {
    for (const c of chunks) {
      expect(c.content.startsWith("[Ley del Trabajador Independiente")).toBe(
        true,
      );
    }
  });

  // #237 defect 1: each capítulo's caption arrives on its own line and used
  // to flush as an untagged chunk of its own.
  it("keeps capítulo captions as path context, not as chunks", () => {
    expect(chunks.every((c) => c.articulo !== null)).toBe(true);
    const paths = new Set(chunks.flatMap((c) => c.path));
    expect(paths).toContain("CAPÍTULO I TRABAJADORES INDEPENDIENTES");
    expect(paths).toContain("CAPÍTULO II DISPOSICIONES TRANSITORIAS");
  });
});

describe("chunkQuestions — TRIBU-CR FAQ", () => {
  const fixture = textToParagraphs(
    readFileSync(
      path.resolve(__dirname, "__fixtures__/tribu-cr-faq-pages-31-33.txt"),
      "utf8",
    ),
  );
  // These three source pages start mid-section, so the preceding printed
  // section heading is supplied as the first paragraph of the fixture input.
  const chunks = chunkQuestions(
    "tribu-cr-faq",
    "Preguntas y respuestas TRIBU-CR y la OVi",
    ["Declaraciones y Pagos", ...fixture],
    14,
  );

  it("makes each printed question one chunk under its section", () => {
    expect(chunks).toHaveLength(14);
    expect(chunks.map((chunk) => chunk.articulo)).toEqual(
      Array.from(
        { length: 14 },
        (_, index) => `Declaraciones del RUT · ${index + 29}`,
      ),
    );
    expect(
      chunks.every((chunk) => chunk.path[0] === "Declaraciones del RUT"),
    ).toBe(true);
  });

  it("keeps the heading and answer together without leaking adjacent answers", () => {
    const question31 = chunks.find(
      (chunk) => chunk.articulo === "Declaraciones del RUT · 31",
    );
    expect(question31?.content).toContain(
      "¿Dónde se hace la solicitud para desinscribirse",
    );
    expect(question31?.content).toContain("Solicitar desinscripción");
    expect(question31?.content).not.toContain("barra de navegación");
  });

  it("removes page furniture fused to a question boundary", () => {
    const question34 = chunks.find(
      (chunk) => chunk.articulo === "Declaraciones del RUT · 34",
    );
    expect(question34?.content).toMatch(/\] 34\. ¿Qué tipo/);
    expect(question34?.content).not.toMatch(/\] 31 34\./);
  });

  it("fails loudly below the configured question-count floor", () => {
    expect(() =>
      chunkQuestions(
        "tribu-cr-faq",
        "Preguntas y respuestas TRIBU-CR y la OVi",
        ["Declaraciones y Pagos", ...fixture],
        150,
      ),
    ).toThrow(/found 14 question headings; expected at least 150/);
  });

  it("infers the source's one omitted number only across a confirmed gap", () => {
    const malformed = chunkQuestions(
      "tribu-cr-faq",
      "FAQ",
      [
        "Declaraciones y Pagos",
        "5. ¿Cuáles campos son obligatorios? Todos los no optativos.",
        "¿Cómo se valida el correo? Se genera un código.",
        "7. ¿Cómo elijo notificaciones? En el formulario.",
      ],
      3,
    );
    expect(malformed.map((chunk) => chunk.articulo)).toEqual([
      "Declaraciones del RUT · 5",
      "Declaraciones del RUT · 6",
      "Declaraciones del RUT · 7",
    ]);
  });

  it("flushes the previous question before an inline page-numbered section", () => {
    const boundary = chunkQuestions(
      "tribu-cr-faq",
      "FAQ",
      [
        "Consulta Integral Hacendaria (CIH) vista OVi",
        "28. ¿Qué es una acreditación? Es un permiso.",
        "23 Cuenta Integral Tributaria 1. ¿Puedo ver mis deudas? Sí.",
        "2. ¿Se migraron los créditos? No todos.",
      ],
      3,
    );
    expect(boundary.map((chunk) => chunk.articulo)).toEqual([
      "Consulta Integral Hacendaria (CIH) vista OVi · 28",
      "Cuenta Integral Tributaria · 1",
      "Cuenta Integral Tributaria · 2",
    ]);
  });
});

describe("chunkDocument — Reglamento IVA (71 artículos, 1.5MB)", () => {
  const chunks: Chunk[] = chunkDocument(
    "reglamento-iva",
    "Reglamento de la Ley del IVA (Decreto 41779)",
    htmlToParagraphs(loadHtml("reglamento-iva-vigente.html")),
  );

  it("produces one chunk per artículo plus sub-splits (order of magnitude)", () => {
    expect(chunks.length).toBeGreaterThan(80);
    expect(chunks.length).toBeLessThan(220);
  });

  it("finds Artículo 11 (exenciones — the exportación target)", () => {
    const art11 = chunks.filter((c) => c.articulo === "Artículo 11");
    expect(art11.length).toBeGreaterThan(0);
    expect(art11[0].content).toMatch(/exen/i);
  });

  it("sub-splits long artículos with parts keeping the label", () => {
    const labeledParts = chunks.filter(
      (c) => c.part > 0 && c.articulo !== null,
    );
    expect(labeledParts.length).toBeGreaterThan(0);
    for (const c of labeledParts) {
      const sibling = chunks.find(
        (s) => s.articulo === c.articulo && s.part === 0,
      );
      expect(sibling).toBeDefined();
    }
  });

  it("tracks capítulo path context", () => {
    const withPath = chunks.filter((c) => c.path.length > 0);
    expect(withPath.length).toBeGreaterThan(chunks.length / 2);
  });

  it("never leaks navigation chrome into content", () => {
    for (const c of chunks) {
      expect(c.content).not.toMatch(/Usted está en la/);
    }
  });

  // #216: the considerandos used to be flushed as an untagged chunk the
  // moment the enacting formula appeared, and the "Preámbulo" label landed on
  // the title block instead. One preámbulo identity carrying the recitals —
  // since #237 stopped the wrapped "Título I," fragment truncating them, they
  // run long enough to sub-split, so parts share the label.
  it("tags the considerandos as the single preámbulo identity", () => {
    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble.length).toBeGreaterThan(0);
    expect(preamble.map((c) => c.part)).toEqual(preamble.map((_, i) => i));
    const joined = preamble.map((c) => c.content).join(" ");
    expect(joined).toMatch(/Con fundamento en las atribuciones/);
    expect(joined).toMatch(/Considerando/);
    // The tail the false heading used to cut off (considerando XIII).
    expect(joined).toMatch(/estandarizar el tratamiento de los créditos/);
  });

  // #237 defect 1: 18 chunks of this document were nothing but a heading's
  // caption line ("EXENCIONES Y NO SUJECIONES", "De la determinación del
  // impuesto"). SPEC §4 rule 1 makes the artículo the unit — with captions
  // merged into their headings and the preámbulo tagged, nothing untagged
  // remains.
  it("emits no untagged chunk (captions belong to their headings)", () => {
    expect(chunks.every((c) => c.articulo !== null)).toBe(true);
  });

  // #237 defect 2: the considerandos wrap a sentence so that a paragraph
  // starts "Título I," — it used to be matched as the level-0 heading and
  // poisoned every chunk's path in the document.
  it("keeps the wrapped 'Título I,' considerando fragment off every path", () => {
    for (const c of chunks) {
      expect(c.path.join(" ")).not.toMatch(/Título I, a un nuevo marco/);
    }
  });

  it("keeps the title block out of the preámbulo and out of every chunk", () => {
    expect(
      chunks.some((c) =>
        /EL PRESIDENTE DE LA REPÚBLICA Y LA MINISTRA DE HACIENDA/.test(
          c.content,
        ),
      ),
    ).toBe(false);
  });
});

describe("chunkDocument — inline artículo headings (Ley IVA shape, ADR 0002 amendment)", () => {
  // Ley IVA's consolidated text glues the capítulo heading and the first
  // artículo into one extracted paragraph; before the inline pre-split this
  // produced whole-capítulo blobs with articulo=null (found during ADR 0003).
  const paras = [
    "N° 6826 LA ASAMBLEA LEGISLATIVA DECRETA: LEY DEL IMPUESTO AL VALOR AGREGADO",
    "CAPÍTULO III EXENCIONES Y TASA DEL IMPUESTO Artículo 8- Exenciones. Están exentos del pago de este impuesto: 1. Las exportaciones de bienes y la exportación de servicios.",
    "Artículo 9- Tasa. La tarifa del impuesto es del trece por ciento (13%).",
  ];
  const chunks = chunkDocument("ley-iva", "Ley del IVA", paras);

  it("splits the glued capítulo paragraph at the artículo heading", () => {
    const art8 = chunks.find((c) => c.articulo === "Artículo 8");
    expect(art8).toBeDefined();
    expect(art8!.content).toMatch(/exportación de servicios/);
    expect(art8!.path).toEqual(["CAPÍTULO III EXENCIONES Y TASA DEL IMPUESTO"]);
  });

  it("keeps plain paragraph-start headings working", () => {
    expect(chunks.some((c) => c.articulo === "Artículo 9")).toBe(true);
  });

  it("rejoins headings fragmented across paragraphs (real Ley IVA markup)", () => {
    const fragmented = chunkDocument("ley-iva", "Ley del IVA", [
      "CAPÍTULO",
      "III",
      "EXENCIONES",
      "Y TASA DEL IMPUESTO",
      "Artículo",
      "8- Exenciones. Están exentos del pago de este impuesto la exportación de servicios.",
    ]);
    const art8 = fragmented.find((c) => c.articulo === "Artículo 8");
    expect(art8).toBeDefined();
    expect(art8!.path).toEqual(["CAPÍTULO III EXENCIONES Y TASA DEL IMPUESTO"]);
  });

  it("does not split on mid-sentence references without a delimiter", () => {
    const withRef = chunkDocument("x", "X", [
      "Artículo 3- Remite a lo dispuesto en el Artículo 8 de esta ley para las exenciones.",
    ]);
    expect(withRef).toHaveLength(1);
    expect(withRef[0].articulo).toBe("Artículo 3");
  });
});

describe("chunkDocument — Ley 7092 consolidada", () => {
  const fixture = readFileSync(
    path.resolve(__dirname, "__fixtures__/ley-renta-articulo-8.html"),
    "utf8",
  );
  const chunks = chunkDocument(
    "ley-renta",
    "Ley del Impuesto sobre la Renta (texto consolidado)",
    htmlToParagraphs(fixture),
  );

  it("keeps the Ley 10818 optional 25% deduction in Artículo 8 (#268)", () => {
    const art8 = chunks.find(
      (chunk) => chunk.articulo?.toLowerCase() === "articulo 8",
    );
    expect(art8).toBeDefined();
    expect(art8!.content).toContain("veinticinco por ciento (25%)");
    expect(art8!.content).toContain("ley N° 10818");
  });
});

describe("chunkDocument — lowercase in-sentence heading words (RES-0027-2024 shape)", () => {
  // The disposiciones-v44 text fragments considerando X so that a line starting
  // with lowercase 'sección "Propuestas en consulta pública", antes de su
  // dictado' arrives as its own paragraph; matching it as a SECCIÓN heading
  // mislabeled 25 vigente chunks as draft-stage in their citation path. Same
  // rule as ART_RE: real headings are capitalized, in-sentence references are
  // not.
  it("does not treat a lowercase sección fragment as a heading", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 1- El proyecto se publicó en el sitio Web, en la",
      'sección "Propuestas en consulta pública", antes de su dictado',
      "definitivo. Artículo 2- Vigencia. Rige a partir de su publicación.",
    ]);
    for (const c of chunks) {
      expect(c.path).toEqual([]);
    }
    expect(chunks.some((c) => c.articulo === "Artículo 2")).toBe(true);
  });

  it("still treats capitalized SECCIÓN headings as path context", () => {
    const chunks = chunkDocument("x", "X", [
      "SECCIÓN II DE LOS COMPROBANTES",
      "Artículo 4- Los comprobantes electrónicos deberán emitirse.",
    ]);
    const art4 = chunks.find((c) => c.articulo === "Artículo 4");
    expect(art4!.path).toEqual(["SECCIÓN II DE LOS COMPROBANTES"]);
  });

  it("does not rejoin a lowercase fragmented heading word", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 1- Los campos de la",
      "sección",
      "5.6 del anexo aplican a la factura electrónica.",
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].path).toEqual([]);
  });
});

describe("chunkDocument — heading shape (#237 defect 2)", () => {
  // reglamento-iva's considerandos line-wrap so that a sentence fragment
  // arrives as its own paragraph starting "Título I,". Matching it as a
  // TÍTULO heading truncated the preámbulo mid-considerando and, because
  // TÍTULO is level 0, put the fragment on every chunk's path.
  it("does not treat a wrapped 'Título I,' sentence fragment as a heading", () => {
    const chunks = chunkDocument("x", "X", [
      "Considerando:",
      "II.- Que mediante la Ley N° 9635 el legislador migró, en su",
      "Título I, a un nuevo marco normativo, denominado Ley del Impuesto sobre el",
      "Valor Agregado, el cual se encuentra regulado en la citada Ley.",
      "Por tanto, decreta:",
      "CAPÍTULO I DISPOSICIONES GENERALES",
      "Artículo 1- Objeto.",
    ]);
    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble).toHaveLength(1);
    expect(preamble[0].content).toMatch(/nuevo marco normativo/);
    expect(preamble[0].content).toMatch(/Valor Agregado/);
    for (const c of chunks) {
      expect(c.path.join(" ")).not.toMatch(/nuevo marco normativo/);
    }
  });

  // The same class from the committed corpus index: mixed-case in-sentence
  // references that the first-letter case rule alone does not catch.
  it("does not treat other in-sentence Título/Capítulo/Sección references as headings", () => {
    const fragments = [
      "Título supra citado.",
      "Título I de la Ley deben llevar, para el adecuado control de sus operaciones,",
      "Capítulo XI de la Ley del Impuesto sobre la Renta, deberá manifestar la",
      'Sección VIII denominada "De las devoluciones", ambos del Capítulo',
    ];
    for (const fragment of fragments) {
      const chunks = chunkDocument("x", "X", [
        "Artículo 1- Los contribuyentes citados en el",
        fragment,
        "presentarán la declaración. Artículo 2- Vigencia. Rige a partir de su publicación.",
      ]);
      expect(chunks.every((c) => c.path.length === 0)).toBe(true);
      expect(chunks.some((c) => c.articulo === "Artículo 2")).toBe(true);
    }
  });

  // The dangling-end guard is not just the corpus's observed endings: any
  // lowercase function word (prepositions included) marks a wrapped sentence.
  it("rejects an uppercase-opening fragment that dangles on a preposition", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 1- La retención se practicará conforme al",
      "Título IV Ley de Fortalecimiento de las Finanzas Públicas según",
      "lo dispuesto por la Administración. Artículo 2- Vigencia.",
    ]);
    expect(chunks.every((c) => c.path.length === 0)).toBe(true);
  });

  it("recognises a heading whose caption is glued to the ordinal's punctuation", () => {
    const chunks = chunkDocument("x", "X", [
      "SECCIÓN I.De la determinación del impuesto",
      "Artículo 20- Determinación.",
    ]);
    expect(chunks[0].path).toEqual([
      "SECCIÓN I.De la determinación del impuesto",
    ]);
  });

  it("recognises the feminine ÚNICA ordinal", () => {
    const chunks = chunkDocument("x", "X", [
      "SECCIÓN ÚNICA",
      "Artículo 1- Objeto.",
    ]);
    expect(chunks[0].path).toEqual(["SECCIÓN ÚNICA"]);
  });

  it("still treats real heading lines with ordinal and caption as headings", () => {
    const chunks = chunkDocument("x", "X", [
      "TÍTULO II",
      "CAPITULO UNICO",
      "Artículo 4- Objeto.",
      "CAPÍTULO Vl",
      "Artículo 5- Ámbito.",
      "Sección I",
      "Artículo 6- Alcance.",
    ]);
    expect(chunks.find((c) => c.articulo === "Artículo 4")!.path).toEqual([
      "TÍTULO II",
      "CAPITULO UNICO",
    ]);
    expect(chunks.find((c) => c.articulo === "Artículo 5")!.path).toEqual([
      "TÍTULO II",
      "CAPÍTULO Vl",
    ]);
    expect(chunks.find((c) => c.articulo === "Artículo 6")!.path).toEqual([
      "TÍTULO II",
      "CAPÍTULO Vl",
      "Sección I",
    ]);
  });
});

describe("chunkDocument — heading captions (#237 defect 1)", () => {
  // A caption on its own line belongs to its heading, not to a chunk of its
  // own: it carries no citable artículo and duplicates what the context
  // header already puts on the real chunks.
  it("merges an ALL-CAPS caption line into the heading", () => {
    const chunks = chunkDocument("x", "X", [
      "CAPÍTULO I",
      "TRABAJADORES INDEPENDIENTES",
      "Artículo 1- Definiciones.",
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].articulo).toBe("Artículo 1");
    expect(chunks[0].path).toEqual(["CAPÍTULO I TRABAJADORES INDEPENDIENTES"]);
  });

  it("merges a title-case caption line into the heading", () => {
    const chunks = chunkDocument("x", "X", [
      "CAPÍTULO VIII",
      "SECCION I",
      "De la determinación del impuesto",
      "Artículo 20- Determinación.",
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].path).toEqual([
      "CAPÍTULO VIII",
      "SECCION I De la determinación del impuesto",
    ]);
  });

  // ley-9635's transitorio capítulos: the caption names the reformed ley
  // ("LEY N.° 7092"), so it carries periods and runs past 20 words — but an
  // ALL-CAPS line can never be body prose in these documents, only a caption
  // (or the title block, which front matter already strips).
  it("merges a long ALL-CAPS caption with N.° abbreviations", () => {
    const chunks = chunkDocument("x", "X", [
      "CAPÍTULO II",
      "DISPOSICIONES TRANSITORIAS AL TÍTULO II DE LA PRESENTE LEY,",
      "REFORMAS DE LA LEY N.° 7092, LEY DEL IMPUESTO SOBRE LA RENTA",
      "Transitorio I- Los contribuyentes se ajustarán.",
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].articulo).toBe("Transitorio I");
    expect(chunks[0].path).toEqual([
      "CAPÍTULO II DISPOSICIONES TRANSITORIAS AL TÍTULO II DE LA PRESENTE LEY, REFORMAS DE LA LEY N.° 7092, LEY DEL IMPUESTO SOBRE LA RENTA",
    ]);
  });

  it("does not absorb a following heading line as a caption", () => {
    const chunks = chunkDocument("x", "X", [
      "CAPÍTULO VIII",
      "SECCION I",
      "Artículo 20- Determinación.",
    ]);
    expect(chunks[0].path).toEqual(["CAPÍTULO VIII", "SECCION I"]);
  });

  it("does not absorb prose after a heading", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 1- Objeto.",
      "CAPÍTULO II",
      "La Administración Tributaria dispondrá lo necesario para el control.",
      "Artículo 2- Control.",
    ]);
    const art2 = chunks.find((c) => c.articulo === "Artículo 2");
    expect(art2!.path).toEqual(["CAPÍTULO II"]);
    expect(chunks.some((c) => /dispondrá lo necesario/.test(c.content))).toBe(
      true,
    );
  });
});

describe("chunkDocument — artículo suffixes (#274)", () => {
  // Costa Rican legislative practice numbers amendments well past `ter`, and
  // an unrecognised suffix does not leave a chunk unlabelled — it labels a
  // distinct artículo with its neighbour's número, which is a confidently
  // wrong citation.
  it("labels ordinal suffixes past ter as their own artículo", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 2- Definiciones.",
      "Artículo 2 quater - Pertenencia a grupo multinacional.",
      "Artículo 2 quinquies- Cláusula específica antiabuso.",
      "Artículo 27 quáter - Reorganización empresarial.",
      "Artículo 31 sexies - Otra cosa.",
      "Artículo 31 septies - Y otra.",
    ]);
    expect(chunks.map((c) => c.articulo)).toEqual([
      "Artículo 2",
      "Artículo 2 quater",
      "Artículo 2 quinquies",
      "Artículo 27 quáter",
      "Artículo 31 sexies",
      "Artículo 31 septies",
    ]);
  });

  it("labels letter suffixes as their own artículo", () => {
    const chunks = chunkDocument("x", "X", [
      "ARTICULO 66.-Los contratos de exportación.",
      "ARTICULO 66-B .-(ANULADO por Resolución de la Sala Constitucional).",
      "ARTICULO 66-C.-Los Certificados de Abono Tributario.",
      "ARTICULO 66-CH.-Las personas físicas o jurídicas.",
      "ARTICULO 66-D.- a) El Consejo Nacional.",
    ]);
    expect(chunks.map((c) => c.articulo)).toEqual([
      "ARTICULO 66",
      "ARTICULO 66-B",
      "ARTICULO 66-C",
      "ARTICULO 66-CH",
      "ARTICULO 66-D",
    ]);
  });

  // A caption opening in uppercase is not a letter suffix: "Artículo 8-
  // Exenciones" must stay artículo 8.
  it("does not read a capitalized caption as a letter suffix", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 8-Exenciones. Están exentas las siguientes operaciones.",
    ]);
    expect(chunks[0].articulo).toBe("Artículo 8");
  });

  it("rejoins a número broken from its ordinal suffix", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 64",
      "bis.—Obligación de informar anualmente a la Asamblea Legislativa.",
      "Artículo",
      "65",
      "ter- Otra obligación.",
    ]);
    expect(chunks.map((c) => c.articulo)).toEqual([
      "Artículo 64 bis",
      "Artículo 65 ter",
    ]);
  });

  it("splits an inline suffixed heading glued to the previous paragraph", () => {
    const chunks = chunkDocument("x", "X", [
      "Artículo 31- Normas específicas. Artículo 31 quinquies- Declaración jurada.",
    ]);
    expect(chunks.map((c) => c.articulo)).toEqual([
      "Artículo 31",
      "Artículo 31 quinquies",
    ]);
  });
});

describe("chunkDocument — transitorio headings (#274)", () => {
  it("separates a suffixed transitorio from its base", () => {
    const chunks = chunkDocument("x", "X", [
      "Transitorio VII.- De conformidad con lo dispuesto.",
      "Transitorio VII bis.- De conformidad con lo dispuesto en el",
    ]);
    expect(chunks.map((c) => c.articulo)).toEqual([
      "Transitorio VII",
      "Transitorio VII bis",
    ]);
  });

  // The #237 lesson, for TRANSITORIO: extraction wraps prose so a sentence
  // can open a line with a transitorio reference. A heading is structural —
  // the ordinal carries a delimiter — so wrapped prose stays body text.
  it("does not open a chunk on wrapped prose naming a transitorio", () => {
    const chunks = chunkDocument("x", "X", [
      "Transitorio IX.- Los servicios turísticos brindados por quienes se",
      "encuentren inscritos, según lo dispuesto en el",
      "Transitorio IX de la Ley No. 9635. Para estos efectos, el hecho",
      "generador es el definido en el reglamento.",
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].articulo).toBe("Transitorio IX");
    expect(chunks[0].content).toMatch(/Para estos efectos/);
  });

  it("keeps recognising the delimiter shapes the corpus already carries", () => {
    const chunks = chunkDocument("x", "X", [
      "TRANSITORIO I. Derogado",
      "Transitorio II -. Hasta tanto se implemente la versión 4.4.",
      "Transitorio V.— Establécese un impuesto adicional.",
      "TRANSITORIO VI- Para el cumplimiento de lo dispuesto.",
    ]);
    expect(chunks.map((c) => c.articulo)).toEqual([
      "TRANSITORIO I",
      "Transitorio II",
      "Transitorio V",
      "TRANSITORIO VI",
    ]);
  });
});

describe("chunkDocument — front matter (SPEC §4 rule 3)", () => {
  it("keeps the recitals and drops the enacting formula and the ley title", () => {
    const chunks = chunkDocument("d", "T", [
      "N° 41779",
      "EL PRESIDENTE DE LA REPÚBLICA Y LA MINISTRA DE HACIENDA",
      "Considerando:",
      "I.- Que la Administración Tributaria requiere instrumentos ágiles.",
      "Por tanto, Decretan:",
      "REGLAMENTO DE LA LEY DEL IVA",
      "Artículo 1- Objeto. Este reglamento desarrolla la ley.",
    ]);

    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble).toHaveLength(1);
    expect(preamble[0].content).toMatch(/instrumentos ágiles/);
    expect(preamble[0].content).not.toMatch(/PRESIDENTE DE LA REPÚBLICA/);
    expect(preamble[0].content).not.toMatch(/Decretan/);
    expect(preamble[0].content).not.toMatch(/REGLAMENTO DE LA LEY DEL IVA/);
    expect(chunks.every((c) => c.articulo !== null)).toBe(true);
  });

  it("recognises a recital opened by the facultades formula", () => {
    const chunks = chunkDocument("d", "T", [
      "N° 1",
      "En uso de las facultades que le confiere la Constitución Política.",
      "ACUERDA:",
      "Artículo 1- Rige a partir de su publicación.",
    ]);
    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble).toHaveLength(1);
    expect(preamble[0].content).toMatch(/Constitución Política/);
  });

  it("emits nothing for front matter that is only a title block", () => {
    const chunks = chunkDocument("d", "T", [
      "Ley 10363",
      "N° 10363",
      "LA ASAMBLEA LEGISLATIVA DE LA REPÚBLICA DE COSTA RICA",
      "DECRETA:",
      "LEY DEL TRABAJADOR INDEPENDIENTE",
      "Artículo 1- Definiciones. Se entenderá por trabajador independiente.",
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].articulo).toBe("Artículo 1");
  });

  it("drops front matter that ends at a capítulo heading too", () => {
    const chunks = chunkDocument("d", "T", [
      "LA ASAMBLEA LEGISLATIVA DECRETA:",
      "LEY X",
      "CAPÍTULO I DISPOSICIONES GENERALES",
      "Artículo 1- Objeto.",
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].path).toEqual(["CAPÍTULO I DISPOSICIONES GENERALES"]);
  });

  it("cuts at a ministerial enacting verb, not only DECRETA", () => {
    const chunks = chunkDocument("d", "T", [
      "N° 1",
      "El Ministro de Hacienda",
      "Considerando:",
      "I.- Que se requiere regular la materia.",
      "Por tanto, el Ministro dispone:",
      "REGLAMENTO ESPECIAL DE TASAS",
      "Artículo 1- Objeto.",
    ]);
    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble).toHaveLength(1);
    expect(preamble[0].content).not.toMatch(/REGLAMENTO ESPECIAL DE TASAS/);
  });

  it("cuts at the last formula, not a quotation of one in a considerando", () => {
    const chunks = chunkDocument("d", "T", [
      "Considerando:",
      'I.- Que el artículo 5 de la Ley N° 1 dispone: "quedan exentas las exportaciones de bienes".',
      "Por tanto, decreta:",
      "REGLAMENTO X",
      "Artículo 1- Objeto.",
    ]);
    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble).toHaveLength(1);
    expect(preamble[0].content).toMatch(/exportaciones de bienes/);
    expect(preamble[0].content).not.toMatch(/REGLAMENTO X/);
  });

  // Losing real recitals is worse than carrying a title line: front matter is
  // dropped only when there is nothing in it to lose.
  it("keeps recitals opened by unrecognised wording rather than dropping them", () => {
    const chunks = chunkDocument("d", "T", [
      "N° 1",
      "El Poder Ejecutivo",
      "Primero: Que el trámite de inscripción ante la Administración Tributaria requiere ajustes para los trabajadores independientes.",
      "Por tanto, decreta:",
      "REGLAMENTO X",
      "Artículo 1- Objeto.",
    ]);
    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble).toHaveLength(1);
    expect(preamble[0].content).toMatch(/requiere ajustes/);
    expect(preamble[0].content).not.toMatch(/REGLAMENTO X/);
  });

  it("does not mistake a considerando's prose for the enacting formula", () => {
    const chunks = chunkDocument("d", "T", [
      "Considerando: I.- Que la ley decreta la exención de las exportaciones.",
      "Artículo 1- Objeto.",
    ]);
    const preamble = chunks.filter((c) => c.articulo === "Preámbulo");
    expect(preamble).toHaveLength(1);
    expect(preamble[0].content).toMatch(/exención de las exportaciones/);
  });
});

describe("chunkDocument — unstructured document (whole-doc fallback)", () => {
  it("emits a single chunk when no artículo structure exists", () => {
    const paras = textToParagraphs(
      "TRAMOS DEL IMPUESTO SOBRE LA RENTA\n\nPara asalariados: hasta ¢918.000 exento.\n\nSobre el exceso, 10%.",
    );
    const chunks = chunkDocument("tramos-renta-2026", "Tramos 2026", paras);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].articulo).toBeNull();
    expect(chunks[0].part).toBe(0);
  });
});

describe("chunkDocument — manifest-declared label (actas, fichas técnicas)", () => {
  const acta = [
    "Artículo 11°. De los ingresos mínimos de referencia y los porcentajes de contribución",
    "Los ingresos mínimos de referencia serán establecidos por la Junta Directiva…",
    "1 De 0.9295 SM 2.89% 9.11% 12.00%",
    "Acuerdo Primero: Establecer la siguiente escala contributiva.",
  ];

  it("labels every chunk with the declared artículo instead of quoted headings", () => {
    const chunks = chunkDocument(
      "ccss-escala-salud",
      "CCSS — Escala Salud",
      acta,
      {
        articulo: "Artículo 30°, sesión 8999",
      },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].articulo).toBe("Artículo 30°, sesión 8999");
    expect(chunks[0].path).toEqual([]);
    expect(chunks[0].content).toContain("2.89%");
  });

  it("does not segment on the quoted articles it would otherwise split at", () => {
    const withOverride = chunkDocument("d", "T", acta, {
      articulo: "Artículo 30°, sesión 8999",
    });
    const without = chunkDocument("d", "T", acta);

    expect(without.map((c) => c.articulo)).toContain("Artículo 11");
    expect(
      withOverride.every((c) => c.articulo === "Artículo 30°, sesión 8999"),
    ).toBe(true);
  });

  it("still sub-splits a long body, keeping the label on every part", () => {
    const long = ["palabra ".repeat(2500).trim()];
    const chunks = chunkDocument("d", "T", long, {
      articulo: "Artículo 4°, sesión 9570",
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.part)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.articulo))).toEqual(
      new Set(["Artículo 4°, sesión 9570"]),
    );
  });
});

/**
 * The #114 failure mode, made impossible (#206): `ccss-escala-salud` is five
 * pages of a 170-page acta with no `layoutTable` safety net, so a source
 * re-layout that leaves pdftotext with nothing is a live possibility — and it
 * used to produce exactly one header-only chunk, which the runner counted as
 * success while `replace_chunks` deleted the rate table.
 */
describe("chunkDocument — extraction that recovered nothing", () => {
  const options = { articulo: "Artículo 30°, sesión 8999" };

  it("returns no chunks for no paragraphs", () => {
    expect(
      chunkDocument("ccss-escala-salud", "CCSS — Escala Salud", [], options),
    ).toEqual([]);
  });

  it("returns no chunks for whitespace-only paragraphs", () => {
    expect(
      chunkDocument(
        "ccss-escala-salud",
        "CCSS — Escala Salud",
        ["  ", "\n", ""],
        options,
      ),
    ).toEqual([]);
  });

  it("still chunks a body that survived the whitespace", () => {
    const chunks = chunkDocument("d", "T", ["", " 2.89% ", ""], options);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("[T — Artículo 30°, sesión 8999] 2.89%");
  });
});

describe("assertChunksCarryContent", () => {
  const headerOnly = (docKey: string): Chunk[] => [
    {
      docKey,
      articulo: "Artículo 30°, sesión 8999",
      path: [],
      part: 0,
      content: "[CCSS — Escala Salud — Artículo 30°, sesión 8999] ",
    },
  ];

  it("rejects an empty chunk set, naming the document", () => {
    expect(() => assertChunksCarryContent("ccss-escala-salud", [])).toThrow(
      /ccss-escala-salud/,
    );
  });

  it("rejects a header-only chunk set, naming the document", () => {
    expect(() =>
      assertChunksCarryContent(
        "ccss-escala-salud",
        headerOnly("ccss-escala-salud"),
      ),
    ).toThrow(/ccss-escala-salud/);
  });

  it("accepts a set where any chunk carries body text", () => {
    const chunks = [
      ...headerOnly("ccss-escala-salud"),
      {
        docKey: "ccss-escala-salud",
        articulo: null,
        path: [],
        part: 1,
        content: "[CCSS — Escala Salud] Trabajador independiente 2.89%.",
      },
    ];
    expect(() =>
      assertChunksCarryContent("ccss-escala-salud", chunks),
    ).not.toThrow();
  });

  it("accepts what the chunker actually emits", () => {
    expect(() =>
      assertChunksCarryContent(
        "d",
        chunkDocument("d", "T", ["Artículo 1- Texto."]),
      ),
    ).not.toThrow();
  });
});
