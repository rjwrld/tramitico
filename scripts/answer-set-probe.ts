/**
 * Deterministic answer-set probe (#312, #305): retrieve → rerank → cap → pin
 * → resolve, no answer model, no judge, over every single-turn retrieval case
 * and every abstention case. One retrieval and one rerank per case; every
 * configuration of `ANSWER_TOP_K` × `ANSWER_DOC_CAP` × `PIN_DERIVED_INPUTS`
 * is then a pure function of that one reranked order, so the arms are
 * compared on identical pools rather than on run-to-run expansion noise.
 *
 * Prints, per configuration: expected targets present in the answer set,
 * cases holding every target, derived figures resolved, and the abstention
 * cases that resolve a figure — the leak #312 found under the document cap.
 * The JSON it writes carries every case's per-configuration answer set and
 * each expected target's reranked rank, for the per-case read.
 *
 * Since #457 it also records every stage a case passed through — the
 * standalone query, the expansion, the fused pool, the whole reranked order,
 * and every provider call that failed — so two runs on one stack can be
 * compared case by case and the first stage at which they part named
 * (`pnpm answer-set-compare a.json b.json`, free). Two switches serve that
 * measurement:
 *
 * - `EVAL_REWRITES=<earlier.json>` replays the text an earlier probe's
 *   models wrote for each case — the expansion, and a follow-up's condensed
 *   question — instead of asking again (`src/lib/eval/rewrites.ts`, which
 *   the eval lanes read too): the "expansion cached per query" arm, which
 *   leaves Voyage as the only provider still live. `EXPAND=off` is the "no
 *   expansion" arm, as everywhere else.
 * - `--follow-ups` adds the retrieval cases that carry `history`, condensed
 *   first exactly as the eval lanes condense them: the 27 Tier 1 cases the
 *   full lane reads, not only the 18 single-turn ones. Off by default, so the
 *   aggregate lines stay comparable with the probe runs before it.
 *
 * Cents: embeddings, expansions, condensations and a Voyage call per rerank
 * reading. A diagnostic, not a gate. Usage (reads `.env.local` like `ingest.ts`):
 *
 *   [EVAL_REWRITES=<earlier.json>] pnpm answer-set-probe [out.json] [--follow-ups]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
/** `.env.local`, the way `ingest.ts` loads it — never over an exported value. */
function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
import { condenseFailures } from "../src/lib/answer/condense";
import { expandFailures } from "../src/lib/answer/expand";
import {
  pinDerivedFigureInputs,
  resolveDerivedFigures,
} from "../src/lib/answer/derived";
import {
  answerSetFromOrder,
  RERANK_POOL,
  rerankReadings,
  type RerankedChunk,
} from "../src/lib/answer/rerank";
import {
  abstentionCases,
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
  retrievalCases,
  type EvalCase,
} from "../src/lib/eval/dataset";
import {
  REWRITES_ENV,
  rewriteCase,
  rewritesFromEnv,
  type CaseRewrites,
} from "../src/lib/eval/rewrites";
import { createEmbedder, type Embedder } from "../src/lib/ingestion/embedder";
import { retrieve, type RetrievedChunk } from "../src/lib/retrieval";

interface Config {
  name: string;
  topK: string;
  cap: string;
  pin: string;
}

const CONFIGS: Config[] = [];
for (const topK of ["8", "10"]) {
  for (const cap of ["off", "3", "2"]) {
    for (const pin of ["off", "on"]) {
      CONFIGS.push({ name: `top${topK}/cap${cap}/pin${pin}`, topK, cap, pin });
    }
  }
}

interface CaseRead {
  id: string;
  kind: "retrieval" | "abstention";
  tier: unknown;
  family: string | null;
  weak: boolean;
  expansionFailed: boolean;
  expectedCount: number;
  /** Per config: targets present, figures resolved, answer set labels. */
  per: Record<
    string,
    {
      present: number;
      missing: string[];
      figures: string[];
      size: number;
      pinned: string[];
      set: string[];
    }
  >;
  /** Reranked rank of each expected target (1-based) or null. */
  targetRanks: { target: string; rank: number | null }[];
  /** The standalone question the pipeline ran on (#457). */
  query: string;
  /** The expansion the legs and the rerank read, null for none. */
  expansion: string | null;
  /** The step catalogue family the probe searched, null for none. */
  steps: string | null;
  /** The fused pool, best first. */
  pool: string[];
  /** The whole reranked order, null when the rerank did not happen. */
  order: string[] | null;
  /** Voyage's score for each place of `order`, for reading near-ties. */
  scores: number[] | null;
  /**
   * Provider calls on this case that did not come back: a failed embed or
   * rerank reading is silent in production (a leg or a reading is dropped),
   * and either one changes the answer set without changing any text.
   */
  failures: { condense: number; expand: number; embed: number; rerank: number };
  /** Wall-clock of each step, against the 3–5 s budgets that drop a leg. */
  ms: { rewrite: number; retrieve: number; rerank: number };
}

function label(chunk: RetrievedChunk): string {
  return `${chunk.docKey}·${chunk.articulo ?? "*"}·#${chunk.part}`;
}

/** Counts every provider call a case makes that does not come back. */
interface CallCounter {
  embedder: Embedder;
  fetchImpl: typeof fetch;
  take(): { embed: number; rerank: number };
}

function countingCalls(embedder: Embedder): CallCounter {
  let embed = 0;
  let rerank = 0;
  return {
    embedder: {
      ...embedder,
      embedQuery: async (text) => {
        try {
          return await embedder.embedQuery(text);
        } catch (error) {
          embed += 1;
          throw error;
        }
      },
    },
    fetchImpl: async (input, init) => {
      try {
        const res = await fetch(input, init);
        if (!res.ok) rerank += 1;
        return res;
      } catch (error) {
        rerank += 1;
        throw error;
      }
    },
    take() {
      const taken = { embed, rerank };
      embed = 0;
      rerank = 0;
      return taken;
    },
  };
}

async function readCase(
  evalCase: EvalCase,
  kind: "retrieval" | "abstention",
  calls: CallCounter,
  rewrites: ReadonlyMap<string, CaseRewrites> | null,
): Promise<CaseRead> {
  const condenseBefore = condenseFailures();
  const expandBefore = expandFailures();
  const started = Date.now();
  const { query, expander } = await rewriteCase(evalCase, rewrites);
  const rewritten = Date.now();
  const retrieval = await retrieve(query, {
    matchCount: RERANK_POOL,
    embedder: calls.embedder,
    expander,
  });
  const read: CaseRead = {
    id: evalCase.id,
    kind,
    tier: evalCase.tier,
    family: evalCase.family ?? null,
    weak: retrieval.isWeak,
    expansionFailed: retrieval.expansion === null,
    expectedCount: evalCase.expected.length,
    per: {},
    targetRanks: [],
    query,
    expansion: retrieval.expansion,
    steps: retrieval.steps?.family ?? null,
    pool: retrieval.chunks.map(label),
    order: null,
    scores: null,
    failures: { condense: 0, expand: 0, embed: 0, rerank: 0 },
    ms: {
      rewrite: rewritten - started,
      retrieve: Date.now() - rewritten,
      rerank: 0,
    },
  };
  const tally = () => {
    const { embed, rerank } = calls.take();
    const condenseAfter = condenseFailures();
    const expandAfter = expandFailures();
    const sum = (counts: Record<string, number>) =>
      Object.values(counts).reduce((n, v) => n + v, 0);
    read.failures = {
      condense: sum(condenseAfter) - sum(condenseBefore),
      expand: sum(expandAfter) - sum(expandBefore),
      embed,
      rerank,
    };
  };
  if (retrieval.isWeak) {
    for (const c of CONFIGS) {
      read.per[c.name] = {
        present: 0,
        missing: evalCase.expected.map(
          (t) => `${t.docKey}/${t.articulo ?? "*"}`,
        ),
        figures: [],
        size: 0,
        pinned: [],
        set: [],
      };
    }
    tally();
    return read;
  }
  const reranking = Date.now();
  const outcome = await rerankReadings(query, retrieval.chunks, {
    expansion: retrieval.expansion,
    steps: retrieval.steps?.sentences ?? null,
    fetchImpl: calls.fetchImpl,
  });
  const order: RerankedChunk[] | null = outcome?.order ?? null;
  read.order = order === null ? null : order.map((entry) => label(entry.chunk));
  read.scores = order === null ? null : order.map((entry) => entry.score);
  read.ms.rerank = Date.now() - reranking;
  tally();
  read.targetRanks = evalCase.expected.map((t) => {
    const i = (order ?? []).findIndex((e) => chunkMatchesTarget(e.chunk, t));
    return {
      target: `${t.docKey}/${t.articulo ?? "*"}`,
      rank: i === -1 ? null : i + 1,
    };
  });
  for (const c of CONFIGS) {
    process.env.ANSWER_TOP_K = c.topK;
    process.env.ANSWER_DOC_CAP = c.cap;
    process.env.PIN_DERIVED_INPUTS = c.pin;
    const cut = answerSetFromOrder(
      order,
      retrieval.chunks,
      outcome?.stepPicks ?? [],
    );
    const chunks = pinDerivedFigureInputs(cut, retrieval.chunks);
    const figures = resolveDerivedFigures(chunks);
    const presentTargets = evalCase.expected.filter((t) =>
      chunks.some((ch) => chunkMatchesTarget(ch, t)),
    );
    read.per[c.name] = {
      present: presentTargets.length,
      missing: evalCase.expected
        .filter((t) => !presentTargets.includes(t))
        .map((t) => `${t.docKey}/${t.articulo ?? "*"}`),
      figures: figures.map((f) => f.id),
      size: chunks.length,
      pinned: chunks.slice(cut.length).map(label),
      set: chunks.map(label),
    };
  }
  return read;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const all = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const args = process.argv.slice(2);
  const followUps = args.includes("--follow-ups");
  const out =
    args.find((arg) => !arg.startsWith("--")) ?? "answer-set-probe.json";
  const rewrites = rewritesFromEnv();
  const single = retrievalCases(all).filter((c) => followUps || !c.history);
  const abs = abstentionCases(all).filter((c) => !c.history);
  const calls = countingCalls(createEmbedder());
  const reads: CaseRead[] = [];
  for (const c of single) {
    reads.push(await readCase(c, "retrieval", calls, rewrites));
    process.stdout.write(".");
  }
  for (const c of abs) {
    reads.push(await readCase(c, "abstention", calls, rewrites));
    process.stdout.write("a");
  }
  console.log();
  writeFileSync(out, JSON.stringify({ configs: CONFIGS, reads }, null, 1));

  const totalTargets = reads
    .filter((r) => r.kind === "retrieval")
    .reduce((n, r) => n + r.expectedCount, 0);
  console.log(
    `${followUps ? "retrieval cases, follow-ups included" : "single-turn retrieval cases"}: ${single.length} (${totalTargets} expected targets), abstention: ${abs.length}`,
  );
  console.log(
    `rewrites: ${rewrites === null ? "live" : `replayed from ${process.env[REWRITES_ENV]}`}`,
  );
  const failed = reads.filter((r) =>
    Object.values(r.failures).some((n) => n > 0),
  );
  console.log(
    `provider calls that did not come back: ${
      failed
        .map(
          (r) =>
            `${r.id}(${Object.entries(r.failures)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k}×${n}`)
              .join(",")})`,
        )
        .join(" ") || "none"
    }`,
  );
  console.log(
    `weak: ${
      reads
        .filter((r) => r.weak)
        .map((r) => r.id)
        .join(", ") || "none"
    }`,
  );
  console.log(
    `expansion absent: ${
      reads
        .filter((r) => r.expansionFailed)
        .map((r) => r.id)
        .join(", ") || "none"
    }`,
  );
  console.log(
    `\n${"config".padEnd(20)} ${"targets".padEnd(10)} ${"cases w/ all".padEnd(12)} figures  abs-figures`,
  );
  for (const c of CONFIGS) {
    const retrievalReads = reads.filter((r) => r.kind === "retrieval");
    const present = retrievalReads.reduce(
      (n, r) => n + r.per[c.name].present,
      0,
    );
    const full = retrievalReads.filter(
      (r) => r.per[c.name].present === r.expectedCount,
    ).length;
    const figures = retrievalReads.reduce(
      (n, r) => n + r.per[c.name].figures.length,
      0,
    );
    const absFigures = reads
      .filter(
        (r) => r.kind === "abstention" && r.per[c.name].figures.length > 0,
      )
      .map((r) => `${r.id}(${r.per[c.name].figures.join(",")})`);
    console.log(
      `${c.name.padEnd(20)} ${`${present}/${totalTargets}`.padEnd(10)} ${`${full}/${retrievalReads.length}`.padEnd(12)} ${String(figures).padEnd(8)} ${absFigures.join(" ") || "—"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
