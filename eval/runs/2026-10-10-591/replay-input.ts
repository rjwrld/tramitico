// Free: the replay input for #591's paid step. Each row is answered on a set
// the full probe recorded (`probe.json`, live, 2026-10-10, on the 873-chunk
// corpus), so the chunks are fixed: the route's set with the pin
// (`top8/capoff/pinon`), and for the two bienes-de-capital cases also the
// same order with it off (`…/sboff`), the control. Chunk text is read
// verbatim from the local stack by label; every appended chunk keeps the pin
// the probe recorded for it.
//
// The rest of each row (question, tier, the recorded answer and verdicts) is
// Wave E's lane row for the case, which `answer-replay` prints as
// «recorded». Those answers were written on Wave E's sets, not these, so the
// comparison that counts is pin-on against `/sboff` on the same cut. The
// abstention case has no groundedness row in Wave E. Its row is built from
// the dataset case and its Wave E abstention answer.
//
//   pnpm exec tsx eval/runs/2026-10-10-591/replay-input.ts > eval/runs/2026-10-10-591/replay-input.jsonl
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ON = "top8/capoff/pinon";
const OFF = `${ON}/sboff`;
/** In the order the rows are written; `true` adds the `/sboff` control. */
const ROWS: [string, boolean][] = [
  ["iva-ajuste-bien-de-capital", true],
  ["ho-t2-compu-cara-iva", true],
  // `reglamento-renta` 30 #1, the cooperatives' tramos, beside a tramos question.
  ["renta-tramos-2026", false],
  // `reglamento-renta` 30 #0, #1, #2.
  ["ho-t2-retencion-tarjetas", false],
  // `reglamento-renta` 30 #0.
  ["renta-pagos-parciales-retenciones", false],
  // `ley-renta` 31 ter beside «el mínimo exento».
  ["ho-minimo-renta-2026", false],
  // `ley-iva` 8's alquiler exemption beside the export one.
  ["iva-clientes-fuera-cr", false],
  ["abs-patente-comercial", false],
];

const here = (...p: string[]) => path.resolve(__dirname, ...p);
const LANE = here(
  "../2026-10-09-497-wave-e/lane/groundedness-claude-sonnet-5-5-effort-low-20261009T031939Z.jsonl",
);
const ABSTENTION = here(
  "../2026-10-09-497-wave-e/lane/abstention-2026-10-09T02-54-05-439Z.jsonl",
);

const env = here("../../../.env.local");
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const jsonl = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));

interface Read {
  id: string;
  query: string;
  per: Record<string, { set: string[]; pins?: Record<string, string> }>;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
    throw new Error("SUPABASE_URL is not the local stack; refusing");
  }
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await client
    .from("chunks")
    .select("id, articulo, part, content, documents!inner(doc_key)")
    .limit(5000);
  if (error) throw error;
  const byLabel = new Map(
    (
      data as unknown as {
        id: string;
        articulo: string | null;
        part: number;
        content: string;
        documents: { doc_key: string };
      }[]
    ).map((row) => [
      `${row.documents.doc_key}·${row.articulo ?? "*"}·#${row.part}`,
      row,
    ]),
  );

  const { reads } = JSON.parse(readFileSync(here("probe.json"), "utf8")) as {
    reads: Read[];
  };
  const lane = jsonl(LANE);
  const abstention = jsonl(ABSTENTION);
  const dataset = jsonl(here("../../dataset.jsonl"));

  const chunksOf = (read: Read, config: string) => {
    const { set, pins = {} } = read.per[config];
    return set.map((label, i) => {
      const row = byLabel.get(label);
      if (row === undefined) throw new Error(`not in the corpus: ${label}`);
      return {
        marker: i + 1,
        chunkId: row.id,
        docKey: row.documents.doc_key,
        articulo: row.articulo,
        content: row.content,
        ...(pins[label] === undefined ? {} : { pin: pins[label] }),
      };
    });
  };

  const baseRow = (id: string, query: string) => {
    const recorded = lane.find((r) => r.id === id);
    if (recorded !== undefined) return { ...recorded, query };
    const evalCase = dataset.find((c) => c.id === id);
    const declined = abstention.find((r) => r.id === id);
    if (evalCase === undefined || declined === undefined) {
      throw new Error(`${id}: no Wave E row`);
    }
    return {
      id,
      tier: evalCase.tier,
      family: evalCase.family ?? null,
      variant: evalCase.variant ?? null,
      seed: evalCase.seed,
      heldOut: evalCase.heldOut ?? false,
      question: evalCase.question,
      query,
      answer: declined.answer,
      derivedFigures: [],
      groundedness: {
        verdict: declined.verdict,
        verdicts: declined.verdicts,
        reason: declined.reason,
        label: null,
      },
      citations: null,
      adequacy: null,
      generation: declined.generation,
      rerank: declined.rerank,
      checks: declined.checks,
      reasks: [],
    };
  };

  for (const [id, control] of ROWS) {
    const read = reads.find((r) => r.id === id);
    if (read === undefined) throw new Error(`${id}: not in probe.json`);
    const row = baseRow(id, read.query);
    const on = chunksOf(read, ON);
    if (!on.some((chunk) => chunk.pin === "salarioBase")) {
      throw new Error(`${id}: the pin-on set holds no salario base`);
    }
    console.log(JSON.stringify({ ...row, chunks: on }));
    if (control) {
      const off = chunksOf(read, OFF);
      if (off.some((chunk) => chunk.docKey.startsWith("salario-base"))) {
        throw new Error(`${id}: the control holds the salario base`);
      }
      console.log(JSON.stringify({ ...row, chunks: off }));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
