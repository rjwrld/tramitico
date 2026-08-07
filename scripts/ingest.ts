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
import { chunkDocument } from "../src/lib/ingestion/chunker";
import { createEmbedder } from "../src/lib/ingestion/embedder";
import {
  htmlToParagraphs,
  textToParagraphs,
} from "../src/lib/ingestion/extract";
import { fetchHaciendaPdf } from "../src/lib/ingestion/hacienda";
import { replaceDocumentChunks } from "../src/lib/ingestion/replace";
import { fetchNorma } from "../src/lib/ingestion/sinalevi";

interface ManifestDoc {
  doc_key: string;
  title: string;
  norma: string | null;
  source: {
    kind: "sinalevi" | "hacienda-pdf" | "cabys" | "unresolved";
    idFichaNorma?: number;
    url?: string;
    catalog?: string;
    hint?: string;
  };
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
    const chunks = chunkDocument(doc.doc_key, doc.title, paragraphs);
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

async function extract(doc: ManifestDoc): Promise<string[] | null> {
  switch (doc.source.kind) {
    case "sinalevi": {
      const norma = await fetchNorma(doc.source.idFichaNorma!);
      writeFileSync(path.join(CACHE, `${doc.doc_key}.html`), norma.html);
      console.log(
        `  ${doc.doc_key}: vigente version ${norma.cantidadVersiones} (idVersionNorma ${norma.idVersionNorma})`,
      );
      doc.source = {
        ...doc.source,
        ...{ idVersionNorma: norma.idVersionNorma },
      };
      return htmlToParagraphs(norma.html);
    }
    case "hacienda-pdf": {
      const pdf = await fetchHaciendaPdf(doc.source.url!);
      const pdfPath = path.join(CACHE, `${doc.doc_key}.pdf`);
      writeFileSync(pdfPath, pdf);
      const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      return textToParagraphs(text);
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
