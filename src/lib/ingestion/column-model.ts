/**
 * The shared column model for `pdftotext -layout` geometry (issue #246).
 *
 * A page column holds one Unicode code point, not one UTF-16 code unit.
 * Keeping that conversion and the meaning of a blank column here gives every
 * layout reader the same coordinates without pretending their higher-level
 * questions are alike: tables still find shared cell ranges, rails still find
 * shared gutters, and stacked fractions still find one line's ink runs.
 * Their gap thresholds deliberately remain with those page-shape modules.
 */

/** One `pdftotext -layout` line, indexed by page column. */
export type ColumnLine = readonly string[];

/** Split a line into page columns without splitting astral glyphs in two. */
export const columnsOf = (line: string): ColumnLine => [...line];

/** Whether a page column is whitespace or lies beyond the end of a line. */
export const isBlank = (column: string | undefined): boolean =>
  column === undefined || /\s/u.test(column);
