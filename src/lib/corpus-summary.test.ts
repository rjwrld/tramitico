import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CORPUS_DOCUMENT_COUNT, corpusCaption } from "./corpus-summary";

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
});
