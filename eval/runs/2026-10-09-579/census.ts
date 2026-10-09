// Free: every local-corpus chunk #579's detector reads as a sanción in
// salarios base. Usage: pnpm exec tsx eval/runs/2026-10-09-579/census.ts

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { statesSanctionInSalariosBase } from "../../../src/lib/answer/salario-base";
const f = path.resolve(__dirname, "../../../.env.local");
if (existsSync(f))
  for (const l of readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
const url = process.env.SUPABASE_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url))
  throw new Error("not local");
(async () => {
  const c = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await c
    .from("chunks")
    .select("articulo, part, content, documents!inner(doc_key)")
    .limit(5000);
  if (error) throw error;
  const rows = data as unknown as {
    articulo: string;
    part: number;
    content: string;
    documents: { doc_key: string };
  }[];
  console.log(rows.length, "chunks");
  for (const r of rows)
    if (statesSanctionInSalariosBase(r))
      console.log(`${r.documents.doc_key} · ${r.articulo} #${r.part}`);
})();
