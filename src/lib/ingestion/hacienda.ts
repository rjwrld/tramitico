/**
 * hacienda.go.cr fetcher. The WAF fingerprints the TLS stack: plain fetch/curl
 * receives an HTTP 400 interstitial regardless of headers (ticket #3), while a
 * real browser network stack passes with zero cookies. So PDFs are fetched
 * through a Playwright browser context's request API.
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";

export interface PdfHashNotice {
  level: "info" | "warn";
  message: string;
}

/**
 * Compare a fetched, silently-republished PDF with its audited manifest hash.
 *
 * A mismatch fails the document: the hash records the bytes a human read, and
 * a warning let a republished PDF's unread figures ingest under the audited
 * entry with nobody obliged to look. `accepted` holds the doc_keys the owner
 * has named on this run (`pnpm ingest --accept-pdf-hash <doc_key>`), each
 * accepted on its own, so taking one republication waves no other through.
 */
export function pdfHashNotice(
  docKey: string,
  pdf: Buffer,
  expected: string,
  accepted: ReadonlySet<string> = new Set(),
): PdfHashNotice {
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`${docKey}: source.sha256 must be 64 lowercase hex digits`);
  }
  const actual = createHash("sha256").update(pdf).digest("hex");
  if (actual === expected) {
    return {
      level: "info",
      message: `${docKey}: PDF SHA-256 ${actual} matches manifest`,
    };
  }
  const changed = `${docKey}: PDF SHA-256 changed — manifest ${expected}, fetched ${actual}`;
  if (!accepted.has(docKey)) {
    throw new Error(
      `${changed}. The source was republished: read the new PDF, then set source.sha256 to ${actual} in corpus/manifest.json, or ingest these bytes once with --accept-pdf-hash ${docKey}`,
    );
  }
  return {
    level: "warn",
    message: `${changed}; ingesting anyway (--accept-pdf-hash ${docKey}) — set source.sha256 to ${actual} in corpus/manifest.json once the new PDF is audited`,
  };
}

export async function fetchHaciendaPdf(url: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const response = await context.request.get(url);
    if (!response.ok()) {
      throw new Error(
        `Hacienda fetch failed: HTTP ${response.status()} for ${url}`,
      );
    }
    const body = await response.body();
    const head = body.subarray(0, 5).toString("latin1");
    if (!head.startsWith("%PDF")) {
      throw new Error(
        `Hacienda fetch for ${url}: response is not a PDF (WAF interstitial?)`,
      );
    }
    return body;
  } finally {
    await browser.close();
  }
}
