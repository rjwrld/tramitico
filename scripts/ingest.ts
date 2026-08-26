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
import { chunkDocument, type ChunkOptions } from "../src/lib/ingestion/chunker";
import { createEmbedder } from "../src/lib/ingestion/embedder";
import { type ExcerptSpec, sliceExcerpt } from "../src/lib/ingestion/excerpt";
import {
  htmlToParagraphs,
  imageMarkupNotice,
  textToParagraphs,
} from "../src/lib/ingestion/extract";
import { fetchHaciendaPdf } from "../src/lib/ingestion/hacienda";
import type { LayoutTableSpec } from "../src/lib/ingestion/layout-table";
import { fetchPdfSource } from "../src/lib/ingestion/pdf";
import { replaceDocumentChunks } from "../src/lib/ingestion/replace";
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
     * the whole page range is ingested. See excerpt.ts.
     */
    excerpt?: ExcerptSpec;
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
   * Every image `src` a human has looked at, for documents carrying an IMAGE
   * AUDIT note (#150). Present → the ingestion notice is quiet while the
   * payload's images stay inside this set, and loud the moment a re-crawl adds
   * one the audit never saw. Absent → the payload is warned about every run.
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
  ) as { documents: ManifestDoc[] };

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
    const chunks = chunkDocument(
      doc.doc_key,
      doc.title,
      paragraphs,
      doc.chunking ?? {},
    );
    if (chunks.length === 0) {
      throw new Error(`${doc.doc_key}: extraction produced zero chunks`);
    }

    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += 64) {
      embeddings.push(
        ...(await embedder.embed(
          chunks.slice(i, i + 64).map((c) => c.content),
        )),
      );
    }

    const { data: docRow, error: docErr } = await supabase
      .from("documents")
      .upsert(
        {
          doc_key: doc.doc_key,
          title: doc.title,
          norma: doc.norma,
          source: doc.source,
          effective_date: doc.effective_date ?? null,
          fetched_at: new Date().toISOString(),
          embedding_provider: embedder.provider,
          embedding_dim: embedder.dimensions,
        },
        { onConflict: "doc_key" },
      )
      .select("id")
      .single();
    if (docErr)
      throw new Error(`${doc.doc_key}: upsert document — ${docErr.message}`);

    await replaceDocumentChunks(supabase, docRow.id, chunks, embeddings);

    ingested++;
    console.log(`✓ ${doc.doc_key}: ${chunks.length} chunks`);
  }

  if (skipped.length > 0) {
    console.log(`skipped (source pending): ${skipped.join(", ")}`);
  }
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
      return textToParagraphs(pdfToText(doc, pdf), doc.layoutTable);
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
        console.log(
          `  ${doc.doc_key}: excerpt from "${doc.source.excerpt.from}"`,
        );
      }
      return textToParagraphs(pdfToText(doc, pdf), doc.layoutTable);
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
