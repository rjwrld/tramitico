// Free: no provider, no database. Diffs two lanes' groundedness transcripts
// (#497's confirming lane): the Tier 1 requirements each lane missed and the
// other stated, outside the robustness block, with the chunks only one of
// the two answer sets holds; then the answer-set overlap over all rows.
//
//   node eval/runs/2026-10-12-497-confirm/read.mjs <before.jsonl> <after.jsonl>
import { readFileSync } from "node:fs";

const [before, after] = process.argv.slice(2);
if (!before || !after) {
  console.error("usage: read.mjs <before.jsonl> <after.jsonl>");
  process.exit(2);
}

const rows = (file) =>
  new Map(
    readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((row) => [row.id, row]),
  );
const dataset = readFileSync("eval/dataset.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// The claim of a failed literal, keyed as scripts/tier1-miss-causes.ts keys it.
const requirement = (miss) =>
  miss.replace(/ \([^()]*: (?:absent|present but uncited)\)$/, "");
const missed = (row) =>
  new Set(
    row.adequacy === null
      ? []
      : [...row.adequacy.missing, ...row.adequacy.literals].map(requirement),
  );
const label = (c) => `${c.docKey} · ${c.articulo} (${c.chunkId.slice(0, 8)})`;

const one = rows(before);
const two = rows(after);
let lost = 0;
let gained = 0;
for (const evalCase of dataset) {
  if (evalCase.tier !== 1 || evalCase.variant === "robustez") continue;
  const a = one.get(evalCase.id);
  const b = two.get(evalCase.id);
  const missA = missed(a);
  const missB = missed(b);
  const lostHere = [...missB].filter((m) => !missA.has(m));
  const gainedHere = [...missA].filter((m) => !missB.has(m));
  if (lostHere.length === 0 && gainedHere.length === 0) continue;
  lost += lostHere.length;
  gained += gainedHere.length;
  console.log(`\n${evalCase.id}`);
  for (const m of lostHere) console.log(`  LOST    ${m}`);
  for (const m of gainedHere) console.log(`  GAINED  ${m}`);
  const idsA = new Set(a.chunks.map((c) => c.chunkId));
  const idsB = new Set(b.chunks.map((c) => c.chunkId));
  for (const c of a.chunks.filter((c) => !idsB.has(c.chunkId)))
    console.log(`    only before  ${label(c)}`);
  for (const c of b.chunks.filter((c) => !idsA.has(c.chunkId)))
    console.log(`    only after   ${label(c)}`);
}
console.log(`\ntier 1 requirements: ${lost} lost, ${gained} gained`);

const overlaps = [...two.keys()].map((id) => {
  const a = new Set(one.get(id).chunks.map((c) => c.chunkId));
  const b = new Set(two.get(id).chunks.map((c) => c.chunkId));
  const both = [...a].filter((x) => b.has(x)).length;
  return { id, jaccard: both / new Set([...a, ...b]).size };
});
overlaps.sort((x, y) => x.jaccard - y.jaccard);
const median = overlaps[Math.floor(overlaps.length / 2)].jaccard;
console.log(
  `answer-set overlap (Jaccard), ${overlaps.length} rows: median ${median.toFixed(2)}; lowest ${overlaps
    .slice(0, 3)
    .map((o) => `${o.id} ${o.jaccard.toFixed(2)}`)
    .join(", ")}`,
);
