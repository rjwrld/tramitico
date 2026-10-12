// Free check of #599's narrower trigger on the saved probe sets: a copy of
// eval/runs/2026-10-10-591/offline-check.ts. For every case, the route's set
// as the probe recorded it, re-pinned by today's `pinAnswerSet` against the
// local stack — the cut is the saved set minus its recorded appends, the pool
// the saved pool. Prints every case whose cut #591's reading
// (`statesAmountInSalariosBase`) fires on, whether #599's
// (`triggersSalarioBase`) still does, whether the circular is in the set
// before and after (and which pin brought it: the CNPT multas' derived
// figures bring it as a derived input, #287), and any
// non-salario-base chunk a case had that the re-pinned set lacks. No
// provider call: the lookup is one read of the local database.
//
//   pnpm exec tsx eval/runs/2026-10-10-599/offline-check.ts <probe.json>…
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { pinAnswerSet, type PinName } from "../../../src/lib/answer/pins";
import {
  statesAmountInSalariosBase,
  triggersSalarioBase,
} from "../../../src/lib/answer/salario-base";
import type { RetrievedChunk } from "../../../src/lib/retrieval";

const CONFIG = "top8/capoff/pinon";

function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "../../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

interface Row {
  id: string;
  articulo: string | null;
  path: string[] | null;
  part: number;
  content: string;
  documents: {
    doc_key: string;
    title: string;
    norma: string | null;
    effective_date: string | null;
  };
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const url = process.env.SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error("SUPABASE_URL is not the local stack; refusing");
  }
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await client
    .from("chunks")
    .select(
      "id, articulo, path, part, content, documents!inner(doc_key, title, norma, effective_date)",
    )
    .limit(5000);
  if (error) throw error;
  const byLabel = new Map<string, RetrievedChunk>();
  for (const row of data as unknown as Row[]) {
    const chunk: RetrievedChunk = {
      chunkId: row.id,
      docKey: row.documents.doc_key,
      docTitle: row.documents.title,
      norma: row.documents.norma,
      articulo: row.articulo,
      path: row.path ?? [],
      part: row.part,
      content: row.content,
      source: {},
      effectiveAt: row.documents.effective_date,
      fetchedAt: null,
      score: 0,
      vectorRank: null,
      lexicalRank: null,
    };
    byLabel.set(
      `${chunk.docKey}·${chunk.articulo ?? "*"}·#${chunk.part}`,
      chunk,
    );
  }
  const resolve = (labels: readonly string[]) =>
    labels.map((label) => {
      const chunk = byLabel.get(label);
      if (chunk === undefined) throw new Error(`not in the corpus: ${label}`);
      return chunk;
    });
  const label = (c: RetrievedChunk) =>
    `${c.docKey}·${c.articulo ?? "*"}·#${c.part}`;
  const isBase = (l: string) => l.startsWith("salario-base");

  for (const file of process.argv.slice(2)) {
    const { reads } = JSON.parse(readFileSync(file, "utf8")) as {
      reads: {
        id: string;
        query: string;
        pool: string[];
        per: Record<string, { set: string[]; pinned: string[] }>;
      }[];
    };
    const tally = {
      wide: 0,
      kept: 0,
      appendedBefore: 0,
      appendedNow: 0,
      bySalarioBase: 0,
    };
    let otherLosses = 0;
    console.log(`\n${path.basename(file)}: ${reads.length} cases`);
    console.log("case: #591 → #599; triggering chunks; circular before → now");
    for (const read of reads) {
      const saved = read.per[CONFIG];
      if (saved === undefined || saved.set.length === 0) continue;
      const pinnedBefore = new Set(saved.pinned);
      const cut = resolve(saved.set.filter((l) => !pinnedBefore.has(l)));
      const amounts = cut.filter(statesAmountInSalariosBase).map(label);
      if (amounts.length === 0) continue;
      const triggers = cut.filter(triggersSalarioBase).map(label);
      const pins = new Map<string, PinName>();
      const after = await pinAnswerSet(cut, resolve(read.pool), read.query, {
        onPins: (told) => {
          for (const [id, pin] of told) pins.set(id, pin);
        },
      });
      const afterLabels = after.map(label);
      const lost = saved.set.filter((l) => !afterLabels.includes(l));
      otherLosses += lost.filter((l) => !isBase(l)).length;
      const inCut = cut.some((c) => isBase(label(c)));
      const savedBase = saved.set.find(isBase);
      const before = inCut
        ? "in cut"
        : savedBase !== undefined
          ? "appended"
          : "absent";
      const afterBase = after.find((c) => isBase(label(c)));
      const now = inCut
        ? "in cut"
        : afterBase !== undefined
          ? `appended (${pins.get(afterBase.chunkId)})`
          : "absent";
      tally.wide += 1;
      if (triggers.length > 0) tally.kept += 1;
      if (before === "appended") tally.appendedBefore += 1;
      if (now.startsWith("appended")) tally.appendedNow += 1;
      if (now === "appended (salarioBase)") tally.bySalarioBase += 1;
      console.log(
        `  ${read.id}: ${triggers.length > 0 ? "KEPT" : "DROPPED"}; ` +
          `${triggers.length > 0 ? triggers.join(", ") : `(#591 only: ${amounts.join(", ")})`}; ` +
          `circular ${before} → ${now}` +
          (lost.length > 0 ? `; LOST ${lost.join(", ")}` : ""),
      );
    }
    console.log(
      `  cases #591 fires on: ${tally.wide}; #599 still fires on ${tally.kept}; ` +
        `sets holding the circular past the cut ${tally.appendedBefore} → ${tally.appendedNow} ` +
        `(${tally.bySalarioBase} of them by this pin); ` +
        `chunks lost besides the circular: ${otherLosses}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
