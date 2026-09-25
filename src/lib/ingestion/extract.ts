import { decodeHTML } from "entities";
import { type ExcerptSpec, sliceExcerpt } from "./excerpt";
import { renderLabelRail } from "./label-rail";
import { type LayoutTableSpec, renderLayoutTable } from "./layout-table";
import { renderStackedFraction } from "./stacked-fraction";
import { renderWrappedRow } from "./wrapped-row";

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

/** What a payload's images are worth saying out loud, and how loudly. */
export interface ImageMarkupNotice {
  /** `warn` deserves the ⚠ and a reader's attention; `info` is a receipt. */
  level: "info" | "warn";
  message: string;
}

/**
 * The ingestion-time notice for #150, or null when the payload has no images.
 *
 * Deliberately never a failure: most images in the corpus are legitimately
 * decorative — the audit found Word drawing strokes, seals and rendered
 * formulas that restate their own prose — and a document that logs one is not
 * necessarily broken. The louder no-table variant is the #114 shape, where the
 * absence of any table markup makes "a table became a picture" the likeliest
 * reading. Neither line is a verdict; both say *go look*.
 *
 * `imagesAudited` is the manifest's record of which srcs a human has already
 * looked at (#177). Without it the warning is unchanged. With it the notice
 * becomes per-verdict rather than per-payload: a payload whose images are all
 * in the audited set gets one quiet receipt, because a warning that recurs on
 * every run for four docs someone already cleared trains the reader to skip
 * it. The audit is a point-in-time verdict, though — a SINALEVI re-crawl can
 * add or swap images — so anything the audit never saw brings the full warning
 * back, plus the srcs that drifted. That case is the one worth shouting about.
 */
export function imageMarkupNotice(
  docKey: string,
  html: string,
  imagesAudited?: readonly string[],
): ImageMarkupNotice | null {
  const { srcs, tables } = findImageMarkup(html);
  if (srcs.length === 0) return null;
  const images = plural(srcs.length, "image");

  if (imagesAudited) {
    const audited = new Set(imagesAudited);
    const drifted = [...new Set(srcs.filter((src) => !audited.has(src)))];
    if (drifted.length === 0) {
      return { level: "info", message: `${docKey}: ${images}, audited (#150)` };
    }
    return {
      level: "warn",
      message: [
        warningLines(docKey, images, tables, srcs),
        `  ${plural(drifted.length, "image")} not in the audited set — the payload has drifted since the #150 audit and nobody has looked at these (#177):`,
        ...drifted.map((src) => `    ${src}`),
      ].join("\n"),
    };
  }

  return {
    level: "warn",
    message: warningLines(docKey, images, tables, srcs),
  };
}

function warningLines(
  docKey: string,
  images: string,
  tables: number,
  srcs: string[],
): string {
  const headline =
    tables === 0
      ? `${docKey}: payload carries ${images} and no table markup — the #114 shape, where a table became a picture. Nothing in the chunks will show the loss; check each image before trusting this document's figures (#114, #150).`
      : `${docKey}: payload carries ${images} alongside ${plural(tables, "table")}. Extraction drops images silently — confirm no substance lives only in them (#150).`;
  return [headline, ...srcs.map((src) => `    ${src}`)].join("\n");
}

/**
 * A lowercase «l» read where a figure's leading 1 is printed: `tramos-renta-2026`'s
 * text layer carries the hijo credit as «¢l.710,00» (#420). Scoped to a colón sign
 * followed by the «l» and a digit, optionally across a thousands or decimal separator,
 * so no word is touched.
 */
const COLON_ONE_RE = /([¢₡]\s?)l(?=[.,]?\d)/g;

export function cleanParagraphs(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (const raw of paragraphs) {
    const p = raw
      .replace(FICHA_RE, " ")
      .replace(COLON_ONE_RE, "$11")
      .replace(/\s+/g, " ")
      .trim();
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

/**
 * SINALEVI HTML narrowed by the same manifest markers used for PDFs.
 *
 * Excerpting after HTML cleanup makes each semantic block one searchable line,
 * while still failing loudly when a marker disappears or becomes ambiguous.
 */
export function htmlExcerptToParagraphs(
  html: string,
  excerpt: ExcerptSpec | readonly ExcerptSpec[],
): string[] {
  const paragraphs = htmlToParagraphs(html);
  return sliceExcerpt(paragraphs.join("\n"), excerpt)
    .split("\n")
    .filter(Boolean);
}

/** The manifest's verdicts about how this document is laid out on the page. */
export interface TextLayout {
  /** One column-aligned data table to re-emit as labelled rows (#179). */
  table?: LayoutTableSpec;
  /** This document is a two-column form; read its rails as cells (#199). */
  labelRail?: boolean;
  /** This document carries a stacked formula; restore its bars (#203). */
  stackedFraction?: boolean;
  /** A table row here wraps below its own right cell; re-join it (#242). */
  wrappedRow?: boolean;
}

/**
 * Plain text (e.g. pdftotext output) → cleaned paragraph list.
 *
 * `layout` carries the manifest's verdicts about this document's page (#179,
 * #199, #203). Without them the lines of a paragraph are joined with spaces,
 * which flattens a table into a run-on line whose columns no longer line up,
 * splices a form's rail into the sentence beside it, and drops the bar out of
 * a stacked fraction. The order is fixed by what each pass needs to see: the
 * table first, because `renderLayoutTable` needs the grid as pdftotext laid it
 * out; then the fractions, which collapse a formula's two or three lines into
 * one; then the wrapped rows, which pull a stray fragment back onto the line
 * it fell out of; and the rails last, so neither a rendered row nor a
 * collapsed formula — both single lines by then — can be mistaken for a
 * two-column block. See layout-table.ts, stacked-fraction.ts, wrapped-row.ts
 * and label-rail.ts.
 */
export function textToParagraphs(
  text: string,
  layout: TextLayout = {},
): string[] {
  let lines = text.split("\n");
  if (layout.table) lines = renderLayoutTable(lines, layout.table);
  if (layout.stackedFraction) lines = renderStackedFraction(lines);
  if (layout.wrappedRow) lines = renderWrappedRow(lines);
  if (layout.labelRail) lines = renderLabelRail(lines);
  return cleanParagraphs(
    lines
      .join("\n")
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, " ")),
  );
}
