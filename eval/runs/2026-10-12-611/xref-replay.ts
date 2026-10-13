// Free: what #508's cross-reference pin read on one groundedness row, replayed
// offline (#611 step 0, `ho-t2-credito-iva-compras`). The row's cut is its
// first `cut` chunks: the reranked eight plus the two step picks, before the
// appends. `crossReferencedChunks` ranks the cut's references and hands them to
// the lookup; a stub lookup prints that ranking and returns nothing, so no
// database and no provider is asked.
//
//   pnpm exec tsx eval/runs/2026-10-12-611/xref-replay.ts <case> <cut> <groundedness.jsonl>…
import { readFileSync } from "node:fs";
import { crossReferencedChunks } from "../../../src/lib/answer/cross-references";
import type { RetrievedChunk } from "../../../src/lib/retrieval";

interface Row {
  id: string;
  chunks: Pick<RetrievedChunk, "chunkId" | "docKey" | "articulo" | "content">[];
}

async function main(): Promise<void> {
  const [id, cut, ...files] = process.argv.slice(2);
  for (const file of files) {
    const row = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Row)
      .find((r) => r.id === id);
    if (row === undefined) throw new Error(`${id} is not in ${file}`);
    // A transcript row keeps no part; every chunk here is an artículo's first.
    const set = row.chunks
      .slice(0, Number(cut))
      .map((chunk) => ({ ...chunk, part: 0 }) as RetrievedChunk);
    console.log(`\n${file}`);
    console.log(
      `  cut: ${set.map((c) => `${c.docKey} ${c.articulo}`).join(" | ")}`,
    );
    console.log(
      `  appended after the cut: ${row.chunks
        .slice(Number(cut))
        .map((c) => `${c.docKey} ${c.articulo}`)
        .join(" | ")}`,
    );
    await crossReferencedChunks(set, {
      lookup: async (references) => {
        references.forEach((r, i) =>
          console.log(
            `  ${String(i + 1).padStart(2)}. ${r.docKey} ${r.articulo}${r.figure ? " (defers a figure)" : ""}`,
          ),
        );
        return [];
      },
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
