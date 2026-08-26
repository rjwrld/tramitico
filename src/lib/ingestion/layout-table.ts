/**
 * Column-aware rendering of `pdftotext -layout` tables (issue #179).
 *
 * `textToParagraphs` joins a block's lines with spaces, which is right for
 * prose and destroys a table: `ccss-escala-ivm`'s escala contributiva arrived
 * in the corpus as one run-on line whose header read «Afiliado Estado Art. 78
 * Conjunta» — `Estado` and `Art. 78` fused, because pdftotext puts a single
 * space between them — and whose rows lost their alignment, so categories 2–5
 * (which have no Art. 78 cell) read as three values where category 1 has four.
 * A reader of that fragment, human or model, naturally takes the columns for
 * three contributions *on top of* the conjunta, when the conjunta is their sum.
 *
 * The fix has two halves, and the split is deliberate:
 *
 *   - Structure is recovered here. The *data rows* define the column grid —
 *     they are the lines whose cells are separated by wide, consistent gaps —
 *     and every row is then re-emitted with its cells labelled, one paragraph
 *     each. Labelling per cell rather than per table is what survives the
 *     chunker, which joins paragraphs with a space: a row that carries its own
 *     labels still reads correctly after the row boundaries are gone.
 *
 *   - Labels come from the manifest. The header line cannot be split
 *     structurally: `Estado Art. 78` is one space wide, and every geometric
 *     tie-break (nearest column centre, widest gap) picks «Estado Art.» + «78».
 *     Only a reader of the PDF knows where the label ends, so the manifest
 *     records that reading per document — the same shape as `imagesAudited`
 *     (#177): a human verdict about one source, kept next to the source.
 *
 * Opt-in per document for the same reason. Grid detection is a heuristic, and
 * whether its output reads better than the run-on line is a judgement about a
 * particular table; a document without `layoutTable` in the manifest extracts
 * exactly as it did before.
 */

/** A document's manifest verdict about one table it contains. */
export interface LayoutTableSpec {
  /** Column labels, left to right, as a reader of the PDF sees them. */
  columns: string[];
}

export interface LayoutGrid {
  /** Line indices of the data rows: `[from, to)`. */
  from: number;
  to: number;
  /** `[start, end)` character ranges of each column, left to right. */
  columns: readonly (readonly [number, number])[];
}

/** Runs of whitespace this wide or wider separate columns, narrower ones don't. */
const MIN_GAP = 2;
/** Below this, a "grid" is indistinguishable from indented prose. */
const MIN_COLUMNS = 3;
/**
 * How many contiguous non-blank lines above the grid may be its header.
 *
 * `renderLayoutTable` replaces those lines, so the bound is what stops it
 * eating prose: if a re-published source loses the blank line between the
 * table and the paragraph above it, the run grows past this and ingestion
 * fails instead of silently deleting the paragraph. The ficha's header is
 * three lines; the fourth is slack.
 */
const MAX_HEADER_LINES = 4;

/**
 * Character ranges of the columns shared by every line of `lines`: the
 * complement of the whitespace runs that are blank in all of them.
 */
function columnRanges(lines: string[]): [number, number][] {
  const width = Math.max(...lines.map((l) => l.length));
  const blank = (i: number) =>
    lines.every((l) => i >= l.length || l[i] === " ");

  const columns: [number, number][] = [];
  let i = 0;
  while (i < width) {
    if (blank(i)) {
      let j = i;
      while (j < width && blank(j)) j++;
      if (j - i < MIN_GAP && columns.length > 0) {
        // A narrow gap belongs to the cell it sits inside ("Art. 78").
        columns[columns.length - 1][1] = j;
        i = j;
        continue;
      }
      i = j;
      continue;
    }
    let j = i;
    while (j < width && !blank(j)) j++;
    if (columns.length > 0 && columns[columns.length - 1][1] === i) {
      columns[columns.length - 1][1] = j;
    } else {
      columns.push([i, j]);
    }
    i = j;
  }
  return columns;
}

function cellsOf(line: string, columns: LayoutGrid["columns"]): string[] {
  return columns.map(([start, end], i) =>
    line.slice(start, i === columns.length - 1 ? undefined : end).trim(),
  );
}

/**
 * Every line of a data grid fills most of its columns. Requiring it of *all*
 * of them, not most, is what keeps two kinds of line out of the table: the
 * label/body prose layouts that also produce aligned gaps (a `CONSIDERANDO`
 * rail beside a paragraph fills one column in four), and the stray footnote
 * or wrapped line inside the grid's range, which would otherwise render as a
 * fabricated row of em-dashes with a fragment of prose in one cell.
 */
function looksLikeData(
  lines: string[],
  columns: LayoutGrid["columns"],
): boolean {
  return lines.every(
    (l) => cellsOf(l, columns).filter(Boolean).length >= MIN_COLUMNS,
  );
}

/**
 * The run of consecutive lines in `lines` that forms a `columnCount`-column
 * data grid — the longest one, when rival readings overlap — or null when
 * there is none, or when two of equal length compete.
 *
 * A run is grown from each adjacent pair of lines and extended, both ways, only
 * while the column count holds: that is what keeps the header out of the grid.
 * Including `(colones) Afiliado Estado Art. 78 Conjunta` drops the count from
 * six to five, because the header's single space is not a gap — so the header
 * is excluded, and the grid the data rows agree on survives.
 */
export function findLayoutGrid(
  lines: string[],
  columnCount: number,
): LayoutGrid | null {
  const found = new Map<string, LayoutGrid>();

  for (let seed = 0; seed + 1 < lines.length; seed++) {
    if (!lines[seed].trim() || !lines[seed + 1].trim()) continue;
    const width = columnRanges(lines.slice(seed, seed + 2)).length;
    if (width < MIN_COLUMNS) continue;

    let from = seed;
    let to = seed + 2;
    while (
      to < lines.length &&
      lines[to].trim() &&
      columnRanges(lines.slice(from, to + 1)).length === width
    )
      to++;
    while (
      from > 0 &&
      lines[from - 1].trim() &&
      columnRanges(lines.slice(from - 1, to)).length === width
    )
      from--;

    const columns = columnRanges(lines.slice(from, to));
    if (columns.length !== columnCount) continue;
    if (!looksLikeData(lines.slice(from, to), columns)) continue;
    found.set(`${from}:${to}`, { from, to, columns });
  }

  // Rival readings overlap: the header line plus the first data row also form
  // a six-column grid. The grid the most lines agree on is the table; a tie
  // between two of the same length is a document this heuristic cannot read.
  const ranked = [...found.values()].sort(
    (a, b) => b.to - b.from - (a.to - a.from),
  );
  if (ranked.length === 0) return null;
  if (
    ranked.length > 1 &&
    ranked[1].to - ranked[1].from === ranked[0].to - ranked[0].from
  )
    return null;
  return ranked[0];
}

/** What an empty cell reads as — a gap the row keeps rather than closes. */
const EMPTY_CELL = "—";

/**
 * `lines` with the table replaced: the fused header lines become one line
 * naming the manifest's columns, and each data row becomes its own line of
 * `label: value` cells. Blank lines around each of them make every row a
 * paragraph of its own, so `textToParagraphs` never re-joins them.
 *
 * Throws when the grid is absent or ambiguous. A manifest that names a table
 * the extractor cannot find is wrong about the document, and the silent
 * alternative — ingesting the run-on line the manifest was written to fix — is
 * the failure mode this module exists to end.
 */
export function renderLayoutTable(
  lines: string[],
  spec: LayoutTableSpec,
): string[] {
  const grid = findLayoutGrid(lines, spec.columns.length);
  if (!grid) {
    throw new Error(
      `layoutTable: no unambiguous ${spec.columns.length}-column grid in this document — the source's layout changed, or the manifest's columns are wrong`,
    );
  }

  let headerFrom = grid.from;
  while (headerFrom > 0 && lines[headerFrom - 1].trim()) headerFrom--;
  if (grid.from - headerFrom > MAX_HEADER_LINES) {
    throw new Error(
      `layoutTable: ${grid.from - headerFrom} unbroken lines sit above the table, more than a header — refusing to replace them, because prose deleted here would be lost from the corpus without a trace`,
    );
  }

  const rendered: string[] = [
    "",
    `Columnas de la tabla: ${spec.columns.join(" | ")}.`,
    "",
  ];
  for (const line of lines.slice(grid.from, grid.to)) {
    const cells = cellsOf(line, grid.columns);
    rendered.push(
      spec.columns
        .map((label, i) => `${label}: ${cells[i] || EMPTY_CELL}`)
        .join(" | ") + ".",
      "",
    );
  }

  return [...lines.slice(0, headerFrom), ...rendered, ...lines.slice(grid.to)];
}
