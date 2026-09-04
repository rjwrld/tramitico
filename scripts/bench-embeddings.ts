/**
 * Embedding benchmark for ADR 0003 (issue #19), judged on the Appendix-A
 * questions against the live local corpus. The comparison it was written for
 * (voyage-3 vs OpenAI text-embedding-3-small) is settled and the openai
 * adapter is gone (#209); what stays runnable is every provider the embedder
 * still offers, plus the in-script voyage-3 input_type candidate.
 *
 * Measures the vector leg alone — the lexical leg is identical under either
 * provider, so it would only blur the comparison. Hit = an acceptable target
 * appears in the cosine top-8.
 *
 * Embeddings are cached per provider under the OS temp dir, so re-runs after
 * the first cost nothing.
 *
 * Usage:  pnpm tsx scripts/bench-embeddings.ts [voyage stub voyage-it]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createEmbedder, type Embedder } from "../src/lib/ingestion/embedder";
import { matchesTarget, type Target } from "./target-match";

/**
 * Candidate not in the production embedder yet: voyage-3 with the documented
 * retrieval hint (input_type document/document vs query). If it wins, the
 * hint moves into src/lib/ingestion/embedder.ts as part of ADR 0003.
 */
function voyageWithInputType(inputType: "document" | "query"): Embedder {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY missing");
  const embed = async (texts: string[]): Promise<number[][]> => {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3",
        input: texts,
        input_type: inputType,
      }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings: HTTP ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  };
  return {
    provider: "voyage-it",
    dimensions: 1024,
    embed,
    // The bench embeds in bulk and measures ranking, not the interactive
    // policy (#127) — so this reuses `embed` rather than carrying an abort
    // budget nothing here would exercise.
    embedQuery: async (text) => (await embed([text]))[0],
  };
}

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(os.tmpdir(), "tramitico-bench-embeddings");
const TOP_K = 8;
/** Keyless Voyage runs under 3 req/min + 10K tokens/min — small batches. */
const BATCH_BY_PROVIDER: Record<string, number> = {
  voyage: 12,
  "voyage-it": 12,
};
const DEFAULT_BATCH = 64;

function loadDotEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

interface ChunkRow {
  id: string;
  doc_key: string;
  articulo: string | null;
  part: number;
  content: string;
}

/**
 * Acceptable targets per question — see `Target` in ./target-match, which owns
 * the match rule. Targets are identical for every provider: this ranks
 * providers, it does not grade the corpus.
 */
const QUESTIONS: { q: string; targets: Target[]; canary?: boolean }[] = [
  {
    q: "¿Tengo que inscribirme en Hacienda si facturo a clientes en el extranjero?",
    targets: [
      { docKey: "reglamento-renta" },
      { docKey: "reglamento-titulo-iv-9635" },
      { docKey: "ley-renta", articulo: "ARTICULO 2" },
    ],
  },
  {
    // The vocabulary-gap canary from the chunking prototype (#4) — the reason
    // the vector leg exists at all.
    q: "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?",
    targets: [
      { docKey: "reglamento-iva", articulo: "Artículo 11" },
      { docKey: "ley-iva", articulo: "Artículo 8" },
    ],
    canary: true,
  },
  {
    q: "¿Cuál código CABYS uso para desarrollo de software?",
    targets: [{ docKey: "cabys-dev" }],
  },
  {
    q: "¿Cuánto pago a la CCSS como trabajador independiente y cómo se calcula la base?",
    targets: [{ docKey: "ccss-bmc" }, { docKey: "ley-10363" }],
  },
  {
    q: "¿Me pueden cobrar retroactivo si nunca me inscribí en la CCSS?",
    targets: [{ docKey: "ley-10363" }],
  },
  {
    q: "¿Cómo emito factura electrónica y qué cambió con v4.4 y TRIBU-CR?",
    targets: [{ docKey: "tribu-cr-guia" }],
  },
  {
    q: "¿Qué pasa si dejo de trabajar independiente — desinscripción D-140 y consecuencias?",
    targets: [
      { docKey: "reglamento-renta" },
      { docKey: "reglamento-titulo-iv-9635" },
    ],
  },
  {
    q: "¿Cómo calculo renta como persona física con actividad lucrativa — aplica la deducción automática del 25%?",
    targets: [
      { docKey: "reglamento-renta" },
      { docKey: "reglamento-titulo-iv-9635" },
      { docKey: "ley-renta", articulo: "ARTICULO 8" },
      { docKey: "ley-renta", articulo: "Artículo 15" },
      { docKey: "tramos-renta-2026" },
    ],
  },
  {
    q: "¿Régimen simplificado o tradicional siendo programador?",
    targets: [
      { docKey: "reglamento-rts" },
      { docKey: "reglamento-renta" },
      { docKey: "ley-iva" },
    ],
  },
  {
    q: "¿Con TRIBU-CR, cambió el procedimiento para declarar y pagar? ¿Dónde entro ahora?",
    targets: [{ docKey: "tribu-cr-guia" }],
  },
];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function embedAll(
  provider: string,
  texts: string[],
  cacheKey: string,
  embedderOverride?: Embedder,
): Promise<number[][]> {
  // Incremental cache: one JSON line per vector, appended per batch, so an
  // interrupted run resumes instead of re-spending the rate limit.
  const file = path.join(CACHE, `${provider}-${cacheKey}.jsonl`);
  const vectors: number[][] = [];
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim()) vectors.push(JSON.parse(line) as number[]);
    }
    if (vectors.length >= texts.length) {
      console.log(`  ${provider}/${cacheKey}: cache hit (${vectors.length})`);
      return vectors.slice(0, texts.length);
    }
    console.log(`  ${provider}/${cacheKey}: resuming at ${vectors.length}`);
  }
  mkdirSync(CACHE, { recursive: true });
  const embedder = embedderOverride ?? createEmbedder(provider);
  const BATCH = BATCH_BY_PROVIDER[provider] ?? DEFAULT_BATCH;
  for (let i = vectors.length; i < texts.length; i += BATCH) {
    // Keyless-tier 429s are a pacing signal, not an error — wait them out.
    let batch: number[][] | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        batch = await embedder.embed(texts.slice(i, i + BATCH));
        break;
      } catch (err) {
        if (attempt >= 40 || !String(err).includes("429")) throw err;
        process.stdout.write(`\r  ${provider}/${cacheKey}: 429, waiting…    `);
        await new Promise((r) => setTimeout(r, 22_000));
      }
    }
    vectors.push(...batch);
    appendFileSync(file, batch.map((v) => JSON.stringify(v)).join("\n") + "\n");
    process.stdout.write(
      `\r  ${provider}/${cacheKey}: ${Math.min(i + BATCH, texts.length)}/${texts.length}`,
    );
  }
  process.stdout.write("\n");
  return vectors;
}

async function main() {
  loadDotEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SERVICE_ROLE_KEY missing");
  const providers = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["stub", "voyage"];

  const db = createClient(url, key, { auth: { persistSession: false } });
  const chunks: ChunkRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("chunks")
      .select("id, articulo, part, content, documents(doc_key)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data) {
      chunks.push({
        id: row.id as string,
        doc_key: (row.documents as unknown as { doc_key: string }).doc_key,
        articulo: row.articulo as string | null,
        part: row.part as number,
        content: row.content as string,
      });
    }
    if (data.length < 1000) break;
  }
  console.log(`corpus: ${chunks.length} chunks`);

  const summary: Record<string, { hits: number; canary: boolean }> = {};
  for (const provider of providers) {
    console.log(`\n=== ${provider} ===`);
    const chunkVecs = await embedAll(
      provider,
      chunks.map((c) => c.content),
      "chunks",
      provider === "voyage-it" ? voyageWithInputType("document") : undefined,
    );
    const questionVecs = await embedAll(
      provider,
      QUESTIONS.map((x) => x.q),
      "questions",
      provider === "voyage-it" ? voyageWithInputType("query") : undefined,
    );

    let hits = 0;
    let canaryHit = false;
    for (let qi = 0; qi < QUESTIONS.length; qi++) {
      const { q, targets, canary } = QUESTIONS[qi];
      const ranked = chunks
        .map((c, i) => ({ c, score: cosine(questionVecs[qi], chunkVecs[i]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K);
      const hitIndex = ranked.findIndex((r) => matchesTarget(r.c, targets));
      const hit = hitIndex >= 0;
      if (hit) hits++;
      if (canary && hit) canaryHit = true;
      const top = ranked[0];
      console.log(
        `${hit ? "HIT " : "miss"}${canary ? " [canary]" : ""} @${hit ? hitIndex + 1 : "-"} ` +
          `${q.slice(0, 60)}…\n      top: ${top.c.doc_key} · ${top.c.articulo ?? "—"} (${top.score.toFixed(3)})` +
          (hit && hitIndex > 0
            ? `\n      hit: ${ranked[hitIndex].c.doc_key} · ${ranked[hitIndex].c.articulo ?? "—"}`
            : ""),
      );
    }
    summary[provider] = { hits, canary: canaryHit };
    console.log(
      `${provider}: ${hits}/${QUESTIONS.length} hit@${TOP_K}, canary ${canaryHit ? "PASS" : "FAIL"}`,
    );
  }

  console.log("\n=== summary ===");
  for (const [p, s] of Object.entries(summary)) {
    console.log(
      `${p.padEnd(8)} hit@${TOP_K}: ${s.hits}/${QUESTIONS.length}  canary: ${s.canary ? "PASS" : "FAIL"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
