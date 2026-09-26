/**
 * Ingestion runner (SPEC §4): fetch → clean → chunk → embed → upsert.
 * Idempotent per document: the document row is upserted by doc_key and its
 * chunks are replaced wholesale on every run.
 *
 * Usage:
 *   pnpm ingest              # every ingestable manifest entry
 *   pnpm ingest ley-10363    # one or more doc_keys
 *   pnpm ingest tribu-cr-faq --accept-pdf-hash tribu-cr-faq
 *                            # ingest a republished PDF whose sha256 changed
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildCorpusIndex,
  CORPUS_INDEX_PATH,
  type CorpusIndex,
  fetchCorpusChunks,
  formatCorpusIndex,
  parseCorpusIndex,
  sameCoverage,
} from "../src/lib/eval/corpus-index";
import {
  chunkDocument,
  type Chunk,
  type ChunkOptions,
} from "../src/lib/ingestion/chunker";
import {
  faqCountMessage,
  extractCcssFaqChunks,
  fetchCcssFaq,
  verifyImageTranscriptions,
  type FaqImageTranscription,
} from "../src/lib/ingestion/ccss-faq";
import {
  extractCcssPrescripcionChunks,
  fetchCcssPrescripcion,
  headingCountMessage,
} from "../src/lib/ingestion/ccss-prescripcion";
import {
  ingestChunks,
  ingestDocument,
} from "../src/lib/ingestion/ingest-document";
import { createEmbedder } from "../src/lib/ingestion/embedder";
import { loadDotEnvLocal } from "../src/lib/ingestion/dotenv-local";
import type { DerivedFigure } from "../src/lib/answer/derived";
import {
  type ExcerptSpec,
  excerptSlices,
  sliceExcerpt,
} from "../src/lib/ingestion/excerpt";
import {
  htmlToParagraphs,
  htmlExcerptToParagraphs,
  imageMarkupNotice,
  textToParagraphs,
} from "../src/lib/ingestion/extract";
import { fetchHaciendaPdf, pdfHashNotice } from "../src/lib/ingestion/hacienda";
import {
  assertAcceptedPdfHashes,
  parseIngestArgs,
} from "../src/lib/ingestion/ingest-args";
import type { LayoutTableSpec } from "../src/lib/ingestion/layout-table";
import { fetchPdfSource } from "../src/lib/ingestion/pdf";
import { pdfImageNotice } from "../src/lib/ingestion/pdf-images";
import { retireDocuments } from "../src/lib/ingestion/retire";
import type { DeepLinkKind } from "../src/lib/retrieval";
import {
  articuloAnchors,
  fetchNorma,
  filterArticulos,
} from "../src/lib/ingestion/sinalevi";

interface ManifestDoc {
  doc_key: string;
  title: string;
  norma: string | null;
  source: {
    kind: "sinalevi" | "html" | "hacienda-pdf" | "pdf" | "cabys" | "unresolved";
    idFichaNorma?: number;
    url?: string;
    /** `html` only: the source-specific structured extractor to run. */
    extractor?: "ccss-faq-modals" | "ccss-prescripcion-headings";
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
     * The portion of an extracted PDF or SINALEVI ficha this entry actually
     * claims, bounded by two markers a human read off the source (#176, #256).
     * Required where
     * the page range is a *reform decree*: its neighbouring pages carry other
     * incisos of the same decree that later reforms have since superseded, and
     * a page-granular range would seat those beside vigente chunks. Absent →
     * the whole page range is ingested. A list where the claim is not
     * contiguous — the acuerdo and the escala it adopts sitting either side of
     * a superseded table (#198). See excerpt.ts.
     */
    excerpt?: ExcerptSpec | ExcerptSpec[];
    /**
     * `sinalevi` only — unlike `excerpt`, which every extracted kind honours,
     * so `extract` refuses it on any other kind rather than ignore it: the
     * artículo labels this entry claims out of a whole código, applied after
     * chunking (#259). The instrument `excerpt` is not: the claim is a handful
     * of numbered artículos scattered across títulos, not one contiguous run
     * of lines. Absent → the whole ficha is ingested. See sinalevi.ts.
     */
    keepArticulos?: string[];
    catalog?: string;
    hint?: string;
    /**
     * Deep-link capability of this source's official URL, audited per entry
     * (issue #134): `articulo` (SINALEVI artículo view), `page` (`#page=` into
     * a page-ranged PDF) or `none` (document root is the deepest honest link).
     */
    deepLink: DeepLinkKind;
    /**
     * Audited SHA-256 for an official PDF that is silently republished — both
     * PDF kinds honour it. `extract` refuses it on the kinds that fetch no
     * PDF, rather than accept a hash it would never check.
     */
    sha256?: string;
    /** `sinalevi` only: artículo number → viewer id, harvested at ingestion. */
    articulos?: Record<string, number>;
  };
  /** ISO date the document's text takes effect (SPEC §3 provenance). */
  effective_date?: string;
  /** True when this entry carries a numeric figure that requires a date. */
  carriesFigures?: boolean;
  /** True when the source must be replaced or re-verified each fiscal year. */
  annualChurn?: boolean;
  /** Current fiscal year verified for an unchanged, older effective date. */
  verifiedForFiscalYear?: number;
  /** Source-gated arithmetic made available to answer assembly (#263). */
  derivedFigures?: DerivedFigure[];
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
   * `html` + `ccss-faq-modals` only: a human's transcription of each FAQ
   * answer that the page publishes as a picture, keyed by the image's URL and
   * pinned to the bytes' SHA-256 (#301). Present → the chunk carries the
   * transcribed text in place of the «Imagen incluida» notice, ingestion
   * fails loudly when the bytes change or the crawl no longer links the
   * image. The `html` branch refuses it on its sibling extractor, and the
   * static guard in manifest-fields.test.ts refuses it on every other kind,
   * so it cannot sit in the manifest and never reach a chunk. Absent → image
   * answers keep the notice and the link.
   */
  imageTranscriptions?: FaqImageTranscription[];
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

async function main() {
  loadDotEnvLocal(path.join(ROOT, ".env.local"));
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

  const { docKeys: wanted, acceptPdfHash } = parseIngestArgs(
    process.argv.slice(2),
  );
  const docs = manifest.documents.filter(
    (d) => wanted.length === 0 || wanted.includes(d.doc_key),
  );
  if (wanted.length > 0 && docs.length !== wanted.length) {
    const known = new Set(docs.map((d) => d.doc_key));
    throw new Error(
      `Unknown doc_key(s): ${wanted.filter((w) => !known.has(w)).join(", ")}`,
    );
  }
  assertAcceptedPdfHashes(acceptPdfHash, docs);

  mkdirSync(CACHE, { recursive: true });
  let ingested = 0;
  const skipped: string[] = [];

  for (const doc of docs) {
    const extracted = await extract(doc, acceptPdfHash);
    if (extracted === null) {
      skipped.push(doc.doc_key);
      continue;
    }
    const written =
      extracted.kind === "chunks"
        ? await ingestChunks(
            { client: supabase, embedder },
            doc,
            extracted.value,
          )
        : await ingestDocument(
            { client: supabase, embedder },
            doc,
            extracted.value,
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
  // Written only when the coverage changed, and prettier-formatted, so an
  // unchanged corpus leaves a clean tree and a changed one is ready to commit.
  const index = buildCorpusIndex(
    await fetchCorpusChunks(supabase),
    new Date().toISOString(),
  );
  const indexPath = path.relative(ROOT, CORPUS_INDEX_PATH);
  const committed = readCommittedIndex();
  if (committed && sameCoverage(committed, index)) {
    console.log(
      `corpus index: unchanged — ${index.entries.length} distinct targets from ${index.chunkCount} chunks; ${indexPath} left as is`,
    );
  } else {
    writeFileSync(CORPUS_INDEX_PATH, await formatCorpusIndex(index));
    console.log(
      `corpus index: CHANGED — ${index.entries.length} distinct targets from ${index.chunkCount} chunks → ${indexPath}; commit it with this corpus change (#163)`,
    );
  }

  console.log(`done — ${ingested} ingested, ${skipped.length} skipped`);
}

/** The index on disk, or null when there is none or it does not parse. */
function readCommittedIndex(): CorpusIndex | null {
  if (!existsSync(CORPUS_INDEX_PATH)) return null;
  try {
    return parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));
  } catch {
    return null;
  }
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

/**
 * Report an audited PDF against its manifest hash (#259 follow-up).
 *
 * Both PDF kinds need this and neither owns it: `hacienda-pdf` had the only
 * call, so a `sha256` on a plain `pdf` entry — an Imprenta Nacional alcance or
 * a CCSS acta, exactly the documents that get silently republished — was
 * accepted by the manifest type and then never checked. A shared helper is
 * what stops the two branches drifting again.
 *
 * A mismatch fails the document — and so the run — unless this run names it
 * with `--accept-pdf-hash <doc_key>`: the hash records what a human audited,
 * and a warning let unread bytes ingest with nobody obliged to look. Accepted,
 * it still warns, with the hash to write into the manifest.
 */
function reportPdfHash(
  doc: ManifestDoc,
  pdf: Buffer,
  acceptPdfHash: ReadonlySet<string>,
): void {
  if (!doc.source.sha256) return;
  const notice = pdfHashNotice(
    doc.doc_key,
    pdf,
    doc.source.sha256,
    acceptPdfHash,
  );
  if (notice.level === "warn") console.warn(`  ⚠ ${notice.message}`);
  else console.log(`  ${notice.message}`);
}

type ExtractedContent =
  { kind: "paragraphs"; value: string[] } | { kind: "chunks"; value: Chunk[] };

async function extract(
  doc: ManifestDoc,
  acceptPdfHash: ReadonlySet<string>,
): Promise<ExtractedContent | null> {
  // `excerpt` narrows a PDF and a ficha alike, so a reader may reasonably
  // expect its sibling to travel as far. It cannot: it filters chunks the
  // artículo chunker labelled, which only a norma has. Refuse it here rather
  // than let a misplaced list ingest the whole document unfiltered.
  if (doc.source.keepArticulos && doc.source.kind !== "sinalevi") {
    throw new Error(
      `${doc.doc_key}: source.keepArticulos is sinalevi-only, but this entry is "${doc.source.kind}"`,
    );
  }
  if (
    doc.source.sha256 &&
    doc.source.kind !== "pdf" &&
    doc.source.kind !== "hacienda-pdf"
  ) {
    throw new Error(
      `${doc.doc_key}: source.sha256 needs a PDF to hash, but this entry is "${doc.source.kind}"`,
    );
  }
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
      if (doc.source.keepArticulos) {
        if (doc.source.excerpt) {
          throw new Error(
            `${doc.doc_key}: source.excerpt and source.keepArticulos both narrow this ficha — pick one`,
          );
        }
        const keep = doc.source.keepArticulos;
        console.log(`  ${doc.doc_key}: keeping artículos ${keep.join(", ")}`);
        return {
          kind: "chunks",
          value: filterArticulos(
            doc.doc_key,
            chunkDocument(
              doc.doc_key,
              doc.title,
              htmlToParagraphs(norma.html),
              doc.chunking ?? {},
            ),
            keep,
          ),
        };
      }
      if (!doc.source.excerpt) {
        return { kind: "paragraphs", value: htmlToParagraphs(norma.html) };
      }
      const slices = excerptSlices(doc.source.excerpt);
      console.log(
        `  ${doc.doc_key}: excerpt ${slices.map((s) => `from "${s.from}"`).join(", ")}`,
      );
      try {
        return {
          kind: "paragraphs",
          value: htmlExcerptToParagraphs(norma.html, doc.source.excerpt),
        };
      } catch (cause) {
        throw new Error(`${doc.doc_key}: ${(cause as Error).message}`, {
          cause,
        });
      }
    }
    case "html": {
      if (
        doc.source.extractor !== "ccss-faq-modals" &&
        doc.source.extractor !== "ccss-prescripcion-headings"
      ) {
        throw new Error(
          `${doc.doc_key}: unknown HTML extractor "${doc.source.extractor ?? "missing"}"`,
        );
      }
      const url = doc.source.url!;
      const cachePath = path.join(CACHE, `${doc.doc_key}.html`);
      const prescription =
        doc.source.extractor === "ccss-prescripcion-headings";
      if (prescription && doc.imageTranscriptions) {
        throw new Error(
          `${doc.doc_key}: imageTranscriptions is only honoured by the ccss-faq-modals extractor`,
        );
      }
      const html = prescription
        ? await fetchCcssPrescripcion(url)
        : await fetchCcssFaq(url);
      // Before extraction: a transcription is the chunk's whole content, so a
      // republished image must stop the run, not ingest last year's numbers.
      for (const receipt of await verifyImageTranscriptions(
        doc.doc_key,
        doc.imageTranscriptions ?? [],
      )) {
        console.log(`  ${receipt}`);
      }
      const extractChunks = (source: string, minimum?: number) =>
        prescription
          ? extractCcssPrescripcionChunks(
              doc.doc_key,
              doc.title,
              source,
              url,
              minimum,
            )
          : extractCcssFaqChunks(doc.doc_key, doc.title, source, url, {
              minimum,
              transcriptions: doc.imageTranscriptions,
              onDuplicate: (dropped, kept) =>
                console.log(
                  `  ${doc.doc_key}: dropped body duplicate «${dropped.articulo}» (${dropped.path.join("/")}) — kept «${kept.articulo}» (${kept.path.join("/")}) (#301)`,
                ),
            });
      const chunks = extractChunks(html);
      let previous: number | undefined;
      if (existsSync(cachePath)) {
        try {
          previous = extractChunks(readFileSync(cachePath, "utf8"), 1).length;
        } catch {
          // A stale/unreadable cache is not a trustworthy comparison point.
        }
      }
      console.log(
        `  ${doc.doc_key}: ${
          prescription
            ? headingCountMessage(chunks.length, previous)
            : faqCountMessage(chunks.length, previous)
        }`,
      );
      writeFileSync(cachePath, html);
      return { kind: "chunks", value: chunks };
    }
    case "hacienda-pdf": {
      const pdf = await fetchHaciendaPdf(doc.source.url!);
      reportPdfHash(doc, pdf, acceptPdfHash);
      return {
        kind: "paragraphs",
        value: textToParagraphs(pdfToText(doc, pdf), {
          table: doc.layoutTable,
          labelRail: doc.labelRail,
          stackedFraction: doc.stackedFraction,
          wrappedRow: doc.wrappedRow,
        }),
      };
    }
    case "pdf": {
      const pdf = await fetchPdfSource(
        { url: doc.source.url!, member: doc.source.member },
        CACHE,
      );
      // After the zip member is extracted, so the hash covers the bytes this
      // entry actually ingests rather than the archive they arrived in.
      reportPdfHash(doc, pdf, acceptPdfHash);
      if (doc.source.pages) {
        console.log(`  ${doc.doc_key}: pages ${doc.source.pages}`);
      }
      if (doc.source.excerpt) {
        const slices = excerptSlices(doc.source.excerpt);
        console.log(
          `  ${doc.doc_key}: excerpt ${slices.map((s) => `from "${s.from}"`).join(", ")}`,
        );
      }
      return {
        kind: "paragraphs",
        value: textToParagraphs(pdfToText(doc, pdf), {
          table: doc.layoutTable,
          labelRail: doc.labelRail,
          stackedFraction: doc.stackedFraction,
          wrappedRow: doc.wrappedRow,
        }),
      };
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
      return {
        kind: "paragraphs",
        value: rows.map(
          (r) =>
            `Código CABYS ${r.code}: ${r.description}. IVA: ${r.iva}.${r.note ? ` ${r.note}` : ""}`,
        ),
      };
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
