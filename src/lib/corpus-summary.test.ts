import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CORPUS_DOCUMENT_COUNT,
  CORPUS_SAMPLE_DOC_KEYS,
  corpusCaption,
  corpusSample,
} from "./corpus-summary";

describe("corpus summary", () => {
  it("counts the documents the manifest actually lists", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "corpus", "manifest.json"), "utf8"),
    ) as { documents: unknown[] };
    expect(CORPUS_DOCUMENT_COUNT).toBe(manifest.documents.length);
    expect(CORPUS_DOCUMENT_COUNT).toBeGreaterThan(0);
  });

  it("phrases the caption with Spanish plurals", () => {
    expect(corpusCaption(19)).toBe(
      "19 documentos oficiales · cada respuesta cita el artículo",
    );
    expect(corpusCaption(1)).toBe(
      "1 documento oficial · cada respuesta cita el artículo",
    );
  });

  it("samples only documents the manifest lists, as unlinked whole-document stamps", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "corpus", "manifest.json"), "utf8"),
    ) as { documents: { doc_key: string }[] };
    const keys = new Set(manifest.documents.map((d) => d.doc_key));

    for (const key of CORPUS_SAMPLE_DOC_KEYS) expect(keys.has(key)).toBe(true);
    const sample = corpusSample();
    expect(sample.map((s) => s.docKey)).toEqual([...CORPUS_SAMPLE_DOC_KEYS]);
    for (const stamp of sample) {
      expect(stamp.articulo).toBeNull();
      expect(stamp.url).toBeNull();
    }
  });
});
