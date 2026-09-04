import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CR_UTC_OFFSET_MS } from "../cr-time";

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

const crYear = (now = new Date()) =>
  new Date(now.getTime() - CR_UTC_OFFSET_MS).getUTCFullYear();

describe("corpus/manifest.json vigencia", () => {
  it("marks the five figure sources and every annual source explicitly", () => {
    expect(
      manifest.documents
        .filter((doc) => doc.carriesFigures)
        .map((doc) => doc.doc_key),
    ).toEqual([
      "tramos-renta-2026",
      "salario-base-2026",
      "ccss-escala-ivm",
      "ccss-escala-salud",
      "salarios-minimos",
    ]);
    expect(
      manifest.documents
        .filter((doc) => doc.annualChurn)
        .map((doc) => doc.doc_key),
    ).toEqual([
      "tramos-renta-2026",
      "salario-base-2026",
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

  it("keeps annual-churn sources in the current Costa Rican fiscal year", () => {
    const currentYear = crYear();
    const stale = manifest.documents
      .filter((doc) => doc.annualChurn)
      .filter(
        (doc) =>
          (doc.verifiedForFiscalYear ??
            Number(doc.effective_date?.slice(0, 4))) !== currentYear,
      )
      .map(
        (doc) =>
          `${doc.doc_key}: ${doc.verifiedForFiscalYear ?? doc.effective_date ?? "sin período"}`,
      );

    expect(stale).toEqual([]);
  });

  it("records the IVM re-verification required when its current scale expires", () => {
    const ivm = manifest.documents.find(
      (doc) => doc.doc_key === "ccss-escala-ivm",
    );
    expect(ivm).toBeDefined();

    expect(ivm?.notes).toMatch(/re-verific.*2028-12-31/i);
  });
});
