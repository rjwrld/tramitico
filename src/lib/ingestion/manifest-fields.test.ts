/**
 * Manifest field/kind invariants (#259).
 *
 * Several `source` fields only mean something for one kind: `keepArticulos`
 * needs the artículo labels only a SINALEVI ficha's chunker produces, and
 * `sha256` needs a PDF to hash. `scripts/ingest.ts` throws when it meets a
 * mismatch, but only for the entries a run actually reaches — and the mistake
 * is made here, in the manifest, by someone copying a neighbouring entry.
 *
 * These are the static half of that guard: they read `corpus/manifest.json`
 * itself, so a misplaced field fails in the keyless per-PR lane rather than
 * waiting for the next `pnpm ingest` to reach that document.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestEntry {
  doc_key: string;
  source: {
    kind: string;
    extractor?: string;
    sha256?: string;
    keepArticulos?: string[];
  };
  imageTranscriptions?: {
    src: string;
    sha256: string;
    text: string;
    fetchFrom?: string;
  }[];
}

const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "corpus", "manifest.json"), "utf8"),
) as { documents: ManifestEntry[] };

const withField = (field: "sha256" | "keepArticulos") =>
  manifest.documents.filter((d) => d.source[field] !== undefined);

describe("corpus/manifest.json source fields match their kind", () => {
  it("keeps keepArticulos on sinalevi entries only", () => {
    const misplaced = withField("keepArticulos")
      .filter((d) => d.source.kind !== "sinalevi")
      .map((d) => `${d.doc_key} (${d.source.kind})`);
    expect(misplaced).toEqual([]);
  });

  it("keeps sha256 on entries that actually fetch a PDF", () => {
    const misplaced = withField("sha256")
      .filter(
        (d) => d.source.kind !== "pdf" && d.source.kind !== "hacienda-pdf",
      )
      .map((d) => `${d.doc_key} (${d.source.kind})`);
    expect(misplaced).toEqual([]);
  });

  it("writes every audited hash as 64 lowercase hex digits", () => {
    // pdfHashNotice throws on a malformed hash, but only once a run reaches
    // that document — a "SHA256 TBD" placeholder should fail before then.
    const malformed = withField("sha256")
      .filter((d) => !/^[a-f0-9]{64}$/.test(d.source.sha256!))
      .map((d) => `${d.doc_key}: ${d.source.sha256}`);
    expect(malformed).toEqual([]);
  });

  it("keeps imageTranscriptions on the ccss-faq-modals extractor only", () => {
    // Only that extractor reads the field; on any other entry the text would
    // sit in the manifest and never reach a chunk (#301).
    const misplaced = manifest.documents
      .filter((d) => d.imageTranscriptions !== undefined)
      .filter((d) => d.source.extractor !== "ccss-faq-modals")
      .map((d) => `${d.doc_key} (${d.source.kind})`);
    expect(misplaced).toEqual([]);
  });

  it("pins every image transcription to an absolute src and a well-formed hash", () => {
    // verifyImageTranscriptions throws on a malformed hash, but only once a
    // run reaches the FAQ; a relative src would never match the extractor's
    // resolved URLs and the transcription would fail as orphaned instead.
    const malformed = manifest.documents
      .flatMap((d) => d.imageTranscriptions ?? [])
      .filter(
        (t) =>
          !/^https:\/\//.test(t.src) ||
          (t.fetchFrom !== undefined && !/^https:\/\//.test(t.fetchFrom)) ||
          !/^[a-f0-9]{64}$/.test(t.sha256) ||
          t.text.trim().length === 0,
      )
      .map((t) => t.src);
    expect(malformed).toEqual([]);
  });

  it("still covers the entries these invariants exist for", () => {
    // A rename that emptied both sets would leave three vacuously green tests.
    expect(withField("keepArticulos").map((d) => d.doc_key)).toContain("cnpt");
    expect(withField("sha256").map((d) => d.doc_key)).toContain(
      "salario-base-2026",
    );
    expect(
      manifest.documents.find((d) => d.doc_key === "ccss-faq")
        ?.imageTranscriptions,
    ).toHaveLength(2);
  });
});
