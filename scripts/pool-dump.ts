/**
 * Fused-pool dump for one or more eval cases (issue #286).
 *
 * When a case misses, the hit-rate eval says *that* it missed and at what
 * pool rank; this says **why**. For each case it prints the top of the fused
 * pool with every leg's rank, then, for each expected target, where that
 * chunk sits in each leg over the whole corpus — which is the difference
 * between "the chunk is wrong" and "the question is in the wrong register",
 * the two causes #286 had to tell apart.
 *
 * Cheap on purpose: one embed per case (plus one per expansion), no answer
 * model, no judge, no rerank. It is a diagnostic, not a gate — nothing here
 * asserts, and no gate reads it.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=… \
 *   pnpm pool-dump inscripcion-tardia-sancion ho-t2-payoneer
 *
 * With ANTHROPIC_API_KEY set the expansion legs (#286) run too, and the
 * rewrite is printed above the pool; without it the dump is the v4 two-leg
 * search, which is also what `--no-expansion` forces.
 */
import { readFileSync } from "node:fs";
import { RERANK_POOL } from "../src/lib/answer/rerank";
import {
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
  type EvalCase,
} from "../src/lib/eval/dataset";
import { createEmbedder } from "../src/lib/ingestion/embedder";
import { retrieve, type RetrievedChunk } from "../src/lib/retrieval";

/** How much of the pool to print. The whole pool is rarely the story. */
const SHOWN = 10;

function leg(rank: number | null | undefined): string {
  return rank == null ? "—" : String(rank);
}

function label(chunk: RetrievedChunk): string {
  return `${chunk.docKey} / ${chunk.articulo ?? "—"} #${chunk.part}`;
}

function dumpCase(evalCase: EvalCase, chunks: RetrievedChunk[]): void {
  const expected = evalCase.expected
    .map((t) => `${t.docKey}/${t.articulo ?? "*"}`)
    .join(" | ");
  console.log(`\n=== ${evalCase.id} ===`);
  console.log(`pregunta:  ${evalCase.question}`);
  console.log(`esperado:  ${expected}`);

  const poolIndex = chunks.findIndex((chunk) =>
    evalCase.expected.some((target) => chunkMatchesTarget(chunk, target)),
  );
  console.log(
    `pool rank del primer objetivo (de ${RERANK_POOL}): ` +
      (poolIndex === -1 ? "fuera del pool" : String(poolIndex + 1)),
  );
  console.log(`  #   v    l   xv   xl   score  chunk`);
  for (const [i, chunk] of chunks.slice(0, SHOWN).entries()) {
    const hit = evalCase.expected.some((t) => chunkMatchesTarget(chunk, t));
    console.log(
      `${String(i + 1).padStart(3)} ` +
        [
          chunk.vectorRank,
          chunk.lexicalRank,
          chunk.expansionVectorRank,
          chunk.expansionLexicalRank,
        ]
          .map((rank) => leg(rank).padStart(4))
          .join(" ") +
        `  ${chunk.score.toFixed(5)}  ${hit ? "→ " : "  "}${label(chunk)}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noExpansion = args.includes("--no-expansion");
  const ids = args.filter((arg) => !arg.startsWith("--"));
  if (ids.length === 0) {
    console.error(
      "usage: pnpm pool-dump [--no-expansion] <case id> [<case id> …]",
    );
    process.exit(2);
  }

  const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const wanted = ids.map((id) => {
    const found = cases.find((evalCase) => evalCase.id === id);
    if (!found) throw new Error(`no such case in eval/dataset.jsonl: ${id}`);
    return found;
  });

  const embedder = createEmbedder();
  for (const evalCase of wanted) {
    // The case's own question, not a condensed one: a condensation case is
    // diagnosed by reading its rewrite in the hit-rate run, and re-deriving
    // it here would spend an answer model on a retrieval question.
    const result = await retrieve(evalCase.question, {
      matchCount: RERANK_POOL,
      embedder,
      ...(noExpansion ? { expander: null } : {}),
    });
    if (result.expansion) console.log(`\nexpansión: ${result.expansion}`);
    dumpCase(evalCase, result.chunks);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
