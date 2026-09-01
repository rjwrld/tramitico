/**
 * Stacked fractions in `pdftotext -layout` output (issue #203).
 *
 * A fraction bar is *drawn*, not typed, so `pdftotext` emits nothing for it.
 * The glyphs either side of it survive and their alignment survives — the
 * numerator's characters sit above the denominator's — but `textToParagraphs`
 * joins a block's lines with spaces, and the division disappears. The two
 * documents #176 ingested for no other reason than to carry a formula are the
 * cases that forced this:
 *
 *   - `reglamento-iva-bienes-capital` reads «𝐶𝑎0 ‒ 𝐶𝑎𝑖 4», where the PDF says
 *     (𝐶𝑎0 − 𝐶𝑎𝑖)/4. Flat, that is indistinguishable from 𝐶𝑎0 − 𝐶𝑎𝑖 − 4.
 *   - `reglamento-iva-retencion-tarjetas` reads «𝑇𝑀 1 𝑃𝑜𝑟𝑐𝑒𝑛𝑡𝑎𝑗𝑒 𝑑𝑒 𝑟𝑒𝑡𝑒𝑛𝑐𝑖ó𝑛
 *     = 𝐹𝑅 ∗ ∗ 13% 1 + 𝑇𝑀»: two fractions side by side inside one expression,
 *     both numerators hoisted to the front of the line, both denominators
 *     pushed to the back, and the two `∗` left adjacent with nothing between.
 *
 * Neither `layoutTable` (#179) nor `labelRail` (#199) covers the shape — the
 * first needs ≥ 3 columns filled on every line, the second a sparse rail
 * beside continuous prose — and both would read a fraction wrongly if they
 * did. This module reads it as what it is: a numerator centred over a
 * denominator, spliced back into the expression at its own column.
 *
 * ## What tells a stack from prose
 *
 * Geometry alone does not: a survey of every PDF-sourced document in the
 * corpus (#203's deliverable, recorded in the two manifest notes) found that
 * "one line's ink nested inside and centred on another's" also matches wrapped
 * prose, a centred three-line title, and a bracket table's rail cells. What
 * separates the real cases is *how they were typeset*: a Word equation object
 * emits Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF), the italic
 * letterforms of «𝐶𝑎0» and «𝑇𝑀», and ordinary prose never carries one. Across
 * the whole corpus exactly five blocks carry such a glyph: the three formulas
 * named above, and two single-line «“𝐶𝑎0” significa…» definitions that the
 * line count excludes. So the gate is that glyph *and* the geometry, never geometry alone.
 *
 * ## A wrong reading is worse than a flat one
 *
 * «(𝑇𝑀)/(13% 1 + 𝑇𝑀)» is a plausible mis-pairing of the retención formula and
 * it is silently wrong law. So the split between "leave it alone" and "refuse"
 * is drawn deliberately: a block that does not read as a stack at all is
 * passed through untouched (flat is the status quo, not a new error), while a
 * block that *is* a stack whose parts cannot be paired one-to-one throws, the
 * way `renderLayoutTable` throws rather than guess.
 *
 * Opt-in per document (`stackedFraction` in the manifest), for #179's reason:
 * a document without the flag extracts byte-for-byte as it did before.
 */

/** A run of ink on one line, and the column range it occupies: `[start, end)`. */
interface Cell {
  start: number;
  end: number;
  text: string;
}

/** Runs of whitespace this wide or wider separate cells, narrower ones don't. */
const MIN_GAP = 2;

/**
 * How far a numerator's centre may sit from its denominator's.
 *
 * A drawn bar centres the two on each other, but the columns `pdftotext`
 * reports are a monospace approximation of a proportional font, and a
 * numerator and denominator of different parity cannot share a centre column
 * exactly — so the two agree to about a character rather than to the column.
 * The three real formulas differ by 0, 0.5 and 1.
 *
 * One column, not two. This is the tolerance that decides between rival
 * readings of a fused row: «13% | 1 + 𝑇𝑀» leaves each numerator half a column
 * off its denominator's centre, while the rival cut «13% 1 | + 𝑇𝑀» puts one of
 * them 1.5 off. Widen this and both readings become admissible, the block is
 * refused as ambiguous, and the formula #203 exists to recover stays flat.
 */
const CENTRE_SLACK = 1;

/** The letterforms a Word equation object emits, and prose never does. */
const EQUATION_GLYPH = /[\u{1D400}-\u{1D7FF}]/u;

const isBlank = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/**
 * A line as the page laid it out: one entry per *character*, not per UTF-16
 * code unit. Every glyph of «𝑇𝑀» is astral, so a column measured in code units
 * is off by one per equation glyph — and this whole module is column
 * arithmetic against a line of prose that has none.
 */
type Columns = string[];

const columnsOf = (line: string): Columns => [...line];

const textAt = (columns: Columns, start: number, end: number) =>
  flatten(columns.slice(start, end).join(""));

/** The ink runs of `columns`, runs closer than `MIN_GAP` counted as one cell. */
function cellsOf(columns: Columns): Cell[] {
  const cells: Cell[] = [];
  let i = 0;
  while (i < columns.length) {
    if (isBlank(columns[i])) {
      i++;
      continue;
    }
    let j = i;
    let blanks = 0;
    while (j < columns.length && blanks < MIN_GAP) {
      blanks = isBlank(columns[j]) ? blanks + 1 : 0;
      j++;
    }
    const end = j - blanks;
    cells.push({ start: i, end, text: textAt(columns, i, end) });
    i = j;
  }
  return cells;
}

const flatten = (s: string) => s.replace(/\s+/g, " ").trim();

const span = (cells: Cell[]): [number, number] => [
  cells[0].start,
  cells[cells.length - 1].end,
];

const centre = ([start, end]: [number, number]) => (start + end) / 2;

const width = ([start, end]: [number, number]) => end - start;

/** Whether `inner` sits inside `outer`, sharing at most one of its edges. */
const nests = (inner: [number, number], outer: [number, number]) =>
  outer[0] <= inner[0] && inner[1] <= outer[1] && width(inner) < width(outer);

/**
 * Whether two ranges read as a numerator over a denominator: one strictly
 * narrower than the other and inside it, and the two centred on each other.
 *
 * The width difference is what keeps two *separate* one-line equations, left
 * aligned one above the other, from reading as a single fraction: those share
 * both edges, and no bar was ever drawn between them.
 */
const isStacked = (a: [number, number], b: [number, number]) =>
  (nests(a, b) || nests(b, a)) &&
  Math.abs(centre(a) - centre(b)) <= CENTRE_SLACK;

/** The blank column runs of `columns` that fall inside `[from, to)`. */
function blankRunsWithin(
  columns: Columns,
  from: number,
  to: number,
): [number, number][] {
  const runs: [number, number][] = [];
  let i = from;
  while (i < to) {
    if (!isBlank(columns[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < to && isBlank(columns[j])) j++;
    runs.push([i, j]);
    i = j;
  }
  return runs;
}

/**
 * How many rival ways to cut a fused row this module will even consider.
 *
 * The search below is a product over the gaps, and a formula whose reading
 * needs more candidates than this is one nobody should be reading off a
 * heuristic. Bounded so a pathological block fails loudly instead of hanging.
 */
const MAX_SPLIT_CANDIDATES = 32;

/**
 * Every way `fused` can be cut into as many cells as `guide` has, cutting only
 * at blank columns that fall inside `guide`'s own gaps.
 *
 * The retención formula is why this exists. Its numerators are «𝑇𝑀» and «1»,
 * five spaces apart; its denominators are «13%» and «1 + 𝑇𝑀», separated by a
 * *single* space, so `cellsOf` reads them as one cell — the same fusion
 * `layoutTable`'s header hits with «Estado Art. 78». The numerator line says
 * roughly where the boundary is, but not exactly: «1 + 𝑇𝑀» has spaces of its
 * own inside the gap, so cutting at «13% | 1 + 𝑇𝑀» and at «13% 1 | + 𝑇𝑀» are
 * both structurally possible. Which is why this returns *candidates* rather
 * than an answer: the caller keeps only the ones where every numerator ends up
 * centred over its denominator, and refuses the block unless exactly one
 * survives. Geometry decides; the count never does.
 */
function splitCandidates(
  fused: Cell[],
  guide: Cell[],
  columns: Columns,
): Cell[][] {
  let cutSets: [number, number][][] = [[]];
  for (let i = 1; i < guide.length; i++) {
    const runs = blankRunsWithin(columns, guide[i - 1].end, guide[i].start);
    if (runs.length === 0) return [];
    cutSets = cutSets.flatMap((cuts) => runs.map((run) => [...cuts, run]));
    if (cutSets.length > MAX_SPLIT_CANDIDATES) return [];
  }
  return cutSets
    .map((cuts) => applyCuts(fused, cuts, columns))
    .filter((cells) => cells.length === guide.length);
}

/** `cells` with every cell straddling a cut broken in two at it. */
function applyCuts(
  cells: Cell[],
  cuts: readonly [number, number][],
  columns: Columns,
): Cell[] {
  let out = cells;
  for (const [from, to] of cuts) {
    out = out.flatMap((cell) =>
      cell.start < from && to < cell.end
        ? [
            {
              start: cell.start,
              end: from,
              text: textAt(columns, cell.start, from),
            },
            { start: to, end: cell.end, text: textAt(columns, to, cell.end) },
          ]
        : [cell],
    );
  }
  return out;
}

/** One fraction: the cells above and below where the bar was drawn. */
interface Fraction {
  numerator: Cell;
  denominator: Cell;
}

function describeBlock(block: string[]): string {
  return block.map((l) => l.replace(/\s+$/, "")).join(" ⏎ ");
}

const pairUp = (numerators: Cell[], denominators: Cell[]): Fraction[] =>
  numerators.map((numerator, i) => ({
    numerator,
    denominator: denominators[i],
  }));

/** Whether a numerator sits over its denominator the way a bar puts it there. */
const overlays = (numerator: Cell, denominator: Cell) =>
  isStacked(
    [numerator.start, numerator.end],
    [denominator.start, denominator.end],
  );

/**
 * One blank-line-delimited block re-read with its fraction bars restored, or
 * null when the block is not a stacked formula.
 *
 * A two-line block is a bare fraction; a three-line block is an expression
 * whose middle line carries the baseline — «𝑃𝑜𝑟𝑐𝑒𝑛𝑡𝑎𝑗𝑒 𝑑𝑒 𝑟𝑒𝑡𝑒𝑛𝑐𝑖ó𝑛 = 𝐹𝑅 ∗»
 * — with numerators above it and denominators below. Those are the two shapes
 * the corpus has; a stack laid out any other way is left flat rather than
 * read on a guess, and `renderStackedFraction` then fails for having found
 * none.
 *
 * Throws once the block *is* a stack but its parts cannot be paired: a fused
 * row the page offers no way — or more than one way — to cut, a pair that is
 * not centred and nested, or a baseline whose own ink sits where a fraction
 * does. Each of those is a formula this module would have to invent a reading
 * for.
 */
export function readStackedBlock(block: string[]): string | null {
  const lines = block.filter((l) => l.trim());
  if (lines.length < 2 || lines.length > 3) return null;
  if (!lines.some((l) => EQUATION_GLYPH.test(l))) return null;

  const columns = lines.map(columnsOf);
  const top = cellsOf(columns[0]);
  const bottom = cellsOf(columns[columns.length - 1]);
  if (top.length === 0 || bottom.length === 0) return null;
  if (!isStacked(span(top), span(bottom))) return null;

  const baseline = columns.length === 3 ? cellsOf(columns[1]) : [];

  let fractions: Fraction[];
  if (top.length === bottom.length) {
    fractions = pairUp(top, bottom);
    const adrift = fractions.find(
      ({ numerator, denominator }) => !overlays(numerator, denominator),
    );
    if (adrift) {
      throw new Error(
        `stackedFraction: "${adrift.numerator.text}" does not sit over "${adrift.denominator.text}" — the parts pair up in count but not on the page: ${describeBlock(block)}`,
      );
    }
  } else {
    const topIsFused = top.length < bottom.length;
    const [fused, guide, cutColumns] = topIsFused
      ? ([top, bottom, columns[0]] as const)
      : ([bottom, top, columns[columns.length - 1]] as const);
    const readings = splitCandidates(fused, guide, cutColumns)
      .map((split) =>
        topIsFused ? pairUp(split, guide) : pairUp(guide, split),
      )
      .filter((reading) =>
        reading.every(({ numerator, denominator }) =>
          overlays(numerator, denominator),
        ),
      );
    if (readings.length === 0) {
      throw new Error(
        `stackedFraction: ${top.length} numerator(s) over ${bottom.length} denominator(s) and no way to pair them that the page supports — reading this formula would be guessing at it: ${describeBlock(block)}`,
      );
    }
    if (readings.length > 1) {
      throw new Error(
        `stackedFraction: ${readings.length} rival readings of this formula are equally supported by the page, and picking one would be a guess: ${describeBlock(block)}`,
      );
    }
    fractions = readings[0];
  }

  const bars = fractions.map(({ numerator, denominator }) => ({
    start: Math.min(numerator.start, denominator.start),
    end: Math.max(numerator.end, denominator.end),
    text: `(${numerator.text})/(${denominator.text})`,
  }));
  for (const cell of baseline) {
    const clash = bars.find((b) => cell.start < b.end && b.start < cell.end);
    if (clash) {
      throw new Error(
        `stackedFraction: the expression's "${cell.text}" occupies the same columns as ${clash.text} — the fraction cannot be spliced back where it was drawn: ${describeBlock(block)}`,
      );
    }
  }

  return [...baseline, ...bars]
    .sort((a, b) => a.start - b.start)
    .map((c) => c.text)
    .join(" ");
}

/**
 * `lines` with every stacked formula collapsed to one line carrying its
 * fraction bars, so `textToParagraphs` cannot flatten the division away.
 *
 * Throws when the document has no stacked formula at all. A manifest that
 * declares one the extractor cannot find is wrong about the document, and the
 * silent alternative — re-ingesting the flattened formula the flag was set to
 * fix — is the failure mode this module exists to end (#179's rule).
 */
export function renderStackedFraction(lines: string[]): string[] {
  const out: string[] = [];
  let block: string[] = [];
  let found = 0;

  const flush = () => {
    if (block.length === 0) return;
    const stack = readStackedBlock(block);
    if (stack !== null) {
      out.push(stack);
      found++;
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

  if (found === 0) {
    throw new Error(
      "stackedFraction: no stacked formula in this document — the source's layout changed, or this document never carried one",
    );
  }
  return out;
}
