/**
 * #628 step 0, free: what fix 3 (several expansions per ask, their pools
 * merged) could buy, estimated from #611's control. Calls nothing.
 *
 * #611's five control draws (`../2026-10-12-611/control/probe-{1..5}.json`)
 * each ran a different live expansion, and recorded per case the fused pool
 * of 40 (`pool`/`poolIds`), the whole reranked order (`order`/`orderIds`) and
 * Voyage's score at each place (`scores`). Merging k of those draws per case
 * stands in for one ask that ran k expansions. For k = 1, 2, 3 and 5, over
 * every k-subset of the five draws, it counts the `carriers.json` rows a
 * merged pool carries (every part with a carrier in it, `carriedBy`):
 *
 * - **union**: every chunk any of the k pools held. The ceiling: fix 3's
 *   pool still holds 40 rows.
 * - **pool40**: the 40 best by an RRF over the k draws' fused ranks, a proxy
 *   for one fusion with the k expansions' legs in it. The probe records no
 *   per-leg rank, so the real v7 fusion can't be replayed.
 * - **top8**: the merged pool cut to the 8 best by rerank score. A draw's
 *   score is the max over the question's, that draw's expansion's and the
 *   step sentences' readings (`fuseByMaxScore`). Fix 3 reads every
 *   expansion, so a merged chunk's score is the max of its scores over the
 *   draws that pooled it: exact where every draw pooled it, a lower bound
 *   where only some did. Ties (Voyage's scores are quantized) break on the
 *   best place any draw's order gave the chunk, standing in for the
 *   question reading's own order that `fuseByMaxScore` breaks them on. The step, cross-reference, salario-base and
 *   derived-figure pins depend on the cut and the picks, and aren't
 *   simulated, so this compares cuts, not answer sets.
 *
 * Usage, from the repo root:
 *
 *   pnpm exec tsx eval/runs/2026-10-28-628/merge-estimate.ts \
 *     eval/runs/2026-10-12-611/carriers.json \
 *     eval/runs/2026-10-12-611/control/probe-{1,2,3,4,5}.json
 */
import { readFileSync } from "node:fs";
import {
  carriedBy,
  lostReading,
  parseCarrierList,
  type CarrierRow,
  type ProbeRead,
} from "../../../scripts/carrier-recall";
import { RRF_K } from "../../../src/lib/retrieval";

/** The probe fields this reads, beyond `ProbeRead`'s. */
interface Read extends ProbeRead {
  pool: string[];
  poolIds?: string[];
  order: string[] | null;
  orderIds?: string[] | null;
  scores: number[] | null;
  expansion: string | null;
}

const TOP_K = 8;
const POOL = 40;

export function subsets<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [
    ...subsets(rest, k - 1).map((s) => [head, ...s]),
    ...subsets(rest, k),
  ];
}

interface Merged {
  union: string[];
  pool40: string[];
  top8: string[];
}

/** One case's k reads, merged three ways. Labels out, ids inside. */
export function merge(reads: readonly Read[]): Merged {
  const labelOf = new Map<string, string>();
  const rrf = new Map<string, number>();
  const score = new Map<string, number>();
  const place = new Map<string, number>();
  for (const read of reads) {
    const ids = read.poolIds ?? read.pool;
    ids.forEach((id, i) => {
      labelOf.set(id, read.pool[i]);
      rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    });
    const order = read.orderIds ?? read.order ?? [];
    order.forEach((id, i) => {
      const s = read.scores?.[i];
      if (s !== undefined) score.set(id, Math.max(score.get(id) ?? -1, s));
      place.set(id, Math.min(place.get(id) ?? Infinity, i));
    });
  }
  const union = [...rrf.keys()];
  const pool40 = [...rrf]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, POOL)
    .map(([id]) => id);
  const top8 = [...pool40]
    .filter((id) => score.has(id))
    .sort(
      (a, b) =>
        (score.get(b) ?? 0) - (score.get(a) ?? 0) ||
        (place.get(a) ?? 0) - (place.get(b) ?? 0) ||
        (rrf.get(b) ?? 0) - (rrf.get(a) ?? 0),
    )
    .slice(0, TOP_K);
  const labels = (ids: string[]) => ids.map((id) => labelOf.get(id) ?? id);
  return {
    union: labels(union),
    pool40: labels(pool40),
    top8: labels(top8),
  };
}

type Measure = keyof Merged;
const MEASURES: Measure[] = ["union", "pool40", "top8"];

interface Tally {
  k: number;
  subsets: number;
  /** Mean rows carried per subset, by measure. */
  mean: Record<Measure, number>;
  /** Rows carried by at least one subset, by measure. */
  ever: Record<Measure, number>;
}

export function tally(
  rows: readonly CarrierRow[],
  draws: readonly Map<string, Read>[],
  k: number,
): { tally: Tally; perRow: Record<Measure, number>[] } {
  const combos = subsets(
    draws.map((_, i) => i),
    k,
  );
  const perRow = rows.map(() => ({ union: 0, pool40: 0, top8: 0 }));
  for (const combo of combos) {
    rows.forEach((row, r) => {
      const reads = combo.flatMap((i) => draws[i].get(row.case) ?? []);
      if (reads.length === 0) return;
      const merged = merge(reads);
      for (const m of MEASURES) {
        if (carriedBy(row, merged[m])) perRow[r][m] += 1;
      }
    });
  }
  const mean = {} as Record<Measure, number>;
  const ever = {} as Record<Measure, number>;
  for (const m of MEASURES) {
    mean[m] = perRow.reduce((n, x) => n + x[m], 0) / combos.length;
    ever[m] = perRow.filter((x) => x[m] > 0).length;
  }
  return { tally: { k, subsets: combos.length, mean, ever }, perRow };
}

/** The recorded answer set per draw, pins included, for k = 1 only. */
function recordedSet(
  rows: readonly CarrierRow[],
  draws: readonly Map<string, Read>[],
): number {
  let carried = 0;
  for (const draw of draws) {
    for (const row of rows) {
      const read = draw.get(row.case);
      const set = read?.per["top8/capoff/pinon"]?.set;
      if (set !== undefined && carriedBy(row, set)) carried += 1;
    }
  }
  return carried / draws.length;
}

/**
 * Check of the method: a single draw's simulated `top8` must equal the cut
 * the probe recorded under `top8/capoff/pinoff`, its pins taken out.
 */
function checkSingleDraw(draws: readonly Map<string, Read>[]): string {
  let same = 0;
  let total = 0;
  const off: string[] = [];
  draws.forEach((draw, d) => {
    for (const read of draw.values()) {
      if (read.weak || read.order === null) continue;
      const entry = read.per["top8/capoff/pinoff"];
      if (entry === undefined) continue;
      const pinned = new Set(Object.keys(entry.pins ?? {}));
      const cut = entry.set.filter((l) => !pinned.has(l));
      const sim = merge([read]).top8;
      total += 1;
      const equal =
        cut.length === sim.length && cut.every((l) => sim.includes(l));
      if (equal) same += 1;
      else off.push(`${read.id}@${d + 1}`);
    }
  });
  return `single-draw check: simulated top8 = recorded cut (as sets) on ${same}/${total} reads${off.length > 0 ? ` (differs: ${off.slice(0, 12).join(", ")}${off.length > 12 ? ", …" : ""})` : ""}`;
}

function main(): void {
  const [listPath, ...files] = process.argv.slice(2);
  if (!listPath || files.length < 2) {
    console.error(
      "usage: tsx merge-estimate.ts <carriers.json> <probe.json> <probe.json> [<probe.json> …]",
    );
    process.exit(2);
  }
  const rows = parseCarrierList(readFileSync(listPath, "utf8"));
  const excluded: string[] = [];
  const draws = files.map((file, d) => {
    const reads = (JSON.parse(readFileSync(file, "utf8")) as { reads: Read[] })
      .reads;
    return new Map(
      reads
        .filter((r) => {
          if (!lostReading(r)) return true;
          excluded.push(`${r.id}@${d + 1}`);
          return false;
        })
        .map((r) => [r.id, r]),
    );
  });

  const out: string[] = [];
  out.push(
    `${rows.length} carrier rows over ${new Set(rows.map((r) => r.case)).size} cases, ${draws.length} draws`,
    `excluded for a lost rerank reading: ${excluded.join(", ") || "none"}`,
    checkSingleDraw(draws),
    "",
    "Rows carried, mean over every k-subset of the draws (of " +
      `${rows.length}); "ever" = carried by at least one subset`,
    "",
    "k  subsets  union (ever)     pool40 (ever)    top8 (ever)",
  );
  const results = [1, 2, 3, 5]
    .filter((k) => k <= draws.length)
    .map((k) => tally(rows, draws, k));
  for (const { tally: t } of results) {
    const cell = (m: Measure) =>
      `${t.mean[m].toFixed(1)} (${t.ever[m]})`.padEnd(17);
    out.push(
      `${String(t.k).padEnd(3)}${String(t.subsets).padEnd(9)}${cell("union")}${cell("pool40")}${cell("top8")}`,
    );
  }
  out.push(
    "",
    `k=1 recorded answer set (top8/capoff/pinon, pins included): ${recordedSet(rows, draws).toFixed(1)} rows a draw`,
  );

  const single = results[0].tally.mean;
  const three = results.find((r) => r.tally.k === 3)?.tally.mean;
  if (three !== undefined) {
    out.push("", "Go/no-go (#628): merging 3 draws must bring into the pool");
    out.push("at least half of the rows a single draw's pool misses.");
    for (const m of ["union", "pool40"] as const) {
      const missed = rows.length - single[m];
      const gained = three[m] - single[m];
      out.push(
        `  ${m.padEnd(7)} single draw misses ${missed.toFixed(1)}; k=3 brings in ${gained.toFixed(1)} (${((100 * gained) / missed).toFixed(0)} %) → ${gained >= missed / 2 ? "GO" : "NO-GO"}`,
      );
    }
  }

  out.push("", "Per row, subsets carrying it (union · pool40 · top8):");
  const header = results.map((r) => `k=${r.tally.k}/${r.tally.subsets}`);
  out.push(`  row  ${header.map((h) => h.padEnd(14)).join("")}case`);
  rows.forEach((row, i) => {
    const cells = results.map(({ perRow }) =>
      `${perRow[i].union}·${perRow[i].pool40}·${perRow[i].top8}`.padEnd(14),
    );
    out.push(
      `  ${String(i + 1).padStart(3)}  ${cells.join("")}${row.case} [${row.sources.join(", ") || "lone"}]`,
    );
  });
  console.log(out.join("\n"));
}

if (process.argv[1]?.endsWith("merge-estimate.ts")) main();
