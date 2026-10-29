/**
 * #628 step 0b, free: what a larger rerank cut (`ANSWER_TOP_K`) would carry,
 * estimated on #611's control. Calls no provider. The one database read is a
 * read-only dump of `public.chunks` (README.md has the `psql` line), because
 * the pins read chunk text, and a probe JSON records only ids and labels.
 *
 * Each of the five control draws recorded, per case, the fused pool of 40
 * (`poolIds`), the whole reranked order (`orderIds`, `scores`) and the answer
 * set at cut 8 with what pinned each appended chunk (`top8/capoff/pinon`).
 * For a cut of N it rebuilds that case's chunks from the dump, and runs the
 * production code on them: `answerSetFromOrder` (the cut under `pin1` with
 * `STEP_PINS=2`), then `pinAnswerSet` (cross-reference, derived inputs,
 * salario base, named source). The lookups the two pins make read the dump
 * instead of the database, with the same filter (`part = 0`). A weak read
 * keeps the empty set it had: `isWeak` is decided on the pool, which a cut
 * doesn't change.
 *
 * **The one part it can't replay is the step picks.** The probe records the
 * picks that made the set at cut 8 (pinned `step`), not the family's whole
 * list, nor each pick's rank in the question's reading. So:
 *
 * - **lower**: the recorded picks are the only picks. At a cut of N, a pick
 *   the cut now takes leaves its pin slot empty. It is a lower bound on the
 *   set: the recorded picks are the best two fresh ones at cut 8, so every
 *   one is in the set at any N ≥ 8, through the cut or its pin.
 * - **upper**: a slot a recorded pick left is filled with the family's
 *   catalogue `reaches` that sit in the pool, best reranked first. A family
 *   had a third fresh pick only if both slots were full at cut 8, so this
 *   only happens then. `reaches` names the chunks the sentences were written
 *   for, so carriers are likelier among them than among the real picks. It
 *   is an estimate of the upper side, not a strict bound.
 *
 * At N = 8 both must reproduce the recorded set; the first line says on how
 * many reads they do.
 *
 *   pnpm exec tsx eval/runs/2026-10-28-628/cut-estimate.ts <chunks.json> \
 *     eval/runs/2026-10-12-611/carriers.json \
 *     eval/runs/2026-10-12-611/control/probe-{1,2,3,4,5}.json
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pinAnswerSet } from "../../../src/lib/answer/pins";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
} from "../../../src/lib/answer/prompt";
import {
  answerSetFromOrder,
  type RerankedChunk,
} from "../../../src/lib/answer/rerank";
import { parseChunkRef } from "../../../src/lib/eval/carriers";
import {
  chunkMatchesTarget,
  DATASET_PATH,
  isRobustness,
  parseDataset,
  type EvalCase,
} from "../../../src/lib/eval/dataset";
import type { RetrievedChunk } from "../../../src/lib/retrieval";
import catalogue from "../../step-catalogue.json";
import {
  carriedBy,
  lostReading,
  median,
  parseCarrierList,
  type ProbeRead,
} from "../../../scripts/carrier-recall";

const CUTS = [8, 10, 12, 16];
const CONFIG = "top8/capoff/pinon";
const KNOBS = [
  "ANSWER_TOP_K",
  "ANSWER_DOC_CAP",
  "STEPS_RERANK",
  "STEP_PINS",
  "PIN_DERIVED_INPUTS",
  "PIN_CROSS_REFERENCES",
  "PIN_SALARIO_BASE",
  "PIN_NAMED_SOURCES",
];

interface Read extends ProbeRead {
  query: string;
  poolIds: string[];
  orderIds: string[] | null;
  scores: number[] | null;
}

type Side = "lower" | "upper";

interface Built {
  set: RetrievedChunk[];
  /** The rerank cut alone, no pins. */
  cut: RetrievedChunk[];
}

const label = (c: RetrievedChunk) =>
  `${c.docKey}·${c.articulo ?? "*"}·#${c.part}`;

function familyReaches(family: string | null) {
  const families = catalogue.families as Record<string, { reaches: string[] }>;
  return family === null || families[family] === undefined
    ? []
    : families[family].reaches.map(parseChunkRef);
}

async function build(
  read: Read,
  byId: ReadonlyMap<string, RetrievedChunk>,
  cutSize: number,
  side: Side,
): Promise<Built> {
  if (read.weak) return { set: [], cut: [] };
  const chunk = (id: string) => {
    const found = byId.get(id);
    if (found === undefined)
      throw new Error(`${read.id}: chunk ${id} not in the dump`);
    return found;
  };
  const pool = read.poolIds.map(chunk);
  const order: RerankedChunk[] | null =
    read.orderIds === null
      ? null
      : read.orderIds.map((id, i) => ({
          chunk: chunk(id),
          score: read.scores?.[i] ?? 0,
          rank: i + 1,
        }));

  // The recorded picks, in the order pin1 appended them.
  const entry = read.per[CONFIG];
  const ids = entry.chunkIds ?? [];
  const recorded = entry.set
    .map((l, i) => ({ l, id: ids[i] }))
    .filter(({ l }) => entry.pins?.[l] === "step")
    .map(({ id }, i): RerankedChunk => ({
      chunk: chunk(id),
      score: 1,
      rank: i + 1,
    }));
  let picks = recorded;
  if (side === "upper" && recorded.length >= 2) {
    const held = new Set(recorded.map((p) => p.chunk.chunkId));
    const targets = familyReaches(read.steps);
    const extras = (order ?? [])
      .filter(
        (o) =>
          !held.has(o.chunk.chunkId) &&
          targets.some((t) => chunkMatchesTarget(o.chunk, t)),
      )
      .map((o, i) => ({ ...o, rank: 100 + i }));
    picks = [...recorded, ...extras];
  }

  process.env.ANSWER_TOP_K = String(cutSize);
  const cut = answerSetFromOrder(order, pool, picks);
  const set = await pinAnswerSet(cut, pool, read.query, {
    lookup: async (references) => {
      const keys = new Set(references.map((r) => r.docKey));
      return [...byId.values()].filter(
        (c) => c.part === 0 && keys.has(c.docKey),
      );
    },
    salarioBaseLookup: async (docKeys) =>
      [...byId.values()].filter(
        (c) => c.part === 0 && docKeys.includes(c.docKey),
      ),
  });
  return { set, cut: (order ?? []).slice(0, cutSize).map((o) => o.chunk) };
}

interface CutResult {
  cutSize: number;
  side: Side;
  /** Per row: draws carrying it, by the cut alone and by the set. */
  cutCarried: number[];
  setCarried: number[];
  pairs: number;
  /** Per draw: median set size, gated hits, robustness hits. */
  draws: {
    size: number | null;
    hits: number;
    gated: number;
    robust: number;
    block: number;
  }[];
  /** Chunks the set holds beyond the cut-8 replay, for the token estimate. */
  added: RetrievedChunk[];
  sets: { query: string; set: RetrievedChunk[] }[];
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)} %`;

async function main(): Promise<void> {
  const [dumpPath, listPath, ...files] = process.argv.slice(2);
  if (!dumpPath || !listPath || files.length === 0) {
    console.error(
      "usage: tsx cut-estimate.ts <chunks.json> <carriers.json> <probe.json>…",
    );
    process.exit(2);
  }
  for (const knob of KNOBS) delete process.env[knob];
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as RetrievedChunk[];
  const byId = new Map(
    dump.map((c) => [
      c.chunkId,
      { ...c, score: 0, vectorRank: null, lexicalRank: null } as RetrievedChunk,
    ]),
  );
  const rows = parseCarrierList(readFileSync(listPath, "utf8"));
  const cases = new Map<string, EvalCase>(
    parseDataset(readFileSync(DATASET_PATH, "utf8")).map((c) => [c.id, c]),
  );
  const draws = files.map((file) =>
    (JSON.parse(readFileSync(file, "utf8")) as { reads: Read[] }).reads.filter(
      (r) => !lostReading(r),
    ),
  );

  // The control's recorded sets: the floor rows (carried on ≥ 4/5 draws).
  const recordedCarried = rows.map(
    (row) =>
      draws.filter((reads) => {
        const read = reads.find((r) => r.id === row.case);
        return read !== undefined && carriedBy(row, read.per[CONFIG].set);
      }).length,
  );
  const floor = rows.flatMap((_, i) => (recordedCarried[i] >= 4 ? [i] : []));

  // Check: at N = 8 the replay is the recorded set, both sides.
  let same = 0;
  let total = 0;
  const off: string[] = [];
  for (const [d, reads] of draws.entries()) {
    for (const read of reads) {
      for (const side of ["lower", "upper"] as const) {
        const { set } = await build(read, byId, 8, side);
        const want = read.per[CONFIG].chunkIds ?? [];
        const got = set.map((c) => c.chunkId);
        total += 1;
        if (want.length === got.length && want.every((id, i) => id === got[i]))
          same += 1;
        else off.push(`${read.id}@${d + 1}/${side}`);
      }
    }
  }

  // Check: the probe also cut at 10 with every pin, real step picks included
  // (`top10/capoff/pinon`). The two sides must bracket that set, and its
  // carriers say where the real picks fall between them.
  const TOP10 = "top10/capoff/pinon";
  const bracket = {
    reads: 0,
    lowerInside: 0,
    insideUpper: 0,
    equalLower: 0,
    equalUpper: 0,
  };
  const top10Carried = rows.map(() => 0);
  for (const reads of draws) {
    for (const read of reads) {
      const want = new Set(read.per[TOP10]?.chunkIds ?? []);
      const lowerSet = (await build(read, byId, 10, "lower")).set.map(
        (c) => c.chunkId,
      );
      const upperSet = new Set(
        (await build(read, byId, 10, "upper")).set.map((c) => c.chunkId),
      );
      bracket.reads += 1;
      if (lowerSet.every((id) => want.has(id))) bracket.lowerInside += 1;
      if ([...want].every((id) => upperSet.has(id))) bracket.insideUpper += 1;
      if (lowerSet.length === want.size && lowerSet.every((id) => want.has(id)))
        bracket.equalLower += 1;
      if (
        upperSet.size === want.size &&
        [...want].every((id) => upperSet.has(id))
      )
        bracket.equalUpper += 1;
    }
    rows.forEach((row, i) => {
      const read = reads.find((r) => r.id === row.case);
      if (read?.per[TOP10] !== undefined && carriedBy(row, read.per[TOP10].set))
        top10Carried[i] += 1;
    });
  }
  const top10Sum = top10Carried.reduce((a, b) => a + b, 0);

  const results: CutResult[] = [];
  for (const cutSize of CUTS) {
    for (const side of ["lower", "upper"] as const) {
      const result: CutResult = {
        cutSize,
        side,
        cutCarried: rows.map(() => 0),
        setCarried: rows.map(() => 0),
        pairs: 0,
        draws: [],
        added: [],
        sets: [],
      };
      for (const reads of draws) {
        const sizes: number[] = [];
        let hits = 0;
        let gated = 0;
        let robust = 0;
        let block = 0;
        const built = new Map<string, Built>();
        for (const read of reads) {
          const b = await build(read, byId, cutSize, side);
          built.set(read.id, b);
          if (!read.weak) sizes.push(b.set.length);
          if (b.set.length > 0)
            result.sets.push({ query: read.query, set: b.set });
          if (cutSize !== 8 && b.set.length > 0) {
            const base = new Set(
              (await build(read, byId, 8, side)).set.map((c) => c.chunkId),
            );
            result.added.push(...b.set.filter((c) => !base.has(c.chunkId)));
          }
          const evalCase = cases.get(read.id);
          if (read.kind === "retrieval" && evalCase !== undefined) {
            const hit = evalCase.expected.some((t) =>
              b.set.some((c) => chunkMatchesTarget(c, t)),
            );
            if (isRobustness(read)) {
              block += 1;
              if (hit) robust += 1;
            } else {
              gated += 1;
              if (hit) hits += 1;
            }
          }
        }
        rows.forEach((row, i) => {
          const b = built.get(row.case);
          if (b === undefined) return;
          result.pairs += 1;
          if (carriedBy(row, b.cut.map(label))) result.cutCarried[i] += 1;
          if (carriedBy(row, b.set.map(label))) result.setCarried[i] += 1;
        });
        result.draws.push({ size: median(sizes), hits, gated, robust, block });
      }
      results.push(result);
    }
  }

  const floorBroken = (carried: readonly number[]) =>
    floor
      .filter((i) => carried[i] < 3)
      .map((i) => i + 1)
      .join(",") || "none";
  const out: string[] = [
    `${rows.length} carrier rows, ${draws.length} draws, ${byId.size} chunks in the dump`,
    `check: the N=8 replay equals the recorded set (ids, in order) on ${same}/${total} (read, side) pairs${off.length > 0 ? `; differs: ${off.slice(0, 12).join(", ")}` : ""}`,
    `check: the probe's own top10/capoff/pinon set (real step picks), as sets, on ${bracket.reads} reads: holds the lower side on ${bracket.lowerInside}, inside the upper side on ${bracket.insideUpper}; equals lower on ${bracket.equalLower}, upper on ${bracket.equalUpper}`,
    `recorded top10/capoff/pinon: ${top10Sum}/${rows.length * draws.length} pairs (${pct(top10Sum, rows.length * draws.length)}), floor broken: ${floorBroken(top10Carried)}`,
    `recorded control: ${recordedCarried.reduce((a, b) => a + b, 0)}/${rows.length * draws.length} pairs; floor rows (≥ 4/5): ${floor.map((i) => i + 1).join(", ")}`,
    "",
    "Rows carried, mean over the draws (of 64), and R1 over (row, draw) pairs.",
    "cut = the rerank cut alone; set = the cut plus every pin, replayed.",
    "",
    "N   side   cut/draw  set/draw  R1 (set)            floor broken  median size  hit-rate per draw       robustness",
  ];
  for (const r of results) {
    const cutMean = r.cutCarried.reduce((a, b) => a + b, 0) / draws.length;
    const setSum = r.setCarried.reduce((a, b) => a + b, 0);
    const broken = floor.filter((i) => r.setCarried[i] < 3).map((i) => i + 1);
    const sizes = r.draws.map((d) => d.size ?? 0);
    const hits = r.draws.map((d) => `${d.hits}`).join("/");
    const gated = r.draws[0]?.gated ?? 0;
    const robust = r.draws.reduce((n, d) => n + d.robust, 0);
    const block = r.draws.reduce((n, d) => n + d.block, 0);
    out.push(
      `${String(r.cutSize).padEnd(4)}${r.side.padEnd(7)}${cutMean.toFixed(1).padEnd(10)}${(setSum / draws.length).toFixed(1).padEnd(10)}${`${setSum}/${r.pairs} ${pct(setSum, r.pairs)}`.padEnd(20)}${(broken.join(",") || "none").padEnd(14)}${`${median(sizes)} (${Math.min(...sizes)}–${Math.max(...sizes)})`.padEnd(13)}${`${hits} of ${gated}`.padEnd(24)}${robust}/${block}`,
    );
  }

  out.push(
    "",
    "Per row, draws carrying it, lower side (cut alone · set) at N = 8 / 10 / 12 / 16:",
  );
  const lower = results.filter((r) => r.side === "lower");
  const upper = results.filter((r) => r.side === "upper");
  rows.forEach((row, i) => {
    const cells = lower
      .map((r) => `${r.cutCarried[i]}·${r.setCarried[i]}`)
      .join("  ");
    const up = upper.map((r) => r.setCarried[i]).join("/");
    out.push(
      `  ${String(i + 1).padStart(2)}${floor.includes(i) ? "*" : " "} ${cells}   upper set ${up}   ${row.case} [${row.sources.join(", ") || "lone"}]`,
    );
  });
  out.push("  (* a floor row: the control carries it on ≥ 4/5 draws)");

  // What a chunk costs the answer prompt, in characters as the prompt renders
  // it, then in tokens on #303's calibration.
  const { a, b, n } = calibration();
  const today = "2026-10-28";
  const userChars = (query: string, set: readonly RetrievedChunk[]) =>
    buildUserPrompt(query, set, { today }).length;
  const rendered = (c: RetrievedChunk) =>
    userChars("", [c]) - userChars("", []);
  out.push(
    "",
    `token calibration (2026-09-15 top-k, Sonnet 5 tokenizer, ${n} prompts): tokens ≈ ${a.toFixed(0)} + ${b.toFixed(4)} × chunk chars (${(1 / b).toFixed(2)} chars a token)`,
    "",
    "Answer prompt, lower side, as `buildUserPrompt` renders it (chunk + its header):",
    "N   chunks added past N=8 (median chars)  median user prompt chars  ≈ tokens: user + system = total",
  );
  const systemTokens = b * ANSWER_SYSTEM_PROMPT.length;
  for (const r of lower) {
    const added = r.added.map(rendered);
    const user =
      median(r.sets.map(({ query, set }) => userChars(query, set))) ?? 0;
    out.push(
      `${String(r.cutSize).padEnd(4)}${(r.cutSize === 8 ? "—" : `${added.length} (${median(added)})`).padEnd(38)}${String(user).padEnd(26)}${Math.round(b * user)} + ${Math.round(systemTokens)} = ${Math.round(b * user + systemTokens)}`,
    );
  }
  const all = at8Chunks(lower[0], rendered);
  out.push(
    "",
    `median chunk at N=8: ${all.median} chars over ${all.count} chunk-reads ≈ ${Math.round(b * (all.median ?? 0))} tokens`,
  );
  console.log(out.join("\n"));
}

/**
 * Tokens per character of chunk text, from #303's top-8/top-10 pair: the same
 * 73 questions answered on 8 and on 10 chunks, with `pnpm prompt-tokens`'
 * per-prompt counts committed beside the transcripts. A least-squares line of
 * tokens on chunk characters, over the 146 prompts.
 */
function calibration(): { a: number; b: number; n: number } {
  const dir = path.join("eval", "runs", "2026-09-15-top-k");
  const pairs: { chars: number; tokens: number }[] = [];
  for (const arm of ["A", "B"]) {
    const transcript = readFileSync(
      path.join(
        dir,
        `${arm}-groundedness-claude-sonnet-5-${arm === "A" ? "20260915T020253Z" : "20260915T025512Z"}.jsonl`,
      ),
      "utf8",
    )
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map(
        (l) => JSON.parse(l) as { id: string; chunks: { content: string }[] },
      );
    const tokens = new Map(
      readFileSync(path.join(dir, `probe-tokens-${arm}.txt`), "utf8")
        .split("\n")
        .flatMap((l) => {
          const m = l.match(/^\s+(\S+)\t\d+\t(\d+)$/);
          return m ? [[m[1], Number(m[2])] as const] : [];
        }),
    );
    for (const row of transcript) {
      const t = tokens.get(row.id);
      if (t === undefined || row.chunks.length === 0) continue;
      pairs.push({
        chars: row.chunks.reduce((n, c) => n + c.content.length, 0),
        tokens: t,
      });
    }
  }
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.chars, 0) / n;
  const my = pairs.reduce((s, p) => s + p.tokens, 0) / n;
  const b =
    pairs.reduce((s, p) => s + (p.chars - mx) * (p.tokens - my), 0) /
    pairs.reduce((s, p) => s + (p.chars - mx) ** 2, 0);
  const a = my - b * mx;
  return { a, b, n };
}

function at8Chunks(
  r: CutResult,
  rendered: (c: RetrievedChunk) => number,
): { median: number | null; count: number } {
  const all = r.sets.flatMap(({ set }) => set.map(rendered));
  return { median: median(all), count: all.length };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
