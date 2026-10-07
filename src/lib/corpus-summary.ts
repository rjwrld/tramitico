/**
 * What the empty state can truthfully say about the record it answers from.
 *
 * DESIGN principle 2: authority comes from the record, not from the app. The
 * one line under the headline is therefore a count read off
 * `corpus/manifest.json` at build time — the same file `pnpm ingest` reads —
 * plus the product's own claim. It is never a guess and never a marketing
 * number: change the manifest and the line follows.
 */
import manifest from "../../corpus/manifest.json";

import type { Citation } from "./citations";

/** How many official documents the corpus is ingested from. */
export const CORPUS_DOCUMENT_COUNT: number = manifest.documents.length;

/**
 * `23 documentos oficiales` — the count the empty state's scope sentence
 * closes on («…citando el artículo de 23 documentos oficiales.»).
 */
export function corpusCount(documentCount: number): string {
  const noun =
    documentCount === 1 ? "documento oficial" : "documentos oficiales";
  return `${documentCount} ${noun}`;
}

/**
 * The documents the empty state stamps over its scope sentence (#478): one per
 * area a first question usually lands in — IVA, renta, the CCSS and
 * comprobantes. A sample, not a ranking; the scope sentence under it carries
 * the full count and links to the whole list. Every key must be in the manifest
 * (`corpus-summary.test.ts`), so a retired document cannot linger here.
 */
export const CORPUS_SAMPLE_DOC_KEYS = [
  "ley-iva",
  "ley-renta",
  "ccss-reglamento-ti",
  "reglamento-comprobantes",
] as const;

/**
 * The sample as stamps: whole documents, so no artículo, and no link — the
 * stamps illustrate the scope sentence, whose count links to the full list.
 */
export function corpusSample(): Citation[] {
  return CORPUS_SAMPLE_DOC_KEYS.flatMap((key) => {
    const doc = manifest.documents.find((d) => d.doc_key === key);
    return doc
      ? [
          {
            docKey: doc.doc_key,
            docTitle: doc.title,
            norma: doc.norma ?? null,
            articulo: null,
            url: null,
          },
        ]
      : [];
  });
}
