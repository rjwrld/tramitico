// #602: where each carrier sat in probe.json — fused pool, reranked order,
// answer set under the route's configuration. Free; reads the committed file.
//   node eval/runs/2026-10-10-602/read.mjs
import { readFileSync } from "node:fs";

const ROUTE = "top8/capoff/pinon";
const file = new URL("probe.json", import.meta.url);
const { reads } = JSON.parse(readFileSync(file, "utf8"));

// The channel documents, plus the FAQ entry that names TRIBU-CR beside the
// desinscripción steps.
const CARRIER =
  /^(tribu-cr-res-00(11|20|33)-2025·|tribu-cr-faq·Declaraciones del RUT · 31·)/;

for (const r of reads) {
  const set = r.per[ROUTE];
  console.log(
    `\n${r.id} (pool ${r.poolIds.length}, set ${set.chunkIds.length})`,
  );
  const rows = r.pool
    .map((label, i) => ({ label, id: r.poolIds[i], pool: i + 1 }))
    .filter((c) => CARRIER.test(c.label));
  if (rows.length === 0) console.log("  no carrier in the fused pool");
  for (const c of rows) {
    const order = r.orderIds.indexOf(c.id) + 1;
    const inSet = set.chunkIds.indexOf(c.id) + 1;
    console.log(
      `  ${c.id.slice(0, 8)}  ${c.label.padEnd(50)} pool#${c.pool}  order#${order || "—"}  set#${inSet || "—"}`,
    );
  }
}
