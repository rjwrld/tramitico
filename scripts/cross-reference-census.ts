/**
 * Cross-reference census (#508): every reference `crossReferences` reads in
 * the corpus, and whether the corpus holds the artículo it names. Free — one
 * read of `chunks` joined to `documents`, no provider call. Run it after a
 * change to the patterns or to the corpus, and read the `✗` lines and a
 * sample of the `✓` ones: a `✗` is a reference to an artículo the corpus did
 * not ingest (harmless, the lookup finds nothing), a wrong `✓` is a chunk the
 * pin would append for nothing.
 *
 *   pnpm cross-reference-census [--all]
 *
 * Prints the totals, then the `✗` lines; `--all` prints every reference.
 * Reads `.env.local` like `ingest.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  articuloKey,
  crossReferences,
} from "../src/lib/answer/cross-references";
import type { Database } from "../src/lib/database.types";

/** `.env.local`, the way `ingest.ts` loads it — never over an exported value. */
function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

interface Row {
  articulo: string | null;
  part: number;
  content: string;
  documents: { doc_key: string };
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const db = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("chunks")
      .select("articulo, part, content, documents!inner(doc_key)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  const held = new Set(
    rows.map((r) => `${r.documents.doc_key}\u0000${articuloKey(r.articulo)}`),
  );
  const all = process.argv.includes("--all");
  let naming = 0;
  let references = 0;
  let resolvable = 0;
  const lines: string[] = [];
  for (const row of rows) {
    const found = crossReferences({
      docKey: row.documents.doc_key,
      articulo: row.articulo,
      content: row.content,
    });
    if (found.length > 0) naming += 1;
    for (const reference of found) {
      references += 1;
      const ok = held.has(`${reference.docKey}\u0000${reference.articulo}`);
      if (ok) resolvable += 1;
      if (ok && !all) continue;
      lines.push(
        `${ok ? "✓" : "✗"} ${row.documents.doc_key}·${row.articulo}#${row.part} → ${reference.docKey}·${reference.articulo}`,
      );
    }
  }
  console.log(
    `chunks ${rows.length}, naming an artículo ${naming}, references ${references}, held by the corpus ${resolvable}`,
  );
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
