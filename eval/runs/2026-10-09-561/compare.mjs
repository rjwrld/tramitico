// Free comparison of probe-before.json (STEP_PINS=1) and probe-after.json
// (STEP_PINS=2, before's rewrites replayed), production configuration:
// what each case's set gains and loses, hit and target counts, set sizes,
// and #561's carriers. Usage: node eval/runs/2026-10-09-561/compare.mjs
import fs from "node:fs";
const dir = "eval/runs/2026-10-09-561";
const CONFIG = "top8/capoff/pinon";
const read = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")).reads;
const before = new Map(read("probe-before.json").map((r) => [r.id, r]));
const after = new Map(read("probe-after.json").map((r) => [r.id, r]));
const CARRIERS = [
  [
    1,
    "ccss-pedir-prescripcion-cuotas",
    ["ccss-prescripcion·¿Una vez recibida"],
  ],
  [
    3,
    "ccss-obligacion-ingreso-bajo",
    ["ccss-faq·¿Dónde me corresponde realizar"],
  ],
  [
    "4 (ley-iva 27)",
    "desinscripcion-dejar-actividad",
    ["ley-iva·Artículo 27·", "reglamento-iva·Artículo 40·"],
  ],
  ["4 (cnpt 79)", "desinscripcion-dejar-actividad", ["cnpt·Artículo 79·"]],
  [6, "ho-hacienda-solo-cliente-eeuu", ["cnpt·Artículo 78·"]],
  [
    7,
    "ho-trabajitos-por-mi-cuenta",
    [
      "tribu-cr-faq·Declaraciones del RUT · 2·",
      "tribu-cr-faq·Registro Único Tributario (RUT) · 1·",
    ],
  ],
  [9, "ho-donde-me-afilio-caja", ["ccss-faq·¿Cuándo me corresponde pagar"]],
  [
    11,
    "ho-factura-electronica-o-recibo",
    [
      "reglamento-comprobantes·Artículo 16·",
      "reglamento-comprobantes·Artículo 22·",
    ],
  ],
  [
    12,
    "ho-factura-electronica-o-recibo",
    ["reglamento-comprobantes·Artículo 22·"],
  ],
  [18, "ho-rebajar-25-sin-facturas", ["tribu-cr-res-0011-2025·Artículo 2·"]],
  ["23–25", "ho-ademas-tengo-salario", ["ley-renta·ARTICULO 22·"]],
  [27, "ho-desinscribir-debiendo-declaraciones", ["cnpt·Artículo 79·"]],
];
const has = (set, pre) => pre.some((p) => set.some((c) => c.startsWith(p)));
console.log("## #561's carriers (before → after)");
for (const [row, id, pre] of CARRIERS) {
  const b = before.get(id).per[CONFIG].set,
    a = after.get(id).per[CONFIG].set;
  console.log(
    `row ${row} ${id}: ${has(b, pre) ? "✓" : "✗"} → ${has(a, pre) ? "✓" : "✗"}`,
  );
}
console.log("\n## Per case: lost, gained, targets, hit");
const sizes = { before: {}, after: {} };
let lost = 0,
  hitDiff = 0,
  targetDown = 0,
  grew = 0,
  same = 0;
for (const [id, b] of before) {
  const a = after.get(id);
  const pb = b.per[CONFIG],
    pa = a.per[CONFIG];
  sizes.before[pb.size] = (sizes.before[pb.size] ?? 0) + 1;
  sizes.after[pa.size] = (sizes.after[pa.size] ?? 0) + 1;
  const gone = pb.set.filter((c) => !pa.set.includes(c));
  const added = pa.set.filter((c) => !pb.set.includes(c));
  if (gone.length) lost += 1;
  const hb = b.kind === "retrieval" && pb.present > 0,
    ha = a.kind === "retrieval" && pa.present > 0;
  if (hb !== ha) hitDiff += 1;
  if (pa.present < pb.present) targetDown += 1;
  if (pa.size > pb.size) grew += 1;
  else if (!gone.length && !added.length) same += 1;
  if (gone.length || added.length || pa.present !== pb.present) {
    console.log(
      `${id} [${b.kind}${b.steps ? " " + b.steps : ""}] size ${pb.size}→${pa.size} targets ${pb.present}→${pa.present}` +
        (added.length ? `\n   + ${added.join(" ; ")}` : "") +
        (gone.length ? `\n   − ${gone.join(" ; ")}` : ""),
    );
  }
}
console.log(
  `\ncases: ${before.size}; grew: ${grew}; unchanged: ${same}; lost a chunk: ${lost}; hit changed: ${hitDiff}; fewer targets: ${targetDown}`,
);
console.log(
  "set sizes before:",
  JSON.stringify(sizes.before),
  "after:",
  JSON.stringify(sizes.after),
);
