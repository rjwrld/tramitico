import { decodeHTML } from "entities";

/** SINALEVI navigation chrome that must never reach a chunk (SPEC §4.3). */
const CHROME_RE =
  /-?Usted está en la \S+ versión|^Anterior$|^Siguiente$|^Versión de la Norma|^Ficha Art[íi]culo/i;

const FICHA_RE = /Ficha Art[íi]culo\s*\d*(\s*(bis|ter|Transitorio))?/gi;

const BLOCK_TAG_RE =
  /<\/?(?:p|h[1-6]|div|tr|li|table|section|article)\b[^>]*>/gi;
const TAG_RE = /<[^>]+>/g;

export function cleanParagraphs(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (const raw of paragraphs) {
    const p = raw.replace(FICHA_RE, " ").replace(/\s+/g, " ").trim();
    if (p && !CHROME_RE.test(p)) out.push(p);
  }
  return out;
}

/**
 * Word-export HTML (SINALEVI payload) → cleaned paragraph list.
 * Block-level tags act as paragraph boundaries; styles/scripts are dropped whole.
 */
export function htmlToParagraphs(html: string): string[] {
  const noStyles = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = noStyles.replace(BLOCK_TAG_RE, "\n");
  const text = decodeHTML(withBreaks.replace(TAG_RE, " "));
  return cleanParagraphs(text.split("\n"));
}

/** Plain text (e.g. pdftotext output) → cleaned paragraph list. */
export function textToParagraphs(text: string): string[] {
  return cleanParagraphs(
    text.split(/\n{2,}/).map((p) => p.replace(/\n/g, " ")),
  );
}
