import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToParagraphs, textToParagraphs } from "./extract";
import { chunkDocument, type Chunk } from "./chunker";

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

  it("tags the preámbulo", () => {
    expect(chunks.some((c) => c.articulo === "Preámbulo")).toBe(true);
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
