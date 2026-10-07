import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { annualSeries, annualVigencia } from "../vigencia";

interface ManifestEntry {
  doc_key: string;
  effective_date?: string;
  carriesFigures?: boolean;
  annualChurn?: boolean;
  verifiedForFiscalYear?: number;
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
    const warnings = [
      ...dueForNextYear.map(
        (series) =>
          `${series}: no source for the next fiscal year yet — owner: runbook §2.2 (#505)`,
      ),
      ...superseded.map(
        (docKey) =>
          `${docKey}: superseded and withheld from answers — owner: retire it, runbook §2.2`,
      ),
    ];
    for (const warning of warnings) {
      console.warn(`vigencia: ${warning}`);
      annotate(warning, "warning");
    }
  });

  it("records the IVM re-verification required when its current scale expires", () => {
    const ivm = manifest.documents.find(
      (doc) => doc.doc_key === "ccss-escala-ivm",
    );
    expect(ivm).toBeDefined();

    expect(ivm?.notes).toMatch(/re-verific.*2028-12-31/i);
  });
});
