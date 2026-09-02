/**
 * Two-column form layouts in `pdftotext -layout` output (issue #199).
 *
 * `textToParagraphs` joins a block's lines with spaces. For prose that is
 * right; for a form laid out as a narrow rail beside a wide body it splices
 * the rail's words into whatever position they happened to occupy on the page.
 * `ccss-escala-ivm`'s ficha técnica arrived in the corpus reading «…en
 * relación con la CONSIDERANDO aplicación del artículo 33°…», and — the case
 * that matters — with `ACUERDO` sitting between two bullets of one list, so
 * «Estado (Cuota complementaria)» and «Estado como Tal», the two concepts
 * #179 exists to keep apart, read as though they belonged to different
 * headings. `tramos-renta-2026` has the mirror image: a narrow *right* column
 * carrying the rate, dropped into the middle of the bracket it applies to
 * («…mensuales y 15% hasta ¢2.364.000,00…»).
 *
 * Both are the same shape — two columns, one of them short cells, the other
 * continuous prose — and both are read the same way: join each column in
 * document order and render the block as `left: right`. Reading order is
 * preserved either way round, which is why one rule covers a label rail and a
 * rate rail without knowing which it is looking at.
 *
 * This is deliberately *not* `layoutTable` (#179). That machinery recovers a
 * data grid, and its acceptance test is that every line of the run fills most
 * of its columns — which a rail fails by design, only one line in four filling
 * the whole width. The exclusion is correct: rendering `PROPUESTAS | DE | • |
 * Afiliado: 0,16 p.p.` as a table row would be worse than the run-on line.
 * Here the discriminator is the complement of that one: a column of *short,
 * sparse* cells — fewer cells than the block has lines — beside a column that
 * is not. A data grid has a cell on every line of every column and is left
 * alone; see the tests, which assert both directions.
 *
 * Opt-in per document (`labelRail` in the manifest), for #179's reason:
 * detection is a heuristic, and a document without the flag extracts exactly
 * as it did before. The survey behind #199 found the shape in two of the seven
 * PDF-sourced documents; those two carry the flag.
 */

import { type ColumnLine, columnsOf, isBlank } from "./column-model";

/** Runs of whitespace this wide or wider separate columns, narrower ones don't. */
const MIN_GUTTER = 3;
/**
 * Longest a cell can be and still read as a label or a value rather than
 * prose. The rail's own cells are «CONSIDERANDO», «Responsable de la»,
 * «No están sujetas al impuesto», «¢20.520 veinte mil»; the body lines beside
 * them run to eighty characters and more.
 */
const MAX_LABEL_CHARS = 40;
/**
 * A cell of the label column has to say something. Without this the bullet
 * glyphs of an indented list — their own column, three characters clear of the
 * text — read as a rail, and every bullet of `tribu-cr-guia` becomes «•: …».
 */
const HAS_CONTENT_RE = /[\p{L}\p{N}]/u;

/** Character ranges that are blank on *every* line — the candidate gutters. */
function gutters(lines: ColumnLine[]): [number, number][] {
  const ends = lines.map((line) => {
    let end = line.length;
    while (end > 0 && isBlank(line[end - 1])) end--;
    return end;
  });
  const width = Math.max(...ends);
  const blank = (i: number) =>
    lines.every((line, n) => i >= ends[n] || isBlank(line[i]));

  const runs: [number, number][] = [];
  let i = 0;
  while (i < width) {
    if (!blank(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < width && blank(j)) j++;
    if (j - i >= MIN_GUTTER) runs.push([i, j]);
    i = j;
  }
  return runs;
}

/** The lines one column of a block has a cell on, and what those cells say. */
function columnCells(
  lines: ColumnLine[],
  slice: (line: ColumnLine) => ColumnLine,
): { at: number[]; cells: string[] } {
  const at: number[] = [];
  const cells: string[] = [];
  lines.forEach((line, i) => {
    const cell = slice(line).join("").trim();
    if (cell) {
      at.push(i);
      cells.push(cell);
    }
  });
  return { at, cells };
}

/**
 * Whether the two columns are stacked rather than interleaved — every cell of
 * one above every cell of the other.
 *
 * Such a block already joins in reading order («Antecedentes» on its own line
 * above the paragraph it labels), so rewriting it would be changing text that
 * was never broken, and getting it wrong costs more than leaving it. It is
 * also what a page break looks like: the footer of one page and the header of
 * the next, sharing a block because pdftotext put no blank line between them.
 */
const stacked = (a: number[], b: number[]) =>
  a[a.length - 1] < b[0] || b[b.length - 1] < a[0];

/**
 * Whether splitting `lines` at `gutter` yields a rail: two non-empty columns,
 * at least one of which is a *sparse* column of *short* cells.
 *
 * Sparse — fewer cells than the block has lines — is what tells a rail from a
 * data grid, whose every column has a cell on every line. Short is what tells
 * a label from a second column of prose. Both sides being short and sparse is
 * fine (a two-cell row of a bracket table); neither being so is a grid, or
 * two columns of prose, and neither is this module's business.
 *
 * A block whose columns hold one cell each is left alone whatever its shape:
 * `Legal   Artículo 33 y transitorio XI…` already joins in reading order, and
 * a rule that rewrote it would be changing text that was never broken.
 */
function isRail(lines: ColumnLine[], [start, end]: [number, number]): boolean {
  const left = columnCells(lines, (l) => l.slice(0, start));
  const right = columnCells(lines, (l) => l.slice(end));
  if (left.cells.length === 0 || right.cells.length === 0) return false;
  if (Math.max(left.cells.length, right.cells.length) < 2) return false;
  if (stacked(left.at, right.at)) return false;

  const railish = ({ cells }: { cells: string[] }) =>
    cells.length < lines.length &&
    cells.every(
      (cell) =>
        columnsOf(cell).length <= MAX_LABEL_CHARS && HAS_CONTENT_RE.test(cell),
    );
  return railish(left) || railish(right);
}

const joined = (cells: string[]) => cells.join(" ").replace(/\s+/g, " ").trim();

/**
 * One blank-line-delimited block re-read as `left: right`, or null when it is
 * not a two-column block.
 *
 * The widest gutter wins: a rail cell is itself justified across its narrow
 * column («PROPUESTAS      DE»), so a block can offer more than one reading,
 * and the one that separates the columns is always wider than the one that
 * separates two words of the same cell. Two of equal width is a block this
 * heuristic cannot read, and it is left alone — the same call `findLayoutGrid`
 * makes about rival grids.
 */
export function readRailBlock(block: string[]): string | null {
  const lines = block.filter((l) => l.trim());
  if (lines.length < 2) return null;

  const columnLines = lines.map(columnsOf);

  const ranked = gutters(columnLines)
    .filter((g) => isRail(columnLines, g))
    .sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  if (ranked.length === 0) return null;
  const [best, rival] = ranked;
  if (rival && rival[1] - rival[0] === best[1] - best[0]) return null;

  const label = joined(
    columnCells(columnLines, (line) => line.slice(0, best[0])).cells,
  );
  const body = joined(
    columnCells(columnLines, (line) => line.slice(best[1])).cells,
  );
  return `${label}${label.endsWith(":") ? "" : ":"} ${body}`;
}

/**
 * `lines` with every two-column block collapsed to a single `left: right`
 * line, so `textToParagraphs` cannot re-join the columns into each other.
 *
 * Throws when the document has no two-column block at all. A manifest that
 * declares a rail the extractor cannot find is wrong about the document, and
 * the silent alternative — re-ingesting the spliced text the flag was set to
 * fix — is the failure mode this module exists to end (#179's rule).
 */
export function renderLabelRail(lines: string[]): string[] {
  const out: string[] = [];
  let block: string[] = [];
  let rails = 0;

  const flush = () => {
    if (block.length === 0) return;
    const rail = readRailBlock(block);
    if (rail) {
      out.push(rail);
      rails++;
    } else {
      out.push(...block);
    }
    block = [];
  };

  for (const line of lines) {
    if (line.trim()) {
      block.push(line);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();

  if (rails === 0) {
    throw new Error(
      "labelRail: no two-column block in this document — the source's layout changed, or this document never had a rail",
    );
  }
  return out;
}
