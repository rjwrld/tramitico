// The offline table of this run's README (#510): each fallback order's top 8
// over the pools in `pools-legs.json`, no cap and no derived-figure pin.
// Free: `node eval/runs/2026-10-07-510/offline-reads.mjs eval/runs/2026-10-07-510/pools-legs.json`
import { readFileSync } from "node:fs";

const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
/** One leg's RRF share at `rank`, 0 when the leg missed the chunk. */
const share = (rank) => (rank == null ? 0 : 1 / (60 + rank));

const orders = {
  fused: (c) => c.score,
  stepShareOut: (c) => c.score - share(c.sv) - share(c.sl),
  stepVectorOut: (c) => c.score - share(c.sv),
  // The lexical legs' residual, read as one coverage common to all three.
  apportioned: (c) => {
    const lexical = share(c.l) + share(c.xl) + share(c.sl);
    const residual = c.score - share(c.v) - share(c.xv) - share(c.sv);
    const coverage = lexical > 0 ? residual / lexical : 0;
    return c.score - share(c.sv) - coverage * share(c.sl);
  },
  plainRrf: (c) => share(c.v) + share(c.l) + share(c.xv) + share(c.xl),
};

for (const [name, key] of Object.entries(orders)) {
  let targets = 0;
  let expected = 0;
  let tier1 = 0;
  let tier1Expected = 0;
  let hit = 0;
  let read = 0;
  for (const c of cases) {
    if (c.variant === "robustez") continue;
    read += 1;
    expected += c.expected.length;
    if (c.tier === 1) tier1Expected += c.expected.length;
    if (c.weak) continue;
    const top = c.pool
      .map((chunk, i) => ({ chunk, i, k: key(chunk) }))
      .sort((a, b) => b.k - a.k || a.i - b.i)
      .slice(0, 8)
      .map(({ chunk }) => chunk);
    const present = c.expected.filter((_, j) =>
      top.some((chunk) => chunk.hits[j]),
    ).length;
    targets += present;
    if (c.tier === 1) tier1 += present;
    if (present > 0) hit += 1;
  }
  console.log(
    `${name.padEnd(14)} targets ${targets}/${expected}  tier1 ${tier1}/${tier1Expected}  cases hit ${hit}/${read}`,
  );
}
