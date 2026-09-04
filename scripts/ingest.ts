/**
 * Ingestion runner (SPEC §4): fetch → clean → chunk → embed → upsert.
 * Idempotent per document: the document row is upserted by doc_key and its
 * chunks are replaced wholesale on every run.
 *
 * Usage:
 *   pnpm ingest              # every ingestable manifest entry
 *   pnpm ingest ley-10363    # one or more doc_keys
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildCorpusIndex,
  CORPUS_INDEX_PATH,
  fetchCorpusChunks,
  serializeCorpusIndex,
} from "../src/lib/eval/corpus-index";
import type { ChunkOptions } from "../src/lib/ingestion/chunker";
import { ingestDocument } from "../src/lib/ingestion/ingest-document";
import { createEmbedder } from "../src/lib/ingestion/embedder";
import {
  type ExcerptSpec,
  excerptSlices,
  sliceExcerpt,
} from "../src/lib/ingestion/excerpt";
import {
  htmlToParagraphs,
  imageMarkupNotice,
  textToParagraphs,
} from "../src/lib/ingestion/extract";
import { fetchHaciendaPdf } from "../src/lib/ingestion/hacienda";
import type { LayoutTableSpec } from "../src/lib/ingestion/layout-table";
import { fetchPdfSource } from "../src/lib/ingestion/pdf";
import { pdfImageNotice } from "../src/lib/ingestion/pdf-images";
import { retireDocuments } from "../src/lib/ingestion/retire";
import type { DeepLinkKind } from "../src/lib/retrieval";
import { articuloAnchors, fetchNorma } from "../src/lib/ingestion/sinalevi";

interface ManifestDoc {
  doc_key: string;
  title: string;
  norma: string | null;
  source: {
    kind: "sinalevi" | "hacienda-pdf" | "pdf" | "cabys" | "unresolved";
    idFichaNorma?: number;
    url?: string;
    /** `pdf` only: file inside the zip at `url`, when the PDF is zipped. */
    member?: string;
    /**
     * `pdf` only: 1-based inclusive page range, e.g. "165-171". Required for
     * sources where the primary text is a few pages inside a much larger
     * compilation (a CCSS acta, a Gaceta alcance) — ingesting the whole file
     * would bury the norma under hundreds of unrelated chunks.
     */
    pages?: string;
    /**
     * `pdf` only: the artículo inside `pages` this entry actually claims,
     * bounded by two markers a human read off the PDF (#176). Required where
     * the page range is a *reform decree*: its neighbouring pages carry other
     * incisos of the same decree that later reforms have since superseded, and
     * a page-granular range would seat those beside vigente chunks. Absent →
     * the whole page range is ingested. A list where the claim is not
     * contiguous — the acuerdo and the escala it adopts sitting either side of
     * a superseded table (#198). See excerpt.ts.
     */
    excerpt?: ExcerptSpec | ExcerptSpec[];
    catalog?: string;
    hint?: string;
    /**
     * Deep-link capability of this source's official URL, audited per entry
     * (issue #134): `articulo` (SINALEVI artículo view), `page` (`#page=` into
     * a page-ranged PDF) or `none` (document root is the deepest honest link).
     */
    deepLink: DeepLinkKind;
    /** `sinalevi` only: artículo number → viewer id, harvested at ingestion. */
    articulos?: Record<string, number>;
  };
  /** ISO date the document's text takes effect (SPEC §3 provenance). */
  effective_date?: string;
  /** Chunking overrides for documents with no artículo structure of their own. */
  chunking?: ChunkOptions;
  /**
   * Every image a human has looked at for documents carrying an IMAGE AUDIT
   * note: the `src` for SINALEVI HTML, or `p<page>-obj<object>-<generation>`
   * for a PDF. Present → the ingestion notice is quiet while the payload's
   * images stay inside this set, and loud the moment a re-crawl adds one the
   * audit never saw. Absent → the payload is warned about every run (#177).
   */
  imagesAudited?: string[];
  /**
   * Column labels for one column-aligned table in this document, read off the
   * PDF by a human (#179). Present → that table is re-extracted as one
   * labelled row per paragraph instead of collapsing into a run-on line, and
   * ingestion fails loudly if the grid is no longer there. Absent → the
   * document extracts exactly as it always has. See layout-table.ts.
   */
  layoutTable?: LayoutTableSpec;
  /**
   * True when this document is laid out as a two-column form — a narrow rail
   * of short labels or values beside a wide column of prose (#199). Present →
   * each such block is re-read as `label: body`, so no rail word lands inside
   * the sentence beside it, and ingestion fails loudly if the rail is gone.
   * Absent → the document extracts exactly as it always has. See label-rail.ts.
   */
  labelRail?: boolean;
  /**
   * True when this document carries a formula laid out as a stacked fraction
   * (#203). The bar is drawn rather than typed, so pdftotext emits nothing for
   * it and the division is lost. Present → the numerator and denominator are
   * paired by the columns they occupy and re-emitted as `(a)/(b)` spliced back
   * into the expression, and ingestion fails loudly rather than pair them on a
   * guess. Absent → the document extracts exactly as it always has. See
   * stacked-fraction.ts.
   */
  stackedFraction?: boolean;
  /**
   * True when a two-column table in this document has a row whose left cell
   * wraps and pdftotext puts a blank line inside the row (#242). Present → the
   * fragment is re-joined onto the row's own line, so the rate no longer lands
   * in the middle of its condition, and ingestion fails loudly if no such row
   * is found. Absent → the document extracts exactly as it always has. See
   * wrapped-row.ts.
   */
  wrappedRow?: boolean;
  notes?: string;
}

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, "corpus", "cache");

function loadDotEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadDotEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (see .env.local)",
    );
  }
  const supabase = createClient(url, key);
  const embedder = createEmbedder();
  console.log(`embedder: ${embedder.provider} (${embedder.dimensions}d)`);

  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "corpus", "manifest.json"), "utf8"),
  ) as { retiredDocKeys?: string[]; documents: ManifestDoc[] };

  const wanted = process.argv.slice(2);
  const docs = manifest.documents.filter(
    (d) => wanted.length === 0 || wanted.includes(d.doc_key),
  );
  if (wanted.length > 0 && docs.length !== wanted.length) {
    const known = new Set(docs.map((d) => d.doc_key));
    throw new Error(
      `Unknown doc_key(s): ${wanted.filter((w) => !known.has(w)).join(", ")}`,
    );
  }

  mkdirSync(CACHE, { recursive: true });
  let ingested = 0;
  const skipped: string[] = [];

  for (const doc of docs) {
    const paragraphs = await extract(doc);
    if (paragraphs === null) {
      skipped.push(doc.doc_key);
      continue;
    }
    const written = await ingestDocument(
      { client: supabase, embedder },
      doc,
      paragraphs,
    );

    ingested++;
    console.log(`✓ ${doc.doc_key}: ${written} chunks`);
  }

  if (skipped.length > 0) {
    console.log(`skipped (source pending): ${skipped.join(", ")}`);
  }

  const retiredDocKeys = manifest.retiredDocKeys ?? [];
  if (retiredDocKeys.length > 0) {
    await retireDocuments(supabase, retiredDocKeys);
    console.log(`retired: ${retiredDocKeys.join(", ")}`);
  }

  // Re-dump the committed corpus index from the whole table — not just the
  // documents this run touched — so the per-PR satisfiability census reads a
  // fixture that matches the corpus as it now stands (#163). A partial run
  // still leaves the table complete, so the full dump is right either way.
  const index = buildCorpusIndex(
    await fetchCorpusChunks(supabase),
    new Date().toISOString(),
  );
  writeFileSync(CORPUS_INDEX_PATH, serializeCorpusIndex(index));
  console.log(
    `corpus index: ${index.entries.length} distinct targets from ${index.chunkCount} chunks → ${path.relative(ROOT, CORPUS_INDEX_PATH)}`,
  );

  console.log(`done — ${ingested} ingested, ${skipped.length} skipped`);
}

/**
 * Cache the PDF and shell out to pdftotext, honouring `source.pages` so a
 * multi-hundred-page compilation contributes only the norma we cite, and
 * `source.excerpt` so a reform decree contributes only the artículo whose
 * wording is still vigente (#176).
 */
function pdfToText(doc: ManifestDoc, pdf: Buffer): string {
  const pdfPath = path.join(CACHE, `${doc.doc_key}.pdf`);
  writeFileSync(pdfPath, pdf);
  const range: string[] = [];
  if (doc.source.pages) {
    const m = doc.source.pages.match(/^(\d+)-(\d+)$/);
    if (!m) {
      throw new Error(
        `${doc.doc_key}: source.pages must be "<first>-<last>", got "${doc.source.pages}"`,
      );
    }
    range.push("-f", m[1], "-l", m[2]);
  }
  // `pdftotext` is blind to embedded rasters, so inspect the same page range
  // before extraction erases the only evidence that a table or formula was a
  // picture. This is a go-look notice, never a verdict or image-triggered
  // failure; small page furniture is filtered by the corpus-derived floor.
  const imageListing = execFileSync("pdfimages", ["-list", ...range, pdfPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const notice = pdfImageNotice(doc.doc_key, imageListing, {
    pages: doc.source.pages,
    imagesAudited: doc.imagesAudited,
  });
  if (notice?.level === "warn") console.warn(`  ⚠ ${notice.message}`);
  else if (notice) console.log(`  ${notice.message}`);
  const text = execFileSync("pdftotext", ["-layout", ...range, pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!doc.source.excerpt) return text;
  try {
    return sliceExcerpt(text, doc.source.excerpt);
  } catch (cause) {
    throw new Error(`${doc.doc_key}: ${(cause as Error).message}`, { cause });
  }
}

async function extract(doc: ManifestDoc): Promise<string[] | null> {
  switch (doc.source.kind) {
    case "sinalevi": {
      const norma = await fetchNorma(doc.source.idFichaNorma!);
      writeFileSync(path.join(CACHE, `${doc.doc_key}.html`), norma.html);
      console.log(
        `  ${doc.doc_key}: vigente version ${norma.cantidadVersiones} (idVersionNorma ${norma.idVersionNorma})`,
      );
      // Images vanish in htmlToParagraphs without leaving a trace, and every
      // downstream gate stays green when they do (#150) — so the payload is
      // the last place the loss is still visible. Warn, never fail: most of
      // these images are decorative, and the ones the manifest records as
      // audited get a receipt rather than a warning (#177).
      const notice = imageMarkupNotice(
        doc.doc_key,
        norma.html,
        doc.imagesAudited,
      );
      if (notice?.level === "warn") console.warn(`  ⚠ ${notice.message}`);
      else if (notice) console.log(`  ${notice.message}`);
      // The anchor map is harvested from the same payload the chunks come
      // from, so a chip can only ever deep-link the version it cites (#134).
      const articulos = articuloAnchors(norma.html);
      console.log(
        `  ${doc.doc_key}: ${Object.keys(articulos).length} artículo anchors`,
      );
      doc.source = {
        ...doc.source,
        ...{ idVersionNorma: norma.idVersionNorma, articulos },
      };
      return htmlToParagraphs(norma.html);
    }
    case "hacienda-pdf": {
      const pdf = await fetchHaciendaPdf(doc.source.url!);
      return textToParagraphs(pdfToText(doc, pdf), {
        table: doc.layoutTable,
        labelRail: doc.labelRail,
        stackedFraction: doc.stackedFraction,
        wrappedRow: doc.wrappedRow,
      });
    }
    case "pdf": {
      const pdf = await fetchPdfSource(
        { url: doc.source.url!, member: doc.source.member },
        CACHE,
      );
      if (doc.source.pages) {
        console.log(`  ${doc.doc_key}: pages ${doc.source.pages}`);
      }
      if (doc.source.excerpt) {
        const slices = excerptSlices(doc.source.excerpt);
        console.log(
          `  ${doc.doc_key}: excerpt ${slices.map((s) => `from "${s.from}"`).join(", ")}`,
        );
      }
      return textToParagraphs(pdfToText(doc, pdf), {
        table: doc.layoutTable,
        labelRail: doc.labelRail,
        stackedFraction: doc.stackedFraction,
        wrappedRow: doc.wrappedRow,
      });
    }
    case "cabys": {
      const file = path.join(ROOT, "corpus", "cabys-dev.json");
      if (!existsSync(file)) {
        console.warn(
          `  ${doc.doc_key}: corpus/cabys-dev.json not curated yet — skipping`,
        );
        return null;
      }
      const rows = JSON.parse(readFileSync(file, "utf8")) as {
        code: string;
        description: string;
        iva: string;
        note?: string;
      }[];
      return rows.map(
        (r) =>
          `Código CABYS ${r.code}: ${r.description}. IVA: ${r.iva}.${r.note ? ` ${r.note}` : ""}`,
      );
    }
    case "unresolved":
      console.warn(
        `  ${doc.doc_key}: source unresolved (${doc.source.hint}) — skipping`,
      );
      return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
