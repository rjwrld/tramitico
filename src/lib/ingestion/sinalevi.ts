/**
 * SINALEVI API client (SPEC §3; refined from the ticket #3 recipe against the
 * live API — the Informacion shell always reports cantidadVersiones=0, so the
 * count comes from the ficha card instead):
 *   1. POST /_BuscarVersionNorma (numeroVersion=1)  → ficha html carries "1 de M"
 *   2. POST /_BuscarVersionNorma (numeroVersion=M)  → vigente idVersionNorma
 *   3. POST /_CargarTextoCompleto (version=<id>)    → { html } full text
 *
 * Traps encoded here: legacy redirects land on version 1 (never trust it —
 * resolve the vigente id explicitly); a browser User-Agent is required (bare
 * clients get 403); POSTs need an explicit body or the server answers 411;
 * out-of-range numeroVersion returns idVersionNorma 0. TLS errors surface
 * loudly — verification is never disabled (research §4).
 */

import type { Chunk } from "./chunker";
import { BROWSER_UA, type FetchLike } from "./official-http";
export type { FetchLike } from "./official-http";

const BASE = "https://sinalevi.go.cr/ResultadosNormativa";

/**
 * sinalevi.go.cr serves an incomplete TLS chain (missing the "GlobalSign RSA
 * OV SSL CA 2018" intermediate — research §4). We add that intermediate, fetched
 * from the certificate's own AIA URL and vendored in corpus/certs/, to the
 * trusted set. Verification stays fully enabled.
 */
let dispatcher: import("undici").Dispatcher | undefined;

async function sinaleviDispatcher(): Promise<import("undici").Dispatcher> {
  if (!dispatcher) {
    const [{ Agent }, tls, fs, path] = await Promise.all([
      import("undici"),
      import("node:tls"),
      import("node:fs"),
      import("node:path"),
    ]);
    const pem = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../corpus/certs/globalsign-rsa-ov-ssl-ca-2018.pem",
      ),
      "utf8",
    );
    dispatcher = new Agent({
      connect: { ca: [...tls.rootCertificates, pem] },
    });
  }
  return dispatcher;
}

async function defaultFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const d = await sinaleviDispatcher();
  const { fetch: undiciFetch } = await import("undici");
  const res = await undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: d,
  });
  return res as unknown as Response;
}

export interface SinaleviNorma {
  idFichaNorma: number;
  idVersionNorma: number;
  cantidadVersiones: number;
  html: string;
}

async function ensureOk(res: Response, step: string): Promise<Response> {
  if (!res.ok) {
    throw new Error(`SINALEVI ${step} failed: HTTP ${res.status}`);
  }
  return res;
}

async function buscarVersion(
  idFichaNorma: number,
  numeroVersion: number,
  fetchFn: FetchLike,
): Promise<{ html: string; idVersionNorma: number }> {
  const res = await ensureOk(
    await fetchFn(`${BASE}/_BuscarVersionNorma`, {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `idFichaNorma=${idFichaNorma}&numeroVersion=${numeroVersion}`,
    }),
    "_BuscarVersionNorma",
  );
  return (await res.json()) as { html: string; idVersionNorma: number };
}

export async function fetchNorma(
  idFichaNorma: number,
  fetchFn: FetchLike = defaultFetch,
): Promise<SinaleviNorma> {
  // Version 1 always exists; its ficha card carries "1 de M".
  const first = await buscarVersion(idFichaNorma, 1, fetchFn);
  if (!first.idVersionNorma) {
    throw new Error(
      `SINALEVI _BuscarVersionNorma for ${idFichaNorma}: version 1 not found — bad idFichaNorma?`,
    );
  }
  const countMatch = first.html
    .replace(/<[^>]+>/g, " ")
    .match(/1\s*de\s*(\d+)/);
  if (!countMatch) {
    throw new Error(
      `SINALEVI ficha for ${idFichaNorma}: version count ("1 de M") not found — page shape changed?`,
    );
  }
  const cantidadVersiones = Number(countMatch[1]);

  // Resolve the vigente version explicitly — legacy redirects land on version 1.
  const vigente =
    cantidadVersiones === 1
      ? first
      : await buscarVersion(idFichaNorma, cantidadVersiones, fetchFn);
  const idVersionNorma = vigente.idVersionNorma;
  if (!idVersionNorma) {
    throw new Error(
      `SINALEVI _BuscarVersionNorma for ${idFichaNorma}: vigente version ${cantidadVersiones} returned id 0`,
    );
  }

  const textoRes = await ensureOk(
    await fetchFn(`${BASE}/_CargarTextoCompleto`, {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `idFichaNorma=${idFichaNorma}&version=${idVersionNorma}&busqueda=`,
    }),
    "_CargarTextoCompleto",
  );
  const { html } = (await textoRes.json()) as { html: string };
  if (!html) {
    throw new Error(
      `SINALEVI _CargarTextoCompleto for ${idFichaNorma}: empty html payload`,
    );
  }

  return { idFichaNorma, idVersionNorma, cantidadVersiones, html };
}

/**
 * `{ "11": 12 }` — artículo number → the viewer's internal `idArticulo`,
 * harvested from the "Ficha Artículo" rail SINALEVI appends to the full text
 * (issue #134). That id is what `Informacion?…&param3=3&param4=<idArticulo>`
 * opens, and it is the only way to deep-link an artículo: the ids are opaque
 * (they are not the artículo numbers) and `_BuscarArticulo` answers -1 for our
 * fichas, so the rail we already fetch is the source of truth.
 *
 * A number claimed by more than one anchor is dropped: transitorios reuse the
 * artículo numbering ("Artículo 2" and "Artículo 2 Transitorio" both label
 * themselves «artículo número 2» in ficha 99349), and nothing in the rail
 * distinguishes them — an anchor built from an ambiguous number would silently
 * land on the wrong text, so those artículos keep the document-root link.
 */
export function articuloAnchors(html: string): Record<string, number> {
  const seen = new Map<string, number | null>();
  for (const [, numero, , , idArticulo] of html.matchAll(
    /handleArticuloClick\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g,
  )) {
    // 0 is the "abrir la ficha" sentinel, not an artículo.
    if (numero === "0" || idArticulo === "0") continue;
    seen.set(numero, seen.has(numero) ? null : Number(idArticulo));
  }
  return Object.fromEntries(
    [...seen].filter((entry): entry is [string, number] => entry[1] !== null),
  );
}

/**
 * The chunks of a whole-código ficha narrowed to the artículos a manifest
 * entry actually claims (#259).
 *
 * `excerpt` is the wrong instrument here. It bounds one contiguous run of
 * lines, and what a code like the CNPT (ficha 6530, ~200 artículos across
 * nine títulos) contributes is neither contiguous nor line-shaped: the
 * sanctions entry claims arts. 78–81 of Título III, art. 88 twenty lines
 * further down, and art. 57 in a different título altogether. Naming line
 * markers for each of those would encode three fragile guesses about wording
 * the reformers keep rewriting, when the honest claim is simply a list of
 * artículo numbers.
 *
 * So the filter runs *after* chunking, on labels the chunker already derived:
 * each kept chunk keeps the `path` its own headings gave it, so a citation
 * still reads «TÍTULO III … SECCIÓN II … Artículo 78» even though nothing
 * between arts. 57 and 78 was ingested.
 *
 * It fails loudly in every direction a drifting ficha or a slipped manifest
 * edit can break it. A label that matches nothing means the artículo was
 * renumbered, repealed or re-worded — the entry would silently ingest less
 * than it claims. A label that matches chunks under more than one `path`
 * means the número repeats across títulos (ley-9635 has three distinct
 * "Artículo 15"s), so the list no longer names one artículo and the text it
 * would keep is a guess. A label listed twice would ingest that artículo's
 * text twice, seating a duplicate beside itself in retrieval — the one
 * failure the other two guards would let through silently.
 */
export function filterArticulos(
  docKey: string,
  chunks: readonly Chunk[],
  keep: readonly string[],
): Chunk[] {
  const norm = (label: string) =>
    label.replace(/\s+/g, " ").trim().toLowerCase();
  const seen = new Set<string>();
  const kept: Chunk[] = [];
  for (const label of keep) {
    if (seen.has(norm(label))) {
      throw new Error(
        `${docKey}: keepArticulos lists "${label}" twice — its text would be ingested twice`,
      );
    }
    seen.add(norm(label));
    const matches = chunks.filter(
      (c) => c.articulo !== null && norm(c.articulo) === norm(label),
    );
    if (matches.length === 0) {
      throw new Error(
        `${docKey}: keepArticulos names "${label}", which no chunk carries — renumbered, derogado, or re-worded in this version`,
      );
    }
    const paths = new Set(matches.map((c) => JSON.stringify(c.path)));
    if (paths.size > 1) {
      throw new Error(
        `${docKey}: keepArticulos names "${label}", which ${paths.size} different títulos carry — the number is ambiguous, so the text it keeps is a guess`,
      );
    }
    kept.push(...matches);
  }
  // Document order, not manifest order: a reader of the ficha meets art. 57
  // before art. 78 however the list happens to be written.
  return kept.sort((a, b) => chunks.indexOf(a) - chunks.indexOf(b));
}
