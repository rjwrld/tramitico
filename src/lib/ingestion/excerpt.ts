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
 * A document may need more than one slice. `ccss-escala-salud` (#198) is the
 * case that forced it: the acta's proposal section carries the vigente Salud
 * escala *and* the 2018 IVM escala, whose 8.92% conjunta the 2026 acuerdo has
 * since replaced with 9.91% (`ccss-escala-ivm`), and the four ACUERDOs the
 * document exists for sit *below* that IVM table. One contiguous slice can
 * keep the acuerdos or drop the superseded escala, never both. So the manifest
 * may record an ordered list of slices, joined by a blank line — each one a
 * boundary a human read off the PDF, and each one checked the same way.
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

/**
 * The slices a manifest's `excerpt` claims, in document order.
 *
 * The field is one slice or a list of them, and both readers of it — this
 * module and the ingestion runner's log line — need the list form. Exported
 * so there is one answer to "what does this manifest entry claim", rather
 * than an `Array.isArray` here and a `.flat()` there drifting apart.
 */
export const excerptSlices = (
  spec: ExcerptSpec | readonly ExcerptSpec[],
): readonly ExcerptSpec[] => ("from" in spec ? [spec] : spec);

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

/** `[from, to)` line range one slice claims, resolved against `lines`. */
function resolve(lines: string[], spec: ExcerptSpec): [number, number] {
  const from = locate(lines, spec.from, "from");
  if (spec.to === undefined) return [from, lines.length];

  const to = locate(lines, spec.to, "to");
  if (to <= from) {
    throw new Error(
      `excerpt.to: "${spec.to}" sits above excerpt.from "${spec.from}" — the excerpt would be empty`,
    );
  }
  return [from, to];
}

/**
 * `text` narrowed to the lines the manifest's excerpt claims — one slice, or
 * several joined by a blank line.
 *
 * Several slices must be given in document order and must not overlap. Both
 * are refused rather than repaired: a manifest whose slices cross has lost
 * track of what the document says, and silently sorting or merging them would
 * ingest a text no one wrote, in an order no reader of the PDF would recognise.
 *
 * The blank line between slices is a *paragraph* break, not a chunk boundary.
 * `textToParagraphs` splits on it, and then a document chunked by `articulo`
 * joins every paragraph back with a space — so the text either side of a cut
 * meets in one chunk, in reading order, exactly as two paragraphs of the same
 * artículo would. Choose the boundaries so that meeting reads correctly; the
 * blank line will not keep them apart.
 */
export function sliceExcerpt(
  text: string,
  spec: ExcerptSpec | readonly ExcerptSpec[],
): string {
  const specs = excerptSlices(spec);
  if (specs.length === 0) {
    throw new Error("excerpt: no slices — an empty list claims nothing");
  }

  const lines = text.split("\n");
  const ranges = specs.map((s) => resolve(lines, s));
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][1]) {
      throw new Error(
        `excerpt: slice ${i + 1} ("${specs[i].from}") starts above the end of slice ${i} — the slices overlap or are out of document order`,
      );
    }
  }

  return ranges
    .map(([from, to]) => lines.slice(from, to).join("\n"))
    .join("\n\n");
}
