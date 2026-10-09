// Free check of #579's pin on the saved probe sets (#561, #562): for every
// case, the route's set as the probe recorded it, re-pinned by today's
// `pinAnswerSet` against the local stack — the cut is the saved set minus
// its recorded appends, the pool the saved pool. Prints every case whose set
// holds a sanción in salarios base, what the pin adds, and any chunk a case
// had that the re-pinned set lacks (there must be none). No provider call:
// the lookup is one read of the local database.
//
//   pnpm exec tsx eval/runs/2026-10-09-579/offline-check.ts <probe.json>…
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { pinAnswerSet, type PinName } from "../../../src/lib/answer/pins";
import { statesSanctionInSalariosBase } from "../../../src/lib/answer/salario-base";
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

  for (const file of process.argv.slice(2)) {
    const { reads } = JSON.parse(readFileSync(file, "utf8")) as {
      reads: {
        id: string;
        query: string;
        pool: string[];
        per: Record<string, { set: string[]; pinned: string[] }>;
      }[];
    };
    let grown = 0;
    let losses = 0;
    console.log(`\n${file}: ${reads.length} cases`);
    for (const read of reads) {
      const saved = read.per[CONFIG];
      if (saved === undefined || saved.set.length === 0) continue;
      const pinnedBefore = new Set(saved.pinned);
      const cut = resolve(saved.set.filter((l) => !pinnedBefore.has(l)));
      const pins = new Map<string, PinName>();
      const after = await pinAnswerSet(cut, resolve(read.pool), read.query, {
        onPins: (told) => {
          for (const [id, pin] of told) pins.set(id, pin);
        },
      });
      const label = (c: RetrievedChunk) =>
        `${c.docKey}·${c.articulo ?? "*"}·#${c.part}`;
      const afterLabels = after.map(label);
      const lost = saved.set.filter((l) => !afterLabels.includes(l));
      const added = after.filter((c) => !saved.set.includes(label(c)));
      losses += lost.length;
      const sanctions = cut.filter(statesSanctionInSalariosBase).map(label);
      if (sanctions.length === 0 && added.length === 0 && lost.length === 0) {
        continue;
      }
      const hasBase = afterLabels.some((l) => l.startsWith("salario-base"));
      if (added.length > 0) grown += 1;
      console.log(
        `  ${read.id}: sanción ${sanctions.join(", ") || "—"}; ` +
          `salario base ${saved.set.some((l) => l.startsWith("salario-base")) ? "already in" : hasBase ? "ADDED" : "absent"}` +
          (added.length > 0
            ? `; +${added.map((c) => `${label(c)} (${pins.get(c.chunkId)})`).join(", ")}`
            : "") +
          (lost.length > 0 ? `; LOST ${lost.join(", ")}` : ""),
      );
    }
    console.log(`  sets grown: ${grown}; chunks lost: ${losses}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
