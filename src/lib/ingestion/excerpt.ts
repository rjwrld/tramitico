/**
 * Sub-page narrowing of a page-ranged PDF source (issue #176).
 *
 * `source.pages` is the coarse knob: it keeps a norma from being buried under
 * the hundreds of unrelated chunks a Gaceta alcance or a CCSS acta carries
 * around it. It is not fine enough for a *reform decree*, where the hazard is
 * not noise but wrong law. Decreto 43173-H is the case that forced this: the
 * page carrying the vigente artículo 31 inciso 4) also carries the same
 * decree's «46) Seguros de sobrevivencia», an inciso a later reform (44392)
 * renumbered to 49). Ingesting the page whole would seat a superseded
 * numbering beside vigente chunks — the exact trade #150 refused when it left
 * these formulas as gaps rather than ingest the 2019 wording.
 *
 * So the manifest records where the excerpt starts and where it stops, read
 * off the PDF by a human: the same shape as `pages`, `layoutTable` (#179) and
 * `imagesAudited` (#177) — a human verdict about one source, kept next to it.
 *
 * Markers are matched against whitespace-collapsed lines, because
 * `pdftotext -layout` pads headings with runs of spaces that no one should
 * have to transcribe, and they must match exactly one line each: a marker that
 * has drifted, or that now matches two places, fails ingestion loudly. The
 * silent alternative — quietly ingesting a neighbouring artículo the manifest
 * never claimed — is what this module exists to prevent.
 */

/** Where one artículo starts and stops inside a page range. */
export interface ExcerptSpec {
  /** Text carried by the first line of the excerpt. */
  from: string;
  /** Text carried by the first line *after* it; omit to run to the end. */
  to?: string;
}

const flatten = (s: string) => s.replace(/\s+/g, " ").trim();

/** The single index in `lines` whose flattened text carries `marker`. */
function locate(lines: string[], marker: string, field: "from" | "to"): number {
  const needle = flatten(marker);
  const hits = lines.flatMap((line, i) =>
    flatten(line).includes(needle) ? [i] : [],
  );
  if (hits.length === 0) {
    throw new Error(
      `excerpt.${field}: no line carries "${marker}" — the source's wording or page range changed`,
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `excerpt.${field}: ${hits.length} lines carry "${marker}" — the marker is ambiguous, so the boundary it names is a guess`,
    );
  }
  return hits[0];
}

/** `text` narrowed to the lines the manifest's excerpt claims. */
export function sliceExcerpt(text: string, spec: ExcerptSpec): string {
  const lines = text.split("\n");
  const from = locate(lines, spec.from, "from");
  if (spec.to === undefined) return lines.slice(from).join("\n");

  const to = locate(lines, spec.to, "to");
  if (to <= from) {
    throw new Error(
      `excerpt.to: "${spec.to}" sits above excerpt.from "${spec.from}" — the excerpt would be empty`,
    );
  }
  return lines.slice(from, to).join("\n");
}
