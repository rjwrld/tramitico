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

/** How many official documents the corpus is ingested from. */
export const CORPUS_DOCUMENT_COUNT: number = manifest.documents.length;

/** `19 documentos oficiales · cada respuesta cita el artículo` */
export function corpusCaption(documentCount: number): string {
  const noun =
    documentCount === 1 ? "documento oficial" : "documentos oficiales";
  return `${documentCount} ${noun} · cada respuesta cita el artículo`;
}
