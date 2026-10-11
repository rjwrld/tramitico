// Free: every local-corpus chunk that says «salario(s) base», and which of
// the two readings fires on it — #579's sanción, #591's amount (the pin's
// trigger since #591). Read-only, service role, local stack only.
//
//   pnpm exec tsx eval/runs/2026-10-10-591/census.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  statesAmountInSalariosBase,
  statesSanctionInSalariosBase,
} from "../../../src/lib/answer/salario-base";
import { fold } from "../../../src/lib/articulo-key";

const file = path.resolve(__dirname, "../../../.env.local");
if (existsSync(file))
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
const url = process.env.SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url))
  throw new Error("SUPABASE_URL is not the local stack; refusing");

(async () => {
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await client
    .from("chunks")
    .select("id, articulo, part, content, documents!inner(doc_key)")
    .limit(5000);
  if (error) throw error;
  const rows = (
    data as unknown as {
      id: string;
      articulo: string | null;
      part: number;
      content: string;
      documents: { doc_key: string };
    }[]
  ).sort((a, b) =>
    `${a.documents.doc_key} ${a.articulo} ${a.part}`.localeCompare(
      `${b.documents.doc_key} ${b.articulo} ${b.part}`,
    ),
  );
  const mentions = rows.filter((r) => /salarios? base/.test(fold(r.content)));
  let sanction = 0;
  let amount = 0;
  console.log(
    `${rows.length} chunks; ${mentions.length} say «salario(s) base»`,
  );
  console.log("#579 sanción | #591 amount | chunk");
  for (const r of mentions) {
    const s = statesSanctionInSalariosBase(r);
    const a = statesAmountInSalariosBase(r);
    if (s) sanction += 1;
    if (a) amount += 1;
    if (s && !a) console.log("  (a sanción the amount reading misses)");
    console.log(
      `${s ? "yes" : " - "}          | ${a ? "yes" : " - "}         | ${r.documents.doc_key} · ${r.articulo ?? "*"} #${r.part} (${r.id})`,
    );
  }
  console.log(`fires: #579 ${sanction}, #591 ${amount}`);
})();
