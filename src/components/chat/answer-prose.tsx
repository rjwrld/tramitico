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
 */
import * as React from "react";

/** A table row: pipe-delimited, opening and closing pipe required. */
const TABLE_LINE = /^\s*\|.*\|\s*$/;
/** `---`, `:--`, `--:` — the GFM alignment rule row, which we drop. */
const RULE_CELL = /^:?-+:?$/;
const HEADING_LINE = /^#{1,6} /;
const BULLET_LINE = /^- /;

type Kind = "table" | "bullet" | "heading" | "text";
type Run = { kind: Kind; lines: string[] };

/** `**bold**` → `<strong>`; everything else stays a text node. */
function inline(text: string, key: string): React.ReactNode[] {
  return text.split(/\*\*/).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${key}-${i}`} className="font-medium">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

/**
 * Classify each line of a block, then merge neighbours of the same kind. A
 * `| … |` line needs a neighbour to count as a table — one on its own is
 * prose. Grouping per line rather than per block means a heading or a lead-in
 * sentence that shares a block with the list or table below it still renders
 * correctly instead of dragging the whole block into one paragraph.
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

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function Table({ lines, keyPrefix }: { lines: string[]; keyPrefix: string }) {
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
                {inline(cell, `${keyPrefix}-h-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {body.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-b-0">
              {row.map((cell, c) => (
                <td key={c} className="py-2 pr-4 align-top last:pr-0">
                  {inline(cell, `${keyPrefix}-${r}-${c}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Segment({ run, keyPrefix }: { run: Run; keyPrefix: string }) {
  const { kind, lines } = run;

  if (kind === "table") return <Table lines={lines} keyPrefix={keyPrefix} />;

  if (kind === "bullet") {
    return (
      <ul className="my-4 list-disc pl-5 marker:text-border">
        {lines.map((line, i) => (
          <li key={i} className="py-0.5 pl-1">
            {inline(line.slice(2), `${keyPrefix}-${i}`)}
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
        {inline(lines[0].replace(HEADING_LINE, ""), keyPrefix)}
      </p>
    );
  }

  // Soft line breaks inside a paragraph flow, as they would in markdown.
  return (
    <p className="my-4 first:mt-0 last:mb-0">
      {inline(lines.join(" "), keyPrefix)}
    </p>
  );
}

export function AnswerProse({ text }: { text: string }) {
  const runs = text
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== "")
    .flatMap((block, i) =>
      runsOf(block.split("\n")).map((run, j) => [`${i}-${j}`, run] as const),
    );

  return (
    <div className="max-w-[68ch] text-base leading-[1.7] text-pretty">
      {runs.map(([key, run]) => (
        <Segment key={key} run={run} keyPrefix={key} />
      ))}
    </div>
  );
}
