// Free: every local-corpus chunk that says «salario(s) base», and which
// readings fire on it — #579's sanción, #591's amount, whether the chunk
// names Ley 7337, and #599's trigger (sanción, or amount + Ley 7337). A copy
// of eval/runs/2026-10-10-591/census.ts with the two new columns.
// Read-only, service role, local stack only.
//
//   pnpm exec tsx eval/runs/2026-10-10-599/census.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  namesLey7337,
  statesAmountInSalariosBase,
  statesSanctionInSalariosBase,
  triggersSalarioBase,
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
  const mentions = rows.filter(
    (r) => /salarios? base/.test(fold(r.content)) || /7\.?337/.test(r.content),
  );
  const count = { sanction: 0, amount: 0, ley: 0, trigger: 0 };
  console.log(
    `${rows.length} chunks; ${mentions.length} say «salario(s) base» or 7337`,
  );
  console.log("#579 sanción | #591 amount | Ley 7337 | #599 trigger | chunk");
  const yn = (b: boolean) => (b ? "yes" : " - ");
  for (const r of mentions) {
    const s = statesSanctionInSalariosBase(r);
    const a = statesAmountInSalariosBase(r);
    const l = namesLey7337(r);
    const t = triggersSalarioBase(r);
    if (s) count.sanction += 1;
    if (a) count.amount += 1;
    if (l) count.ley += 1;
    if (t) count.trigger += 1;
    console.log(
      `${yn(s)}          | ${yn(a)}         | ${yn(l)}      | ${yn(t)}          | ${r.documents.doc_key} · ${r.articulo ?? "*"} #${r.part} (${r.id})`,
    );
  }
  console.log(
    `fires: #579 ${count.sanction}, #591 ${count.amount}, #599 ${count.trigger}; names Ley 7337: ${count.ley}`,
  );
})();
