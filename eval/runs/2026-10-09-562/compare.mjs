// Free comparison of #561's probe-after.json (main, STEP_PINS=2) and this
// run's probe-after.json (the same rewrites replayed, #562's catalogue):
// #554's four carriers, what each case's answer set and fused pool gain and
// lose, and every expected target's pool rank that moved.
// Usage: node eval/runs/2026-10-09-562/compare.mjs
import fs from "node:fs";
const CONFIG = "top8/capoff/pinon";
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8")).reads;
const before = new Map(
  read("eval/runs/2026-10-09-561/probe-after.json").map((r) => [r.id, r]),
);
const after = new Map(
  read("eval/runs/2026-10-09-562/probe-after.json").map((r) => [r.id, r]),
);
const CARRIERS = [
  [5, "inscripcion-tardia-sancion", "tribu-cr-faq·Declaraciones del RUT · 2·"],
  [8, "ho-desde-cuanta-plata-caja", "ccss-faq·¿Dónde puedo pagar mi seguro?·"],
  [14, "ho-cliente-espana-lleva-iva", "ley-iva·Artículo 3·"],
  [20, "ho-minimo-renta-2026", "reglamento-renta·Artículo 12·"],
];
const rankOf = (list, pre) => {
  const i = list.findIndex((c) => c.startsWith(pre));
  return i < 0 ? "—" : `#${i + 1}`;
};
console.log("## #554's carriers: in the set? (pool rank) before → after");
for (const [row, id, pre] of CARRIERS) {
  const b = before.get(id),
    a = after.get(id);
  const inSet = (r) =>
    r.per[CONFIG].set.some((c) => c.startsWith(pre)) ? "✓" : "✗";
  console.log(
    `row ${row} ${id} [${a.steps}]: ${inSet(b)} (${rankOf(b.pool, pre)}) → ${inSet(a)} (${rankOf(a.pool, pre)})`,
  );
}
console.log("\n## Per case: set and pool changes, target ranks");
let setChanged = 0,
  poolChanged = 0,
  hitDiff = 0,
  targetDown = 0;
for (const [id, b] of before) {
  const a = after.get(id);
  const pb = b.per[CONFIG],
    pa = a.per[CONFIG];
  const setIn = pa.set.filter((c) => !pb.set.includes(c));
  const setOut = pb.set.filter((c) => !pa.set.includes(c));
  const poolIn = a.pool.filter((c) => !b.pool.includes(c));
  const poolOut = b.pool.filter((c) => !a.pool.includes(c));
  const ranks = (r) =>
    new Map((r.targetRanks ?? []).map((t) => [t.target, t.rank]));
  const rb = ranks(b),
    ra = ranks(a);
  const moved = [...new Set([...rb.keys(), ...ra.keys()])]
    .filter((t) => rb.get(t) !== ra.get(t))
    .map((t) => `${t} ${rb.get(t) ?? "—"}→${ra.get(t) ?? "—"}`);
  const hb = b.kind === "retrieval" && pb.present > 0,
    ha = a.kind === "retrieval" && pa.present > 0;
  if (hb !== ha) hitDiff += 1;
  if (pa.present < pb.present) targetDown += 1;
  if (setIn.length || setOut.length) setChanged += 1;
  if (poolIn.length || poolOut.length) poolChanged += 1;
  if (
    setIn.length ||
    setOut.length ||
    poolIn.length ||
    poolOut.length ||
    moved.length ||
    pa.present !== pb.present
  ) {
    console.log(
      `${id} [${b.kind}${a.steps ? " " + a.steps : ""}] set ${pb.size}→${pa.size} targets ${pb.present}→${pa.present}` +
        (setIn.length ? `\n   set + ${setIn.join(" ; ")}` : "") +
        (setOut.length ? `\n   set − ${setOut.join(" ; ")}` : "") +
        (poolIn.length ? `\n   pool + ${poolIn.join(" ; ")}` : "") +
        (poolOut.length ? `\n   pool − ${poolOut.join(" ; ")}` : "") +
        (moved.length ? `\n   target ranks: ${moved.join(" ; ")}` : ""),
    );
  }
}
console.log(
  `\ncases: ${before.size}; set changed: ${setChanged}; pool changed: ${poolChanged}; hit changed: ${hitDiff}; fewer targets in the set: ${targetDown}`,
);
