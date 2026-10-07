/**
 * Deterministic answer-set probe (#312, #305): retrieve → rerank → cap → pin
 * → resolve, no answer model, no judge, over every retrieval case and every
 * abstention case. One retrieval and one rerank per case; every
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
 * A follow-up — a case carrying `history` — is condensed first, by the
 * route's own `condenseQuestion`, and read on the rewrite the pipeline
 * actually retrieves on (#456): until then the probe skipped them, so
 * `ccss-ventana-prescripcion-24-meses`, whose one dated chunk no run was
 * putting in front of the model, was a case it could not see. That is one
 * small-model call per follow-up, and it moves the totals: a figure from
 * before #456 counted single-turn cases only.
 *
 * Since #457 it also records every stage a case passed through — the
 * standalone query, the expansion, the fused pool, the whole reranked order,
 * and every provider call that failed — so two runs on one stack can be
 * compared case by case and the first stage at which they part named
 * (`pnpm answer-set-compare a.json b.json`, free). `EVAL_REWRITES=<earlier.json>`
 * replays the text an earlier probe's models wrote for each case — the
 * expansion, and a follow-up's condensed question — instead of asking again
 * (`src/lib/eval/rewrites.ts`, which the eval lanes read too): the "expansion
 * cached per query" arm, which leaves Voyage as the only provider still live.
 * `EXPAND=off` is the "no expansion" arm, as everywhere else.
 *
 * A replayed run asks no small model, so cases arrive fast enough for Voyage
 * to reject rerank readings with 429 (#457: 54 cases/min). `PROBE_CASE_MS`
 * makes each case take at least that long, so a frozen run can be paced
 * like a live one (≈21 cases/min, `PROBE_CASE_MS=3000`) (#460).
 *
 * The robustness block (#502) is read like any other case and summed apart:
 * the configuration table counts the cases it counted before the block
 * existed, so an earlier probe's totals still compare, and the block prints
 * its own line under the route's configuration, every miss beside its seed.
 * `EVAL_CASES=<id,…>` scopes the probe the way it scopes the lanes
 * (`src/lib/eval/subset.ts`): the three-case smoke before a full arm.
 *
 * Cents: embeddings, expansions, condensations and a Voyage call per rerank
 * reading. A diagnostic, not a gate. Usage (reads `.env.local` like
 * `ingest.ts`):
 *
 *   [EVAL_CASES=<id,…>] [EVAL_REWRITES=<earlier.json>] [PROBE_CASE_MS=<ms>] pnpm answer-set-probe [out.json]
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
import {
  pinDerivedFigureInputs,
  resolveDerivedFigures,
} from "../src/lib/answer/derived";
import {
  answerSetFromOrder,
  RERANK_POOL,
  rerankOptionsFor,
  rerankReadings,
  type RerankedChunk,
  type RerankReadingCount,
} from "../src/lib/answer/rerank";
import { PRODUCTION_CONFIG } from "../src/lib/eval/answer-set-variance";
import {
  abstentionCases,
  chunkMatchesTarget,
  DATASET_PATH,
  isRobustness,
  parseDataset,
  retrievalCases,
  robustnessSeedId,
  type EvalCase,
  type Variant,
} from "../src/lib/eval/dataset";
import { formatRobustnessLine } from "../src/lib/eval/robustness";
import {
  REWRITES_ENV,
  rewriteCase,
  rewritesFromEnv,
  type CaseRewrites,
} from "../src/lib/eval/rewrites";
import { selectCases, subsetSpec } from "../src/lib/eval/subset";
import { droppedReadingsSummary } from "../src/lib/eval/transcript";
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
  /** What retrieval ran on: the question, or a follow-up's condensation. */
  query: string;
  /** A follow-up whose condensation failed and fell back to the question. */
  condenseFailed: boolean;
  tier: unknown;
  family: string | null;
  /** The held-out shape, or `robustez` for the robustness block (#502). */
  variant: Variant | null;
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
   * `rerank` is `rerankReadings.dropped.length`.
   */
  failures: { condense: number; expand: number; embed: number; rerank: number };
  /**
   * The rerank's own count (#466): readings asked, back, and each one lost
   * with its cause and HTTP status. `null` when the rerank never called
   * Voyage — weak retrieval, `RERANK=off`, no key.
   */
  rerankReadings: RerankReadingCount | null;
  /** Wall-clock of each step, against the 3–5 s budgets that drop a leg. */
  ms: { rewrite: number; retrieve: number; rerank: number };
}

function label(chunk: RetrievedChunk): string {
  return `${chunk.docKey}·${chunk.articulo ?? "*"}·#${chunk.part}`;
}

/**
 * Counts every embed call a case makes that does not come back. Rerank
 * readings count themselves since #466 (`onReadings`), with the status the
 * fetch wrapper that used to count them here could not see past.
 */
interface CallCounter {
  embedder: Embedder;
  take(): { embed: number };
}

function countingCalls(embedder: Embedder): CallCounter {
  let embed = 0;
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
    take() {
      const taken = { embed };
      embed = 0;
      return taken;
    },
  };
}

/**
 * Counts the condensation and expansion fallbacks a case hits, off the lines
 * condense.ts and expand.ts log for each — the same prefixes the log drain
 * counts in production. The lines still print.
 */
const rewriteFailures = { condense: 0, expand: 0 };
const consoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const line = String(args[0]);
  if (line.startsWith("ask: condensation failed"))
    rewriteFailures.condense += 1;
  if (line.startsWith("ask: expansion failed")) rewriteFailures.expand += 1;
  consoleWarn(...args);
};

async function readCase(
  evalCase: EvalCase,
  kind: "retrieval" | "abstention",
  calls: CallCounter,
  rewrites: ReadonlyMap<string, CaseRewrites> | null,
): Promise<CaseRead> {
  const before = { ...rewriteFailures };
  const started = Date.now();
  // The route's own first step (#132), or its replay (#457): a single-turn
  // case run live skips the call.
  const { query, condensed, expander } = await rewriteCase(evalCase, rewrites);
  const rewritten = Date.now();
  const retrieval = await retrieve(query, {
    matchCount: RERANK_POOL,
    embedder: calls.embedder,
    expander,
  });
  const read: CaseRead = {
    id: evalCase.id,
    kind,
    query,
    condenseFailed: evalCase.history !== undefined && condensed === null,
    tier: evalCase.tier,
    family: evalCase.family ?? null,
    variant: evalCase.variant ?? null,
    weak: retrieval.isWeak,
    expansionFailed: retrieval.expansion === null,
    expectedCount: evalCase.expected.length,
    per: {},
    targetRanks: [],
    expansion: retrieval.expansion,
    steps: retrieval.steps?.family ?? null,
    pool: retrieval.chunks.map(label),
    order: null,
    scores: null,
    failures: { condense: 0, expand: 0, embed: 0, rerank: 0 },
    rerankReadings: null,
    ms: {
      rewrite: rewritten - started,
      retrieve: Date.now() - rewritten,
      rerank: 0,
    },
  };
  const tally = () => {
    const { embed } = calls.take();
    read.failures = {
      condense: rewriteFailures.condense - before.condense,
      expand: rewriteFailures.expand - before.expand,
      embed,
      rerank: read.rerankReadings?.dropped.length ?? 0,
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
    ...rerankOptionsFor(retrieval),
    onReadings: (count) => {
      read.rerankReadings = count;
    },
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
  // Before any paid call: an id that names no case throws here.
  const all = selectCases(
    parseDataset(readFileSync(DATASET_PATH, "utf8")),
    subsetSpec(),
  );
  const retrievals = retrievalCases(all);
  const abs = abstentionCases(all);
  const out = process.argv[2] ?? "answer-set-probe.json";
  const rewrites = rewritesFromEnv();
  const calls = countingCalls(createEmbedder());
  const reads: CaseRead[] = [];
  const caseMs = Number(process.env.PROBE_CASE_MS) || 0;
  const paced = async (read: () => Promise<CaseRead>) => {
    const started = Date.now();
    reads.push(await read());
    const rest = caseMs - (Date.now() - started);
    if (rest > 0) await new Promise((done) => setTimeout(done, rest));
  };
  for (const c of retrievals) {
    await paced(() => readCase(c, "retrieval", calls, rewrites));
    process.stdout.write(".");
  }
  for (const c of abs) {
    await paced(() => readCase(c, "abstention", calls, rewrites));
    process.stdout.write("a");
  }
  console.log();
  writeFileSync(out, JSON.stringify({ configs: CONFIGS, reads }, null, 1));

  // The table below counts what it counted before #502; the block is summed
  // apart, under it.
  const retrievalReads = reads.filter(
    (r) => r.kind === "retrieval" && !isRobustness(r),
  );
  const totalTargets = retrievalReads.reduce((n, r) => n + r.expectedCount, 0);
  const followUps = [...retrievals, ...abs].filter((c) => c.history).length;
  console.log(
    `retrieval cases: ${retrievals.length} (${retrievals.length - retrievalReads.length} in the robustness block; ${totalTargets} expected targets outside it), abstention: ${abs.length}, follow-ups condensed: ${followUps}`,
  );
  console.log(
    `condensation fell back to the question: ${
      reads
        .filter((r) => r.condenseFailed)
        .map((r) => r.id)
        .join(", ") || "none"
    }`,
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
    droppedReadingsSummary(
      reads.map((r) => ({ id: r.id, rerank: r.rerankReadings })),
    ),
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

  // #502: a block case hits when one of its seed's targets is in the route's
  // answer set — the hit-rate lane's metric. Its seed's own read, when the
  // run had it, says whether the miss is the wording's or the seed's too.
  const block = all.filter(isRobustness);
  if (block.length > 0) {
    const byId = new Map(reads.map((r) => [r.id, r]));
    const hit = (id: string | null) => {
      const read = id === null ? undefined : byId.get(id);
      return read === undefined
        ? null
        : read.per[PRODUCTION_CONFIG].present > 0;
    };
    console.log(
      `\n${formatRobustnessLine(
        PRODUCTION_CONFIG,
        block,
        (evalCase) => evalCase,
        (evalCase) => hit(evalCase.id) === true,
        (evalCase) => {
          const seedHit = hit(robustnessSeedId(evalCase));
          return `(seed ${seedHit === null ? "not read" : seedHit ? "hit" : "missed too"})`;
        },
      )}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
