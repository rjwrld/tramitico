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
 * Cents: embeddings, expansions and two Voyage calls per case. A diagnostic,
 * not a gate. Usage (reads `.env.local` like `ingest.ts`):
 *
 *   pnpm answer-set-probe [out.json]
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
import { createEmbedder } from "../src/lib/ingestion/embedder";
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
}

function label(chunk: RetrievedChunk): string {
  return `${chunk.docKey}·${chunk.articulo ?? "*"}·#${chunk.part}`;
}

async function readCase(
  evalCase: EvalCase,
  kind: "retrieval" | "abstention",
  embedder: ReturnType<typeof createEmbedder>,
): Promise<CaseRead> {
  const retrieval = await retrieve(evalCase.question, {
    matchCount: RERANK_POOL,
    embedder,
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
    return read;
  }
  const outcome = await rerankReadings(evalCase.question, retrieval.chunks, {
    expansion: retrieval.expansion,
    steps: retrieval.steps?.sentences ?? null,
  });
  const order: RerankedChunk[] | null = outcome?.order ?? null;
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
  const single = retrievalCases(all).filter((c) => !c.history);
  const abs = abstentionCases(all).filter((c) => !c.history);
  const out = process.argv[2] ?? "answer-set-probe.json";
  const embedder = createEmbedder();
  const reads: CaseRead[] = [];
  for (const c of single) {
    reads.push(await readCase(c, "retrieval", embedder));
    process.stdout.write(".");
  }
  for (const c of abs) {
    reads.push(await readCase(c, "abstention", embedder));
    process.stdout.write("a");
  }
  console.log();
  writeFileSync(out, JSON.stringify({ configs: CONFIGS, reads }, null, 1));

  const totalTargets = reads
    .filter((r) => r.kind === "retrieval")
    .reduce((n, r) => n + r.expectedCount, 0);
  console.log(
    `single-turn retrieval cases: ${single.length} (${totalTargets} expected targets), abstention: ${abs.length}`,
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
