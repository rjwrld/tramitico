/**
 * Answer prose (ADR 0008, issue #77). The model is constrained by
 * `ANSWER_SYSTEM_PROMPT` to three constructs — `- ` bullets, `**bold**` and
 * simple pipe tables — and this renders exactly those, by hand.
 *
 * No markdown library, no HTML parsing, no URL/link/image handling: every leaf
 * is a React text node, so nothing the model echoes can become markup. The
 * readiness audit's no-injection-surface property holds by construction, not
 * by sanitizer configuration. Links stay the sellos' job (ADR 0004) — bare
 * URLs in prose render as inert text.
 *
 * Typography per DESIGN §3/§6: 68ch measure, 1.7 leading, hanging-indent
 * bullets with a marker muted to `--border`, table body in Geist Mono with
 * tabular numerals, bold as weight rather than asterisks.
 *
 * Bullets are merged into one list even across a blank line (issue #95):
 * the model routinely separates bullets with blank lines, and blocks are
 * split on blank lines before classification, so `mergeAdjacentBulletRuns`
 * re-joins adjacent all-bullet runs after the per-block pass.
 */
import * as React from "react";

import { selloAnchorId } from "@/components/sello";

/**
 * What an inline `[k]` marker resolves to (#133). `k` is the seal's position
 * in the answer's sello row — the numbering `renumberCitationMarkers` stamps
 * into the text — so `count` is how many seals there are and anything past it
 * has no target and is dropped. Plain data, not a callback: this crosses a
 * component boundary that may be rendered from a server component.
 */
export interface AnswerReferences {
  count: number;
  anchorPrefix: string;
}

/** A table row: pipe-delimited, opening and closing pipe required. */
const TABLE_LINE = /^\s*\|.*\|\s*$/;
/** `---`, `:--`, `--:` — the GFM alignment rule row, which we drop. */
const RULE_CELL = /^:?-+:?$/;
const HEADING_LINE = /^#{1,6} /;
/** `[k]` seal references, kept as a capturing split so the digits survive. */
const REFERENCE = /\[(\d+)\]/;
const BULLET_LINE = /^- /;

type Kind = "table" | "bullet" | "heading" | "text";
type Run = { kind: Kind; lines: string[] };

/**
 * `**bold**` → `<strong>`; everything else stays a text node.
 *
 * Only *closed* pairs bold. An odd number of `**` — a run still in flight
 * mid-stream, or a stray pair in prose — would otherwise carry weight to the
 * end of the segment, which #77's test list rules out ("an odd number of `**`
 * in a block does not swallow the rest of the paragraph"). The delimiter is
 * dropped either way, so a half-open run reads as plain prose and turns bold
 * the moment it closes.
 */
function inline(
  text: string,
  key: string,
  references?: AnswerReferences,
): React.ReactNode[] {
  const parts = text.split(/\*\*/);
  // Even part count ⇒ odd delimiter count ⇒ the last part is never closed.
  const closed = parts.length % 2 === 0 ? parts.length - 1 : parts.length;
  return parts.map((part, i) =>
    i % 2 === 1 && i < closed ? (
      <strong key={`${key}-${i}`} className="font-medium">
        {leaf(part, `${key}-${i}`, references)}
      </strong>
    ) : (
      <React.Fragment key={`${key}-${i}`}>
        {leaf(part, `${key}-${i}`, references)}
      </React.Fragment>
    ),
  );
}

/**
 * A leaf segment split on its `[k]` references. Every other piece is the
 * captured digits, which become a superscript link to the matching sello;
 * everything else stays a text node, so the no-injection-surface property
 * above still holds by construction — the only `href` this file can produce
 * is a same-page fragment built from `selloAnchorId`, never marker text.
 *
 * A `k` with no sello behind it renders as nothing rather than as a literal
 * `[7]`: the answer either has a source the reader can open or it says
 * nothing. That also covers the moment mid-stream before the seal snapshot
 * lands, and prose rendered with no references at all.
 */
function leaf(
  text: string,
  key: string,
  references?: AnswerReferences,
): React.ReactNode[] {
  return text.split(REFERENCE).map((piece, i) => {
    if (i % 2 === 0) return piece;
    const ordinal = Number(piece);
    if (!references || ordinal < 1 || ordinal > references.count) return null;
    return (
      <sup key={`${key}-r-${i}`} className="ml-px font-mono tabular-nums">
        <a
          href={`#${selloAnchorId(references.anchorPrefix, ordinal)}`}
          aria-label={`fuente ${ordinal}`}
          className="rounded-[2px] px-px text-sello no-underline transition-colors duration-150 hover:bg-sello-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {ordinal}
        </a>
      </sup>
    );
  });
}

/**
 * Classify each line of a block, then merge neighbours of the same kind. A
 * `| … |` line needs a neighbour to count as a table — one on its own is
 * prose. Grouping per line rather than per block means a heading or a lead-in
 * sentence that shares a block with the list or table below it still renders
 * correctly instead of dragging the whole block into one paragraph.
 *
 * This only merges within one block's lines. Bullet runs that end a block
 * still need to merge with a bullet run starting the next block — that is
 * `mergeAdjacentBulletRuns`'s job, applied after every block has been run
 * through here.
 */
function runsOf(lines: string[]): Run[] {
  const isRow = lines.map((line) => TABLE_LINE.test(line));
  const kinds = lines.map((line, i): Kind => {
    if (isRow[i] && (isRow[i - 1] || isRow[i + 1])) return "table";
    if (BULLET_LINE.test(line)) return "bullet";
    if (HEADING_LINE.test(line)) return "heading";
    return "text";
  });

  return lines.reduce<Run[]>((runs, line, i) => {
    const last = runs[runs.length - 1];
    // Headings are one line each: consecutive ones must not merge.
    if (last && last.kind === kinds[i] && kinds[i] !== "heading") {
      last.lines.push(line);
    } else {
      runs.push({ kind: kinds[i], lines: [line] });
    }
    return runs;
  }, []);
}

/**
 * The model routinely puts a blank line between bullets (issue #95): each
 * bullet becomes its own block, so `runsOf` — which only sees one block at a
 * time — hands back N single-item bullet runs instead of one N-item run.
 * That reads as N separate `<ul>`s (an extra `my-4` gap between items that
 * should sit in one list's rhythm) and a screen reader announcing "list, 1
 * item" N times instead of "list, N items" once.
 *
 * Fix: after every block has been classified into runs, collapse consecutive
 * bullet runs in the flattened sequence into one, regardless of which block
 * each came from or whether a blank line separated them. Only a non-bullet
 * run — text, heading or table — breaks a run of bullets; that keeps bullets
 * either side of an intervening paragraph in separate lists, and heals
 * persisted history answers exactly as it heals a fresh stream.
 */
function mergeAdjacentBulletRuns(runs: Run[]): Run[] {
  return runs.reduce<Run[]>((merged, run) => {
    const last = merged[merged.length - 1];
    if (last && last.kind === "bullet" && run.kind === "bullet") {
      last.lines.push(...run.lines);
    } else {
      merged.push({ kind: run.kind, lines: [...run.lines] });
    }
    return merged;
  }, []);
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function Table({
  lines,
  keyPrefix,
  references,
}: {
  lines: string[];
  keyPrefix: string;
  references?: AnswerReferences;
}) {
  const rows = lines
    .map(cells)
    .filter((row) => !row.every((cell) => RULE_CELL.test(cell)));
  if (rows.length === 0) return null;
  const [head, ...body] = rows;

  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((cell, i) => (
              <th
                key={i}
                scope="col"
                className="py-2 pr-4 text-left font-normal text-muted-foreground last:pr-0"
              >
                {inline(cell, `${keyPrefix}-h-${i}`, references)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {body.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-b-0">
              {row.map((cell, c) => (
                <td key={c} className="py-2 pr-4 align-top last:pr-0">
                  {inline(cell, `${keyPrefix}-${r}-${c}`, references)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Segment({
  run,
  keyPrefix,
  references,
}: {
  run: Run;
  keyPrefix: string;
  references?: AnswerReferences;
}) {
  const { kind, lines } = run;

  if (kind === "table")
    return (
      <Table lines={lines} keyPrefix={keyPrefix} references={references} />
    );

  if (kind === "bullet") {
    return (
      <ul className="my-4 list-disc pl-5 marker:text-border">
        {lines.map((line, i) => (
          <li key={i} className="py-0.5 pl-1">
            {inline(line.slice(2), `${keyPrefix}-${i}`, references)}
          </li>
        ))}
      </ul>
    );
  }

  // A heading is a prompt violation; degrade it to a quiet lead-in rather
  // than show a user literal hashes (ADR 0008).
  if (kind === "heading") {
    return (
      <p className="mt-6 mb-2 font-medium first:mt-0">
        {inline(lines[0].replace(HEADING_LINE, ""), keyPrefix, references)}
      </p>
    );
  }

  // Soft line breaks inside a paragraph flow, as they would in markdown.
  return (
    <p className="my-4 first:mt-0 last:mb-0">
      {inline(lines.join(" "), keyPrefix, references)}
    </p>
  );
}

export function AnswerProse({
  text,
  references,
}: {
  text: string;
  /** Omit and `[k]` markers render as nothing — see `leaf`. */
  references?: AnswerReferences;
}) {
  const blockRuns = text
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== "")
    .flatMap((block) => runsOf(block.split("\n")));
  const runs = mergeAdjacentBulletRuns(blockRuns);

  return (
    <div className="max-w-[68ch] text-base leading-[1.7] text-pretty">
      {runs.map((run, i) => (
        <Segment
          key={i}
          run={run}
          keyPrefix={String(i)}
          references={references}
        />
      ))}
    </div>
  );
}
