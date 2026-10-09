/**
 * Where #561's carriers fall in the step rerank (one-off read, not a gate).
 *
 * The committed probes record the fused pool and the question's reranked
 * order, not the step picks, so they can say a carrier was pooled and cut
 * but not why `pin1` appended another chunk. This runs the route's own
 * retrieve → rerank on the ten cases and prints, per case: each catalogue
 * sentence's pick (its best chunk against that sentence), the pick `pin1`
 * appends, and every carrier's fused rank, question rank and rank in each
 * sentence's own reading. Voyage's raw responses are captured through
 * `fetchImpl`, so nothing in `src/` changes.
 *
 * It writes `{ reads: [{ id, query, expansion }] }`, which `EVAL_REWRITES`
 * reads, so later probes can replay the same rewrites.
 *
 * Usage (reads `.env.local`, never over an exported value):
 *   pnpm exec tsx eval/runs/2026-10-09-561/step-picks.ts <out.json>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  answerSetFromOrder,
  RERANK_POOL,
  rerankOptionsFor,
  rerankReadings,
} from "../../../src/lib/answer/rerank";
import { DATASET_PATH, parseDataset } from "../../../src/lib/eval/dataset";
import { rewriteCase, rewritesFromEnv } from "../../../src/lib/eval/rewrites";
import { createEmbedder } from "../../../src/lib/ingestion/embedder";
import { retrieve, type RetrievedChunk } from "../../../src/lib/retrieval";

const ROOT = path.resolve(__dirname, "..", "..", "..");

function loadDotEnvLocal(): void {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/**
 * #554's table rows that #561 names, by the start of their requirement:
 * `carriers.json` is not in the table's order (rows 2/3 and 23/25 swap).
 */
const ROWS: Record<number, string> = {
  1: "En cobro, la Administración",
  3: "Dónde se hace la afiliación",
  4: "Mientras la persona siga inscrita",
  6: "Omitir la declaración de inscripción",
  7: "Los dos trámites que siguen",
  9: "La cuota se paga mensualmente",
  11: "Con qué emitir",
  12: "Los comprobantes electrónicos y sus documentos",
  18: "La declaración anual se presenta en TRIBU-CR",
  23: "Quien tiene actividad lucrativa debe además",
  24: "Los pagos parciales: cuándo",
  25: "La declaración anual y el pago vencen",
  27: "Omitir una declaración dentro del plazo",
};

interface Carrier {
  chunkId: string;
  docKey: string;
  articulo: string | null;
}

interface Tagged {
  case: string;
  requirement: string;
  parts: { what: string; carriers: Carrier[] }[];
}

function label(chunk: RetrievedChunk): string {
  return `${chunk.docKey}·${(chunk.articulo ?? "*").slice(0, 48)}·#${chunk.part}`;
}

function rank(i: number): string {
  return i === -1 ? "—" : String(i + 1);
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const out = process.argv[2];
  if (!out) throw new Error("usage: step-picks.ts <out.json>");
  const { requirements } = JSON.parse(
    readFileSync(
      path.join(__dirname, "../2026-10-08-554/carriers.json"),
      "utf8",
    ),
  ) as { requirements: Tagged[] };
  const rows = Object.entries(ROWS).map(([n, start]) => {
    const tag = requirements.find((r) => r.requirement.startsWith(start));
    if (!tag) throw new Error(`no requirement starts «${start}»`);
    return { n: Number(n), tag };
  });
  const ids = [...new Set(rows.map(({ tag }) => tag.case))];
  const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const rewrites = rewritesFromEnv();
  const embedder = createEmbedder();
  const reads: unknown[] = [];

  for (const id of ids) {
    const evalCase = cases.find((c) => c.id === id);
    if (!evalCase) throw new Error(`no such case: ${id}`);
    const { query, expander } = await rewriteCase(evalCase, rewrites);
    const retrieval = await retrieve(query, {
      matchCount: RERANK_POOL,
      embedder,
      expander,
    });
    const pool = retrieval.chunks;
    // Voyage's verdict per query text: the reading's own order, best first.
    const verdicts = new Map<string, { index: number; score: number }[]>();
    const capture: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (!res.ok) return res;
      const body = JSON.parse(String(init?.body)) as { query: string };
      const json = (await res.clone().json()) as {
        data: { index: number; relevance_score: number }[];
      };
      // Best first by score, as `rerankReadings` picks.
      verdicts.set(
        body.query,
        json.data
          .map((d) => ({ index: d.index, score: d.relevance_score }))
          .sort((a, b) => b.score - a.score),
      );
      return res;
    };
    const outcome = await rerankReadings(query, pool, {
      ...rerankOptionsFor(retrieval),
      fetchImpl: capture,
    });
    const order = outcome?.order ?? [];
    const set = answerSetFromOrder(
      outcome?.order ?? null,
      pool,
      outcome?.stepPicks ?? [],
    );
    const cut = set.slice(0, 8).map((c) => c.chunkId);
    const appended = set.slice(8).map(label);
    const sentences = retrieval.steps?.sentences ?? [];
    const qRank = (chunkId: string) =>
      order.findIndex((e) => e.chunk.chunkId === chunkId);
    const sentenceRank = (s: string, chunkId: string) => {
      const v = verdicts.get(s) ?? [];
      return v.findIndex((e) => pool[e.index]?.chunkId === chunkId);
    };

    console.log(`\n=== ${id} [${retrieval.steps?.family ?? "no family"}]`);
    console.log(`query: ${query}`);
    console.log(`expansion: ${retrieval.expansion ?? "—"}`);
    console.log(
      `readings: ${verdicts.size} back; pin1 appends: ${appended.join(" ; ") || "nothing"}`,
    );
    sentences.forEach((s, i) => {
      const best = (verdicts.get(s) ?? [])[0];
      const chunk = best === undefined ? undefined : pool[best.index];
      if (!chunk) {
        console.log(`  s${i + 1}: no reading`);
        return;
      }
      const inCut = cut.includes(chunk.chunkId) ? "in cut" : "fresh";
      console.log(
        `  s${i + 1}: pick ${label(chunk)} (${best.score.toFixed(3)}; q-rank ${rank(qRank(chunk.chunkId))}; ${inCut})`,
      );
    });
    for (const { n, tag } of rows.filter(({ tag }) => tag.case === id)) {
      for (const part of tag.parts) {
        for (const c of part.carriers) {
          const fused = pool.findIndex((p) => p.chunkId === c.chunkId);
          const perSentence = sentences
            .map((s, i) => `s${i + 1}:${rank(sentenceRank(s, c.chunkId))}`)
            .join(" ");
          const inSet = set.some((p) => p.chunkId === c.chunkId) ? "✓" : "✗";
          console.log(
            `  row ${n} ${c.docKey}·${(c.articulo ?? "*").slice(0, 40)} ` +
              `fused ${rank(fused)} q-rank ${rank(qRank(c.chunkId))} ${perSentence} set ${inSet}`,
          );
        }
      }
    }
    reads.push({
      id,
      query,
      expansion: retrieval.expansion,
      family: retrieval.steps?.family ?? null,
      pool: pool.map(label),
      order: order.map((e) => label(e.chunk)),
      set: set.map(label),
      sentences: sentences.map((s) => ({
        sentence: s,
        order: (verdicts.get(s) ?? []).map((e) => ({
          chunk: pool[e.index] ? label(pool[e.index]) : null,
          score: e.score,
        })),
      })),
    });
  }
  writeFileSync(out, JSON.stringify({ reads }, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
