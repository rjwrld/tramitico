import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS_INDEX_PATH, parseCorpusIndex } from "../eval/corpus-index";
import {
  annualSeries,
  annualVigencia,
  yearFigureLabel,
  yearFigureRefs,
  yearFigureVigencia,
  type YearFigure,
} from "../vigencia";

interface ManifestEntry {
  doc_key: string;
  effective_date?: string;
  carriesFigures?: boolean;
  annualChurn?: boolean;
  verifiedForFiscalYear?: number;
  yearFigures?: YearFigure[];
  notes?: string;
}

const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "corpus", "manifest.json"), "utf8"),
) as { documents: ManifestEntry[] };

/** Series, not doc_keys: next year's entry may sit beside this year's (#505). */
const seriesOf = (docs: ManifestEntry[]) => [
  ...new Set(docs.map((doc) => annualSeries(doc.doc_key))),
];

describe("corpus/manifest.json vigencia", () => {
  it("marks the five figure sources and every annual source explicitly", () => {
    expect(
      seriesOf(manifest.documents.filter((doc) => doc.carriesFigures)),
    ).toEqual([
      "tramos-renta",
      "salario-base",
      "ccss-escala-ivm",
      "ccss-escala-salud",
      "salarios-minimos",
    ]);
    expect(
      seriesOf(manifest.documents.filter((doc) => doc.annualChurn)),
    ).toEqual([
      "tramos-renta",
      "salario-base",
      "ccss-bmc",
      "ccss-escala-ivm",
      "ccss-escala-salud",
      "salarios-minimos",
    ]);
  });

  it("dates every source that carries figures", () => {
    const undated = manifest.documents
      .filter((doc) => doc.carriesFigures && !doc.effective_date)
      .map((doc) => doc.doc_key);

    expect(undated).toEqual([]);
  });

  it("covers every annual series in the current Costa Rican fiscal year", () => {
    // An uncovered series is withheld from every answer by `retrieve()`;
    // this is the release gate that says so first (ADR 0016, runbook §2.2).
    expect(annualVigencia(manifest).uncovered).toEqual([]);
  });

  // #505: free and dated. From 1 December it names each annual series with
  // no source for the coming fiscal year yet, and after 1 January each entry
  // a newer one superseded. A warning, not a failure: the owner acts on it (runbook
  // §2.2), and no PR should go red for a gazette that is not out. CI shows it
  // as a PR annotation; `pnpm recrawl`, which runs this file, prints it.
  it("warns from 1 December about next year's annual sources", ({
    annotate,
  }) => {
    // Asserts nothing, on purpose: it can only warn.
    const { dueForNextYear, superseded } = annualVigencia(manifest);
    const yearFigures = yearFigureVigencia(manifest);
    const warnings = [
      ...dueForNextYear.map(
        (series) =>
          `${series}: no source for the next fiscal year yet — owner: runbook §2.2 (#505)`,
      ),
      ...superseded.map(
        (docKey) =>
          `${docKey}: superseded and withheld from answers — owner: retire it, runbook §2.2`,
      ),
      // #518: never a gate. The fix waits on SINALEVI or the CCSS publishing
      // the new year, and until then retrieval keeps the old figure out.
      ...yearFigures.dueForNextYear.map(
        (ref) =>
          `${yearFigureLabel(ref)}: withheld from 1 January until its source states the next fiscal year — owner: runbook §2.2 (#518)`,
      ),
      ...yearFigures.withheld.map(
        (ref) =>
          `${yearFigureLabel(ref)}: withheld from answers — owner: re-crawl once the source states this fiscal year, runbook §2.2 (#518)`,
      ),
    ];
    for (const warning of warnings) {
      console.warn(`vigencia: ${warning}`);
      annotate(warning, "warning");
    }
  });

  /**
   * #518, ADR 0016: the artículos of non-annual sources that state one fiscal
   * year's figures. The list is the inventory; a source that starts or stops
   * quoting a year's figure changes it here, on purpose.
   */
  it("lists the year-figure artículos of non-annual sources", () => {
    const listed = yearFigureRefs(manifest).map(
      ({ docKey, articulo }) => `${docKey} · ${articulo}`,
    );
    expect(listed).toEqual([
      "ley-renta · Artículo 15",
      "ley-renta · Artículo 33",
      "ley-renta · ARTICULO 34",
      "ccss-faq · ¿Cuál es el porcentaje de cotización para el seguro voluntario o trabajador independiente y cómo se determina el ingreso de referencia?",
    ]);
    // An annual source is withheld whole; listing its artículos would be a
    // second, weaker claim about the same text.
    expect(
      manifest.documents
        .filter((doc) => doc.annualChurn && doc.yearFigures)
        .map((doc) => doc.doc_key),
    ).toEqual([]);
    for (const figure of manifest.documents.flatMap(
      (doc) => doc.yearFigures ?? [],
    )) {
      expect(Number.isInteger(figure.fiscalYear)).toBe(true);
      expect(figure.evidence.trim()).not.toBe("");
    }
  });

  it("names year-figure artículos the corpus holds, each under one heading", () => {
    // Retrieval matches a chunk's (doc_key, artículo): a heading that is not
    // in the corpus withholds nothing, and one that repeats under another
    // Título would take its namesake with it.
    const index = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));
    const triples = (docKey: string, articulo: string) =>
      index.entries.filter(
        (entry) => entry.docKey === docKey && entry.articulo === articulo,
      ).length;
    const notOne = manifest.documents.flatMap((doc) =>
      (doc.yearFigures ?? [])
        .filter((figure) => triples(doc.doc_key, figure.articulo) !== 1)
        .map((figure) => `${doc.doc_key} · ${figure.articulo}`),
    );
    expect(notOne).toEqual([]);
  });

  it("records the IVM re-verification required when its current scale expires", () => {
    const ivm = manifest.documents.find(
      (doc) => doc.doc_key === "ccss-escala-ivm",
    );
    expect(ivm).toBeDefined();

    expect(ivm?.notes).toMatch(/re-verific.*2028-12-31/i);
  });
});
