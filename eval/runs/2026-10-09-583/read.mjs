// Free read for #583: where #554's leftover Tier 1 carriers stand after
// Wave E. Part 1: each carrier of #554's table in Wave E's lane answer set,
// and whether the lane stated the requirement. Part 2: in #562's probe
// (production configuration), the two step picks pin1 appended to each
// classified Tier 1 case, and each leftover carrier's fused and question
// rank (`*` = in the set). No provider, no database.
// Usage: node eval/runs/2026-10-09-583/read.mjs (from the repo root).
import fs from "node:fs";

const LANE = "eval/runs/2026-10-09-497-wave-e/lane";
const PROBE = "eval/runs/2026-10-09-562/probe-after.json";
const CONFIG = "top8/capoff/pinon";

const laneFile = fs
  .readdirSync(LANE)
  .find((f) => f.startsWith("groundedness-"));
const rows = new Map(
  fs
    .readFileSync(`${LANE}/${laneFile}`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r) => [r.id, r]),
);
const { requirements } = JSON.parse(
  fs.readFileSync("eval/runs/2026-10-08-554/carriers.json", "utf8"),
);

console.log("## Wave E lane: #554's carriers in the set, requirement stated");
for (const t of requirements) {
  const r = rows.get(t.case);
  const ids = new Set(r.chunks.map((c) => c.chunkId));
  const ad = r.adequacy ?? {};
  const missed =
    (ad.missing ?? []).includes(t.requirement) ||
    (ad.literals ?? []).some((l) => l.startsWith(t.requirement));
  const parts = t.parts
    .map((p) =>
      p.carriers
        .map(
          (c) =>
            `${c.docKey} ${c.articulo ?? "-"}: ${ids.has(c.chunkId) ? "IN" : "out"}`,
        )
        .join(" / "),
    )
    .join(" || ");
  console.log(
    `${missed ? "MISSED" : "stated"} ${t.case} «${t.requirement.slice(0, 48)}…» | ${parts}`,
  );
}

const WATCH = {
  "RUT·31": "tribu-cr-faq·Declaraciones del RUT · 31·",
  "RUT·43": "tribu-cr-faq·Declaraciones del RUT · 43·",
  cnpt78: "cnpt·Artículo 78·",
  cnpt79: "cnpt·Artículo 79·",
  cnpt88: "cnpt·Artículo 88·",
  res2: "tribu-cr-res-0011-2025·Artículo 2·",
  rr12: "reglamento-renta·Artículo 12·",
  rr28: "reglamento-renta·Artículo 28·",
  lr22: "ley-renta·ARTICULO 22·",
  riva67: "reglamento-iva·Artículo 67·",
  rti7: "ccss-reglamento-ti·Artículo 7·",
};
const rank = (list, pre) => list.findIndex((c) => c.startsWith(pre)) + 1;

console.log("\n## #562 probe: appended step picks, leftover carriers' ranks");
for (const r of JSON.parse(fs.readFileSync(PROBE, "utf8")).reads) {
  if (r.tier !== 1 || !r.steps) continue;
  const p = r.per[CONFIG];
  const cut = r.order.slice(0, 8);
  const appended = p.set.filter(
    (c) => !cut.includes(c) && !p.pinned.includes(c),
  );
  const ranks = Object.entries(WATCH)
    .filter(([, pre]) => rank(r.pool, pre) > 0)
    .map(
      ([k, pre]) =>
        `${k} f${rank(r.pool, pre)}/q${rank(r.order, pre)}${rank(p.set, pre) ? "*" : ""}`,
    );
  console.log(
    `${r.id} ${r.steps} appended [${appended.map((c) => c.split("·").slice(0, 2).join("·")).join(", ")}] | ${ranks.join(" ")}`,
  );
}
