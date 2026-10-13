/**
 * Carrier recall over N `pnpm answer-set-probe` draws (#611 §3): how often
 * each pre-registered carrier reaches the answer set, and how much the set
 * moves from draw to draw. The measurement behind the retrieval wave's bars;
 * the bars themselves are in `eval/runs/2026-10-12-611/preregistration.md`.
 *
 * Free: it reads JSON files and calls nothing. Usage:
 *
 *   pnpm carrier-recall <carriers.json> <probe.json> [<probe.json> …]
 *
 * `carriers.json` is a frozen carrier list (`eval/runs/2026-10-12-611/`).
 * Each row is a requirement, or a lone carrier with no requirement text; it
 * is carried in a draw when every one of its parts has a carrier in the
 * route's answer set (`top8/capoff/pinon`). A carrier is `docKey · articulo`,
 * or `docKey` alone for any chunk of the document (`parseChunkRef`).
 *
 * It prints, per draw: hit-rate on the gated cases and on the robustness
 * block, all expected targets reached, `isWeak` and the median set size. Per
 * row: the share of draws that carry it, and the mean over every (row, draw)
 * pair (R1). Per case: the median pairwise Jaccard of its answer sets across
 * draws, and for classified Tier 1 cases whether the step-pinned subset was
 * the same on every draw (R2). Then every case whose `isWeak` differs across
 * draws (R3).
 *
 * A case that lost a rerank reading in a draw is excluded from that draw,
 * from every count, and listed: the set it cut is not one production cuts on
 * a full reading (#466).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PRODUCTION_CONFIG } from "../src/lib/eval/answer-set-variance";
import { parseChunkRef } from "../src/lib/eval/carriers";
import {
  chunkMatchesTarget,
  isRobustness,
  type ExpectedTarget,
  type Variant,
} from "../src/lib/eval/dataset";

/** One row of the frozen list, its carriers parsed. */
export interface CarrierRow {
  case: string;
  /** The requirement's text; null for a lone carrier (`tier1-carriers.json`). */
  requirement: string | null;
  sources: string[];
  parts: { what: string; carriers: ExpectedTarget[] }[];
}

export function parseCarrierList(text: string): CarrierRow[] {
  const raw = JSON.parse(text) as { requirements?: unknown };
  if (!Array.isArray(raw.requirements)) {
    throw new Error("the carrier list must carry a `requirements` array");
  }
  return raw.requirements.map((row: unknown, i) => {
    const r = row as {
      case?: unknown;
      requirement?: unknown;
      sources?: unknown;
      parts?: unknown;
    };
    const parts = Array.isArray(r.parts) ? r.parts : [];
    const valid =
      typeof r.case === "string" &&
      (r.requirement === null || typeof r.requirement === "string") &&
      parts.length > 0 &&
      parts.every(
        (part: { carriers?: unknown }) =>
          Array.isArray(part.carriers) &&
          part.carriers.length > 0 &&
          part.carriers.every((c) => typeof c === "string" && c.length > 0),
      );
    if (!valid) throw new Error(`carrier list row ${i + 1} is malformed`);
    return {
      case: r.case as string,
      requirement: r.requirement as string | null,
      sources: Array.isArray(r.sources) ? (r.sources as string[]) : [],
      parts: parts.map((part: { what?: string; carriers: string[] }) => ({
        what: part.what ?? "",
        carriers: part.carriers.map(parseChunkRef),
      })),
    };
  });
}

/** One case as the probe writes it, only the fields read here. */
export interface ProbeRead {
  id: string;
  kind: "retrieval" | "abstention";
  tier: unknown;
  variant?: Variant | null;
  weak: boolean;
  expectedCount: number;
  /** The step catalogue family the probe searched, null for none. */
  steps: string | null;
  failures?: { rerank: number };
  rerankReadings?: { dropped: unknown[] } | null;
  per: Record<
    string,
    {
      present: number;
      size: number;
      set: string[];
      chunkIds?: string[];
      pins?: Record<string, string>;
    }
  >;
}

export interface Draw {
  name: string;
  reads: ProbeRead[];
}

/** A set label, `docKey·articulo·#part`, as `chunkMatchesTarget` reads it. */
export function parseSetLabel(label: string): {
  docKey: string;
  articulo: string | null;
  path: string[];
} {
  const docEnd = label.indexOf("·");
  const partAt = label.lastIndexOf("·#");
  const articulo = label.slice(docEnd + 1, partAt);
  return {
    docKey: label.slice(0, docEnd),
    articulo: articulo === "*" ? null : articulo,
    path: [],
  };
}

export function carriedBy(row: CarrierRow, set: readonly string[]): boolean {
  const chunks = set.map(parseSetLabel);
  return row.parts.every((part) =>
    part.carriers.some((target) =>
      chunks.some((chunk) => chunkMatchesTarget(chunk, target)),
    ),
  );
}

/** A read whose rerank lost a reading: excluded from its draw. */
export function lostReading(read: ProbeRead): boolean {
  return (
    (read.rerankReadings?.dropped.length ?? 0) > 0 ||
    (read.failures?.rerank ?? 0) > 0
  );
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const shared = [...left].filter((x) => right.has(x)).length;
  const union = left.size + right.size - shared;
  return union === 0 ? 1 : shared / union;
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const isTierOne = (read: ProbeRead) => read.tier === 1 && !isRobustness(read);

export interface DrawSummary {
  name: string;
  read: number;
  excluded: string[];
  /** Gated retrieval cases (outside the robustness block): hits, of `gated`. */
  hits: number;
  gated: number;
  /** Gated cases whose set holds every expected target. */
  allTargets: number;
  robustnessHits: number;
  robustness: number;
  weak: string[];
  /** Median answer-set size over the cases with a set (not weak). */
  medianSize: number | null;
}

export interface RowRecall {
  row: CarrierRow;
  carried: number;
  draws: number;
}

export interface CaseStability {
  id: string;
  tierOne: boolean;
  draws: number;
  /** Median pairwise Jaccard of the answer sets; null under two draws. */
  jaccard: number | null;
  /**
   * Classified cases only: the step-pinned subset is one set on every draw.
   * Null for an unclassified case, or one whose draws record no pins.
   */
  sameStepPins: boolean | null;
}

export interface RecallReport {
  config: string;
  draws: DrawSummary[];
  rows: RowRecall[];
  cases: CaseStability[];
  /** Cases whose `isWeak` is not the same on every draw that read them. */
  weakFlips: string[];
}

export function carrierRecall(
  draws: readonly Draw[],
  list: readonly CarrierRow[],
  config = PRODUCTION_CONFIG,
): RecallReport {
  const kept = draws.map((draw) => ({
    name: draw.name,
    reads: new Map(
      draw.reads.filter((r) => !lostReading(r)).map((r) => [r.id, r]),
    ),
    all: draw.reads,
  }));
  const entry = (read: ProbeRead) => {
    const found = read.per[config];
    if (found === undefined) {
      throw new Error(`${read.id}: no answer set for config ${config}`);
    }
    return found;
  };

  const summaries = kept.map(({ name, reads, all }): DrawSummary => {
    const included = [...reads.values()];
    const retrieval = included.filter((r) => r.kind === "retrieval");
    const gated = retrieval.filter((r) => !isRobustness(r));
    const block = retrieval.filter(isRobustness);
    return {
      name,
      read: all.length,
      excluded: all.filter(lostReading).map((r) => r.id),
      hits: gated.filter((r) => entry(r).present > 0).length,
      gated: gated.length,
      allTargets: gated.filter((r) => entry(r).present === r.expectedCount)
        .length,
      robustnessHits: block.filter((r) => entry(r).present > 0).length,
      robustness: block.length,
      weak: included.filter((r) => r.weak).map((r) => r.id),
      medianSize: median(
        included.filter((r) => !r.weak).map((r) => entry(r).size),
      ),
    };
  });

  const rows = list.map((row): RowRecall => {
    const sets = kept.flatMap(({ reads }) => {
      const read = reads.get(row.case);
      return read === undefined ? [] : [entry(read).set];
    });
    return {
      row,
      carried: sets.filter((set) => carriedBy(row, set)).length,
      draws: sets.length,
    };
  });

  const ids = [...new Set(kept.flatMap(({ all }) => all.map((r) => r.id)))];
  const cases = ids.map((id): CaseStability => {
    const reads = kept.flatMap(({ reads }) => reads.get(id) ?? []);
    // Chunk ids when every draw has them (#593): a label can repeat (#530).
    const members = (read: ProbeRead) =>
      reads.every((r) => entry(r).chunkIds !== undefined)
        ? (entry(read).chunkIds ?? [])
        : entry(read).set;
    const pairs: number[] = [];
    for (let i = 0; i < reads.length; i++) {
      for (let j = i + 1; j < reads.length; j++) {
        pairs.push(jaccard(members(reads[i]), members(reads[j])));
      }
    }
    const stepPins = (read: ProbeRead) =>
      Object.entries(entry(read).pins ?? {})
        .filter(([, pin]) => pin === "step")
        .map(([label]) => label)
        .sort()
        .join("\n");
    // A probe from before #579 records no pins: unknown, not identical.
    const classified =
      reads.some((r) => r.steps !== null) &&
      reads.every((r) => entry(r).pins !== undefined);
    return {
      id,
      tierOne: reads.length > 0 && isTierOne(reads[0]),
      draws: reads.length,
      jaccard: median(pairs),
      sameStepPins: classified
        ? reads.every((r) => stepPins(r) === stepPins(reads[0]))
        : null,
    };
  });

  const weakFlips = ids.filter((id) => {
    const flags = new Set(
      kept.flatMap(({ reads }) => reads.get(id)?.weak ?? []),
    );
    return flags.size > 1;
  });

  return { config, draws: summaries, rows, cases, weakFlips };
}

const pct = (n: number, d: number) =>
  d === 0 ? "—" : `${((100 * n) / d).toFixed(1)} %`;

/** The mean share over (row, draw) pairs, as a fraction and a percentage. */
export function meanShare(rows: readonly RowRecall[]): string {
  const carried = rows.reduce((n, r) => n + r.carried, 0);
  const pairs = rows.reduce((n, r) => n + r.draws, 0);
  return `${carried}/${pairs} (${pct(carried, pairs)})`;
}

export function formatReport(report: RecallReport): string {
  const out: string[] = [`config ${report.config}`, ""];
  out.push(
    "draw".padEnd(28) +
      "hit-rate".padEnd(18) +
      "robustness".padEnd(12) +
      "all-targets".padEnd(13) +
      "weak".padEnd(6) +
      "size  excluded (lost rerank reading)",
  );
  for (const d of report.draws) {
    out.push(
      d.name.padEnd(28) +
        `${d.hits}/${d.gated} ${pct(d.hits, d.gated)}`.padEnd(18) +
        `${d.robustnessHits}/${d.robustness}`.padEnd(12) +
        `${d.allTargets}/${d.gated}`.padEnd(13) +
        String(d.weak.length).padEnd(6) +
        String(d.medianSize ?? "—").padEnd(6) +
        (d.excluded.join(", ") || "none"),
    );
  }

  const requirements = report.rows.filter((r) => r.row.requirement !== null);
  out.push(
    "",
    `R1 carrier recall, mean over (row, draw) pairs: ${meanShare(report.rows)}`,
    `   requirement rows only (${requirements.length}): ${meanShare(requirements)}` +
      ` · lone carriers (${report.rows.length - requirements.length}): ${meanShare(
        report.rows.filter((r) => r.row.requirement === null),
      )}`,
  );
  report.rows.forEach(({ row, carried, draws }, i) => {
    const what =
      row.requirement === null
        ? row.parts
            .flatMap((p) => p.carriers)
            .map((t) => `${t.docKey} · ${t.articulo ?? "*"}`)
            .join(" | ")
        : row.parts.map((p) => p.what).join(" + ");
    out.push(
      `  ${String(i + 1).padStart(2)} ${`${carried}/${draws}`.padEnd(5)} ${row.case} — ${what} [${row.sources.join(", ")}]`,
    );
  });

  const tierOne = report.cases.filter((c) => c.tierOne && c.draws > 0);
  const jaccards = (cs: readonly CaseStability[]) =>
    cs.flatMap((c) => (c.jaccard === null ? [] : [c.jaccard]));
  const fmt = (x: number | null) => (x === null ? "—" : x.toFixed(2));
  const classified = tierOne.filter((c) => c.sameStepPins !== null);
  out.push(
    "",
    `R2 median pairwise Jaccard: Tier 1 ${fmt(median(jaccards(tierOne)))} (${tierOne.length} cases) · all ${fmt(median(jaccards(report.cases)))} (${report.cases.length} cases)`,
    `   step-pinned subset identical on every draw: ${classified.filter((c) => c.sameStepPins).length}/${classified.length} classified Tier 1 cases (${pct(classified.filter((c) => c.sameStepPins).length, classified.length)})`,
  );
  for (const c of tierOne) {
    out.push(
      `  ${fmt(c.jaccard).padEnd(5)} ${c.sameStepPins === null ? "  " : c.sameStepPins ? "= " : "≠ "}${c.id} (${c.draws} draws)`,
    );
  }
  out.push(
    "",
    `R3 isWeak differs across draws: ${report.weakFlips.join(", ") || "none"}`,
  );
  return out.join("\n");
}

function main(): void {
  const [listPath, ...files] = process.argv.slice(2);
  if (!listPath || files.length === 0) {
    console.error(
      "usage: pnpm carrier-recall <carriers.json> <probe.json> [<probe.json> …]",
    );
    process.exit(2);
  }
  const list = parseCarrierList(readFileSync(listPath, "utf8"));
  const draws = files.map((file) => ({
    name: path.basename(file, ".json"),
    reads: (JSON.parse(readFileSync(file, "utf8")) as { reads: ProbeRead[] })
      .reads,
  }));
  console.log(formatReport(carrierRecall(draws, list)));
}

if (process.argv[1]?.endsWith("carrier-recall.ts")) main();
