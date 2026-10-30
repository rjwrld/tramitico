/**
 * The README's «The numbers» chart: one row per eval gate, the two latest
 * full lanes as a range, the lower one filled because it is the one the
 * README quotes, and the gate as a tick. Written as two SVGs, light and
 * dark, that the README swaps with `prefers-color-scheme`.
 *
 * The figures are typed here from the lanes' own reads, not computed, so a
 * new lane updates `LANES` and `ROWS` and re-runs this:
 *   - Wave G, 2026-10-10: `eval/runs/2026-10-10-497-wave-g/`
 *   - Confirming, 2026-10-12: `eval/runs/2026-10-12-497-confirm/`
 * The central-claim row is `pnpm requirement-coverage` on those lanes'
 * transcripts. `readme-numbers-chart.test.ts` fails when the committed SVGs
 * drift from what this writes.
 *
 * Colours are DESIGN.md's ink, muted ink and sello red, converted to hex
 * because GitHub renders an SVG as an image, with no CSS variables.
 *
 * Usage: pnpm exec tsx scripts/readme-numbers-chart.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LANES = ["2026-10-10 (Wave G)", "2026-10-12 (confirming)"];

interface Row {
  label: string;
  /** Cases the gate counts over. */
  of: number;
  /** The two lanes' counts, in `LANES` order. */
  lanes: [number, number];
  /** The lowest passing count, or null for a reported number. */
  pass: number | null;
  gate: string;
}

export const ROWS: Row[] = [
  {
    label: "Answers backed by their sources",
    of: 74,
    lanes: [71, 73],
    pass: 69,
    gate: "gate: fails at ≤ 68",
  },
  {
    label: "Out-of-scope questions declined",
    of: 15,
    lanes: [15, 15],
    pass: 0.9 * 15,
    gate: "gate: ≥ 90 %",
  },
  {
    label: "Right source retrieved",
    of: 74,
    lanes: [73, 73],
    pass: 0.94 * 74,
    gate: "gate: ≥ 94 %",
  },
  {
    label: "Answered what was asked",
    of: 27,
    lanes: [24, 25],
    pass: null,
    gate: "reported, not gated",
  },
  {
    label: "Required details stated",
    of: 116,
    lanes: [93, 88],
    pass: 88,
    gate: "gate: fails at ≤ 87",
  },
];

const THEMES = {
  light: {
    bg: "#ffffff",
    ink: "#1e1e26",
    muted: "#62626c",
    grid: "#ececef",
    sello: "#aa342e",
  },
  dark: {
    bg: "#0d1117",
    ink: "#dddde3",
    muted: "#919199",
    grid: "#2a2a31",
    sello: "#e06b62",
  },
} as const;

export type Mode = keyof typeof THEMES;

const SANS =
  "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const round = (n: number) => Math.round(n * 10) / 10;

export function renderChart(mode: Mode): string {
  const t = THEMES[mode];
  const width = 760;
  const left = 250;
  const right = 120;
  const top = 44;
  const rowHeight = 46;
  const plotWidth = width - left - right;
  const bottom = top + ROWS.length * rowHeight;
  const height = bottom + 30;
  const [lo, hi] = [50, 100];
  const x = (pct: number) => round(left + ((pct - lo) / (hi - lo)) * plotWidth);
  const out: string[] = [];
  const desc = ROWS.map(
    (r) =>
      `${r.label}: ${Math.min(...r.lanes)} and ${Math.max(...r.lanes)} of ${r.of}, ${r.gate}`,
  ).join("; ");

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">Tramitico eval gates: the two latest full runs (${LANES.join(" and ")})</title>`,
    `<desc id="desc">${desc}.</desc>`,
    `<rect width="${width}" height="${height}" fill="${t.bg}"/>`,
  );

  // Legend: the lower lane is filled, the other is a ring, the gate a tick.
  const ly = 18;
  out.push(
    `<circle cx="${left + 6}" cy="${ly}" r="5" fill="${t.sello}"/>`,
    `<text x="${left + 18}" y="${ly + 4}" font-family="${SANS}" font-size="12" fill="${t.ink}">lower run, the number quoted</text>`,
    `<circle cx="${left + 206}" cy="${ly}" r="4.2" fill="${t.bg}" stroke="${t.sello}" stroke-width="1.7"/>`,
    `<text x="${left + 218}" y="${ly + 4}" font-family="${SANS}" font-size="12" fill="${t.ink}">the other run</text>`,
    `<line x1="${left + 316}" y1="${ly - 8}" x2="${left + 316}" y2="${ly + 8}" stroke="${t.ink}" stroke-width="2"/>`,
    `<text x="${left + 324}" y="${ly + 4}" font-family="${SANS}" font-size="12" fill="${t.ink}">release gate</text>`,
  );

  for (let pct = lo; pct <= hi; pct += 10) {
    out.push(
      `<line x1="${x(pct)}" y1="${top - 6}" x2="${x(pct)}" y2="${bottom}" stroke="${t.grid}" stroke-width="1"/>`,
      `<text x="${x(pct)}" y="${bottom + 18}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${t.muted}">${pct} %</text>`,
    );
  }

  ROWS.forEach((r, i) => {
    const cy = top + i * rowHeight + rowHeight / 2;
    const low = Math.min(...r.lanes);
    const high = Math.max(...r.lanes);
    const xLow = x((100 * low) / r.of);
    const xHigh = x((100 * high) / r.of);
    out.push(
      `<text x="0" y="${cy - 2}" font-family="${SANS}" font-size="14" font-weight="500" fill="${t.ink}">${r.label}</text>`,
      `<text x="0" y="${cy + 14}" font-family="${MONO}" font-size="11" fill="${t.muted}">${r.gate}</text>`,
    );
    if (r.pass !== null) {
      const gx = x((100 * r.pass) / r.of);
      out.push(
        `<line x1="${gx}" y1="${cy - 11}" x2="${gx}" y2="${cy + 11}" stroke="${t.ink}" stroke-width="2" stroke-linecap="round"/>`,
      );
    }
    if (high > low) {
      out.push(
        `<line x1="${xLow}" y1="${cy}" x2="${xHigh}" y2="${cy}" stroke="${t.sello}" stroke-width="2" stroke-opacity="0.5"/>`,
        `<circle cx="${xHigh}" cy="${cy}" r="4.2" fill="${t.bg}" stroke="${t.sello}" stroke-width="1.7"/>`,
      );
    }
    out.push(
      `<circle cx="${xLow}" cy="${cy}" r="5.5" fill="${t.sello}" stroke="${t.bg}" stroke-width="2"/>`,
      `<text x="${width}" y="${cy + 4}" text-anchor="end" font-family="${MONO}" font-size="13" font-weight="500" fill="${t.ink}">${low === high ? low : `${low}–${high}`} / ${r.of}</text>`,
    );
  });

  out.push("</svg>");
  return `${out.join("\n")}\n`;
}

export const ASSETS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "assets",
);

export const chartPath = (mode: Mode) =>
  path.join(ASSETS_DIR, `eval-numbers-${mode}.svg`);

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const mode of Object.keys(THEMES) as Mode[]) {
    writeFileSync(chartPath(mode), renderChart(mode));
    console.log(`wrote ${path.relative(process.cwd(), chartPath(mode))}`);
  }
}
