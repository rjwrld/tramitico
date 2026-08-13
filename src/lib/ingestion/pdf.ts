/**
 * Public-PDF fetcher (SPEC §3) for primary sources published as plain files:
 * CCSS actas de Junta Directiva and Imprenta Nacional alcances. Unlike
 * hacienda.go.cr (see hacienda.ts) these hosts have no WAF, so a browser
 * User-Agent over plain fetch is enough — no browser stack required.
 *
 * Some sources are a PDF *inside* a zip: CCSS publishes each sesión's annexed
 * technical documents as `<acta>-<hash>.zip`, and the escala contributiva
 * (issue #114) lives in one of those members rather than in the acta body.
 * `member` selects it; without `member` the payload is the PDF itself.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface PdfSource {
  url: string;
  /** File name inside the zip at `url`, when the PDF is zipped. */
  member?: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetch a source's PDF bytes. `scratchDir` receives the intermediate zip when
 * `member` is set — `unzip` needs a file on disk, and keeping it makes a failed
 * extraction inspectable.
 */
export async function fetchPdfSource(
  source: PdfSource,
  scratchDir: string,
  fetchFn: FetchLike = fetch,
): Promise<Buffer> {
  const res = await fetchFn(source.url, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!res.ok) {
    throw new Error(`PDF fetch failed: HTTP ${res.status} for ${source.url}`);
  }
  const payload = Buffer.from(await res.arrayBuffer());

  const pdf = source.member
    ? extractMember(payload, source.member, scratchDir)
    : payload;

  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error(
      `PDF fetch for ${source.url}${source.member ? ` (${source.member})` : ""}: not a PDF — page shape changed?`,
    );
  }
  return pdf;
}

/**
 * `unzip` (like `pdftotext` in the ingestion runner) is an external binary
 * rather than a dependency — both are already required to build the corpus.
 */
function extractMember(
  zip: Buffer,
  member: string,
  scratchDir: string,
): Buffer {
  const zipPath = path.join(scratchDir, "anexos.zip");
  writeFileSync(zipPath, zip);
  let out: Buffer;
  try {
    out = execFileSync("unzip", ["-p", zipPath, member], {
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (cause) {
    throw new Error(`zip member "${member}" not readable in ${zipPath}`, {
      cause,
    });
  }
  if (out.length === 0) {
    throw new Error(`zip member "${member}" is empty or absent in ${zipPath}`);
  }
  return out;
}
