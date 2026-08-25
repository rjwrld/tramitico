import { decodeHTML } from "entities";

/** SINALEVI navigation chrome that must never reach a chunk (SPEC §4.3). */
const CHROME_RE =
  /-?Usted está en la \S+ versión|^Anterior$|^Siguiente$|^Versión de la Norma|^Ficha Art[íi]culo/i;

const FICHA_RE = /Ficha Art[íi]culo\s*\d*(\s*(bis|ter|Transitorio))?/gi;

const BLOCK_TAG_RE =
  /<\/?(?:p|h[1-6]|div|tr|li|table|section|article)\b[^>]*>/gi;
const TAG_RE = /<[^>]+>/g;

const IMG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_RE = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;
const TABLE_RE = /<table\b/gi;

/** Styles, scripts and comments never carry document content. */
function dropNonContent(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/**
 * What a fetched payload carries that `htmlToParagraphs` will silently drop.
 *
 * `<img>` is swallowed by TAG_RE below — and because BLOCK_TAG_RE has already
 * turned the surrounding block tags into newlines, an image leaves no residue
 * at all: not an empty paragraph, not a marker. A document whose substance is
 * a picture therefore extracts to fluent prose with the numbers missing, the
 * chunk is well-formed, ingestion succeeds and the gates stay green (#150).
 * That is exactly how #114 hid: ccss-bmc's escala contributiva was a raster
 * image, so the text jumped from «Establecer la siguiente escala contributiva»
 * to «Notas:».
 *
 * `tables` is the discriminator, not a verdict. An image in a payload with no
 * table markup is the strongest available signal that a table became a picture
 * (the #114 shape); images alongside real tables are usually diagrams, seals or
 * rendered formulas. Both are worth warning about, neither is worth failing on
 * — the #150 audit found 13 of 21 SINALEVI images to be pure decoration.
 *
 * `srcs` keeps every tag in document order, duplicates included: the count that
 * matters to a reader of the log is how many images the payload renders, not
 * how many distinct files it references.
 */
export function findImageMarkup(html: string): {
  srcs: string[];
  tables: number;
} {
  const content = dropNonContent(html);
  const srcs: string[] = [];
  for (const [tag] of content.matchAll(IMG_RE)) {
    const src = tag.match(IMG_SRC_RE);
    if (src) srcs.push(src[2] ?? src[3] ?? src[4]);
  }
  return { srcs, tables: [...content.matchAll(TABLE_RE)].length };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The ingestion-time warning for #150, or null when the payload has no images.
 *
 * Deliberately a warning and never a failure: most images in the corpus are
 * legitimately decorative — the audit found Word drawing strokes, seals and
 * rendered formulas that restate their own prose — and a document that logs one
 * is not necessarily broken. The louder no-table variant is the #114 shape,
 * where the absence of any table markup makes "a table became a picture" the
 * likeliest reading. Neither line is a verdict; both say *go look*.
 */
export function imageMarkupWarning(
  docKey: string,
  html: string,
): string | null {
  const { srcs, tables } = findImageMarkup(html);
  if (srcs.length === 0) return null;
  const images = plural(srcs.length, "image");
  const headline =
    tables === 0
      ? `${docKey}: payload carries ${images} and no table markup — the #114 shape, where a table became a picture. Nothing in the chunks will show the loss; check each image before trusting this document's figures (#114, #150).`
      : `${docKey}: payload carries ${images} alongside ${plural(tables, "table")}. Extraction drops images silently — confirm no substance lives only in them (#150).`;
  return [headline, ...srcs.map((src) => `    ${src}`)].join("\n");
}

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
  const withBreaks = dropNonContent(html).replace(BLOCK_TAG_RE, "\n");
  const text = decodeHTML(withBreaks.replace(TAG_RE, " "));
  return cleanParagraphs(text.split("\n"));
}

/** Plain text (e.g. pdftotext output) → cleaned paragraph list. */
export function textToParagraphs(text: string): string[] {
  return cleanParagraphs(
    text.split(/\n{2,}/).map((p) => p.replace(/\n/g, " ")),
  );
}
