/**
 * A table row whose left cell wraps below its own right cell (issue #242).
 *
 * `reglamento-iva-retencion-tarjetas`'s %RT bracket table is two columns —
 * a condition and a rate — and four of its five rows are one line each, so
 * they join in reading order and read correctly. The fifth wraps, and
 * `pdftotext -layout` puts a blank line *inside* the row, between the first
 * line of the condition and its last word:
 *
 *     90% o menos del 100% de ventas locales, exentas o no                1%
 *
 *               sujetas
 *
 * `textToParagraphs` splits on the blank line, so the row reaches the chunk
 * as «…exentas o no 1% sujetas»: the rate spliced into the middle of its own
 * condition, and the condition's last word stranded after it.
 *
 * The blank line is line spacing, not a paragraph boundary — the whole
 * excerpt is set that way, every prose line one blank apart — but no policy
 * about blank lines fixes this, because the fault is column order: joining
 * the block whole still puts «1%» before «sujetas». The fix has to know the
 * fragment belongs to the left cell, and it knows that from geometry alone:
 * the fragment sits *inside* the left cell's span (its first character is to
 * the right of where the cell starts, its last is to the left of where the
 * right cell starts), it carries no second cell of its own, and it is one
 * blank line below a two-cell line. Nothing else in the corpus has that
 * shape: a new paragraph starts at or left of the margin, a prose wrap runs
 * to the right edge, and a data row has its own right cell.
 *
 * Neither `labelRail` (#199) nor `layoutTable` (#179) covers this. The rail
 * joins every left cell of a block and then every right cell, which is right
 * for one row and wrong for five; the grid needs three columns filled on
 * every line. The rule here is narrower than either and does one thing:
 * moves the fragment up into the cell it fell out of, leaving the rate where
 * the row keeps it.
 *
 * Opt-in per document (`wrappedRow` in the manifest), for #179's reason: a
 * document without the flag extracts byte-for-byte as it did before, and a
 * flagged document in which the shape is no longer found fails ingestion
 * rather than silently re-ingesting the spliced text the flag was set to fix.
 */

/** Runs of whitespace this wide or wider separate cells, narrower ones don't. */
const MIN_GAP = 3;

/** A run of ink on one line, and the column range it occupies: `[start, end)`. */
interface Cell {
  start: number;
  end: number;
  text: string;
}

function cellsOf(line: string): Cell[] {
  const gap = new RegExp(`\\S.*?(?= {${MIN_GAP},}|$)`, "g");
  const cells: Cell[] = [];
  for (const m of line.trimEnd().matchAll(gap)) {
    cells.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return cells;
}

/**
 * The two-cell row `lines[i]` re-joined with the fragment at `lines[i + 2]`,
 * or null when the three lines are not that shape.
 */
function readWrappedRow(lines: string[], i: number): string | null {
  const [row, blank, fragment, below] = lines.slice(i, i + 4);
  if (fragment === undefined) return null;
  if (blank.trim() !== "" || fragment.trim() === "") return null;
  // The fragment is a block of its own: a line under it would make it the
  // first line of a paragraph, not the last word of a cell.
  if (below !== undefined && below.trim() !== "") return null;

  const cells = cellsOf(row);
  if (cells.length !== 2) return null;
  const [left, right] = cells;

  const parts = cellsOf(fragment);
  if (parts.length !== 1) return null;
  const [part] = parts;
  if (part.start <= left.start || part.end >= right.start) return null;

  const joined = `${left.text} ${part.text}`;
  const pad = Math.max(right.start - left.start - joined.length, MIN_GAP);
  return `${" ".repeat(left.start)}${joined}${" ".repeat(pad)}${right.text}`;
}

/**
 * `lines` with every wrapped row re-joined onto its own line, so
 * `textToParagraphs` has one line to read rather than a row and a stray word.
 *
 * Throws when the document has no wrapped row: a manifest that declares one
 * the extractor cannot find is wrong about the document, and the silent
 * alternative is the failure mode this module exists to end (#179's rule).
 */
export function renderWrappedRow(lines: string[]): string[] {
  const out: string[] = [];
  let rows = 0;
  for (let i = 0; i < lines.length; i++) {
    const row = readWrappedRow(lines, i);
    if (row === null) {
      out.push(lines[i]);
      continue;
    }
    out.push(row);
    rows++;
    i += 2;
  }
  if (rows === 0) {
    throw new Error(
      "wrappedRow: no wrapped row in this document — the source's layout changed, or this document never had one",
    );
  }
  return out;
}
