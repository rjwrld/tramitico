// Free: where the run-to-run variance between Wave G's lane and this one
// enters retrieval, for the retrieval-stability wave. Reads the two lane logs'
// hit-rate blocks (each case's expansion, step family, and pool#/rr# of every
// target, catalogue reach and carrier it prints) and the two groundedness
// transcripts' answer sets. No provider, no database.
//
//   node eval/runs/2026-10-12-497-confirm/stability.mjs \
//     eval/runs/2026-10-10-497-wave-g/lane-20261011T005438Z.log \
//     eval/runs/2026-10-12-497-confirm/lane-20261012T230811Z.log \
//     eval/runs/2026-10-10-497-wave-g/lane/groundedness-claude-sonnet-5-5-effort-low-20261011T012347Z.jsonl \
//     eval/runs/2026-10-12-497-confirm/lane/groundedness-claude-sonnet-5-5-effort-low-20261012T233756Z.jsonl
import { readFileSync } from "node:fs";

const [logG, logC, setG, setC] = process.argv.slice(2);

/** case → { expansion, steps, rows: label → { pool, rr, status } } */
function hitRateBlocks(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("retrieval hit-rate"));
  const blocks = new Map();
  let current = null;
  for (const line of lines.slice(start)) {
    const head = line.match(/^ {2}(hit|miss) +pool#\S+ +top=\S+ +(\S+)$/);
    if (head) {
      current = {
        verdict: head[1],
        expansion: null,
        steps: null,
        rows: new Map(),
      };
      blocks.set(head[2], current);
      continue;
    }
    if (current === null) continue;
    const exp = line.match(/^ {8}⤳ (.*)$/);
    if (exp) {
      current.expansion = exp[1];
      continue;
    }
    const steps = line.match(/^ {8}⊕ steps=(\S+)/);
    if (steps) {
      current.steps = steps[1];
      continue;
    }
    const row = line.match(
      /^ {10}pool#(\S+) +rr#(\S+) +(top|pinned|cut) +(.*?)(?: \((?:catálogo|carrier)\))?$/,
    );
    if (row) {
      const label = row[4];
      // A chunk printed as a target and again as a catalogue reach or carrier
      // sits at the same place; keep the first.
      if (!current.rows.has(label)) {
        current.rows.set(label, { pool: row[1], rr: row[2], status: row[3] });
      }
      continue;
    }
    if (/^\S/.test(line)) current = null;
  }
  return blocks;
}

/** case → { query, ids: Set<chunkId>, labels: Set<"docKey · articulo"> } */
function answerSets(path) {
  const sets = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line);
    sets.set(row.id, {
      query: row.query,
      ids: new Set(row.chunks.map((c) => c.chunkId)),
      labels: new Set(row.chunks.map((c) => `${c.docKey} · ${c.articulo}`)),
    });
  }
  return sets;
}

const hit = { G: hitRateBlocks(logG), C: hitRateBlocks(logC) };
const set = { G: answerSets(setG), C: answerSets(setC) };

const jaccard = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter || 1);
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// 1. Which inputs to the search differ between the lanes, stage by stage.
const cases = [...hit.C.keys()].filter((id) => hit.G.has(id));
let sameExpansion = 0;
let sameSteps = 0;
let noExpansion = 0;
for (const id of cases) {
  if (hit.G.get(id).expansion === hit.C.get(id).expansion) sameExpansion++;
  if (hit.G.get(id).expansion === null || hit.C.get(id).expansion === null)
    noExpansion++;
  if (hit.G.get(id).steps === hit.C.get(id).steps) sameSteps++;
}
const queries = [...set.C.keys()].filter((id) => set.G.has(id));
const sameQuery = queries.filter(
  (id) => set.G.get(id).query === set.C.get(id).query,
);
const rewritten = queries.filter(
  (id) =>
    set.C.get(id).query !== id && set.G.get(id).query !== set.C.get(id).query,
);
console.log(`hit-rate blocks in both lanes: ${cases.length}`);
console.log(
  `  expansion text identical: ${sameExpansion}/${cases.length} (missing in either: ${noExpansion})`,
);
console.log(`  step family identical:    ${sameSteps}/${cases.length}`);
console.log(`groundedness rows in both lanes: ${queries.length}`);
console.log(
  `  pipeline query identical: ${sameQuery.length}/${queries.length}${rewritten.length ? ` — differs: ${rewritten.join(", ")}` : ""}`,
);

// 2. Given the stage inputs, how far the printed chunks move between lanes in
// the hit-rate leg: the pool (embeddings, lexical, RRF over the five legs
// plus the catalogue) and the rerank order.
let rows = 0;
let samePool = 0;
let sameRr = 0;
let sameStatus = 0;
for (const id of cases) {
  const g = hit.G.get(id).rows;
  for (const [label, c] of hit.C.get(id).rows) {
    const before = g.get(label);
    if (!before) continue;
    rows++;
    if (before.pool === c.pool) samePool++;
    if (before.rr === c.rr) sameRr++;
    if (before.status === c.status) sameStatus++;
  }
}
console.log(`printed chunks in both lanes' hit-rate leg: ${rows}`);
console.log(
  `  same pool#: ${samePool} · same rr#: ${sameRr} · same top/pinned/cut: ${sameStatus}`,
);

// 3. Answer-set overlap per pair of draws: lane against lane in the
// groundedness leg, the one #609's read.log reports.
const overlaps = queries.map((id) =>
  jaccard(set.G.get(id).ids, set.C.get(id).ids),
);
console.log(
  `groundedness answer-set Jaccard, G vs C: median ${median(overlaps).toFixed(2)}`,
);
console.log(
  `  sets identical: ${overlaps.filter((x) => x === 1).length}/${queries.length}`,
);

// 4. The 17 rows #609 files as retrieval misses, by carrier. A carrier
// is a "docKey · articulo" label, which is what the hit-rate log prints;
// `any` lists alternatives, any one of which carries the claim.
const MISSES = [
  [
    "ccss-pedir-prescripcion-cuotas",
    "20 días hábiles to resolve",
    [
      "ccss-prescripcion · ¿Una vez recibida la solicitud de prescripción en sede administrativa, en cuanto tiempo resuelve la Administración?",
    ],
  ],
  [
    "desinscripcion-dejar-actividad",
    "ATV disabled (#602 item 1)",
    [
      "tribu-cr-res-0011-2025 · Artículo 1",
      "tribu-cr-res-0020-2025 · Preámbulo",
      "tribu-cr-res-0033-2025 · Preámbulo",
    ],
  ],
  [
    "inscripcion-tardia-sancion",
    "inscription filing in the OVi",
    ["tribu-cr-faq · Declaraciones del RUT · 2"],
  ],
  [
    "ho-hacienda-solo-cliente-eeuu",
    "exempt is not non-contribuyente",
    ["ley-iva · Artículo 4", "ley-iva · Artículo 8"],
  ],
  [
    "ho-hacienda-solo-cliente-eeuu",
    "inscripción de oficio",
    ["ley-iva · Artículo 5"],
  ],
  [
    "ho-donde-inscribo-ya-no-atv",
    "who may inscribe online",
    ["tribu-cr-faq · Registro Único Tributario (RUT) · 2"],
  ],
  [
    "ho-donde-inscribo-ya-no-atv",
    "OVi path to the inscription",
    ["tribu-cr-faq · Declaraciones del RUT · 3"],
  ],
  [
    "ho-cliente-espana-lleva-iva",
    "13 % if consumed in CR",
    ["ley-iva · Artículo 10", "reglamento-iva · Artículo 32"],
  ],
  [
    "ho-cliente-espana-lleva-iva",
    "factura electrónica de exportación (#609 counts it as retrieval; the confirming set holds it, so unsaid)",
    ["reglamento-comprobantes · Artículo 13"],
  ],
  [
    "ho-iva-en-cero-sin-facturar",
    "50 % of a salario base",
    ["cnpt · Artículo 79"],
  ],
  [
    "ho-rebajar-25-sin-facturas",
    "annual return in TRIBU-CR (#602 item 2)",
    [
      "tribu-cr-res-0020-2025 · Artículo 3",
      "tribu-cr-res-0011-2025 · Artículo 2",
    ],
  ],
  [
    "ho-minimo-renta-2026",
    "period 1 Jan – 31 Dec",
    ["reglamento-renta · Artículo 12"],
  ],
  [
    "ho-ademas-tengo-salario",
    "pagos parciales, deducted",
    ["ley-renta · ARTICULO 22"],
  ],
  [
    "ho-ademas-tengo-salario",
    "pagos parciales: when, rebaja",
    ["ley-renta · ARTICULO 22"],
  ],
  [
    "ho-ademas-tengo-salario",
    "2 months 15 days",
    ["ley-renta · ARTICULO 22", "ley-renta · ARTICULO 20"],
  ],
  [
    "ho-tambien-asegurado-por-patrono",
    "afiliación, sucursal or online",
    ["ccss-reglamento-ti · Artículo 7"],
  ],
  [
    "ho-desinscribir-debiendo-declaraciones",
    "50 % of a salario base",
    ["cnpt · Artículo 79"],
  ],
];

const where = (lane, id, labels) => {
  const block = hit[lane].get(id);
  const found = labels
    .map((label) => ({ label, row: block?.rows.get(label) }))
    .filter((x) => x.row);
  if (found.length === 0) return "not printed";
  const best = found.sort((a, b) => {
    const rank = (r) => ({ top: 0, pinned: 1, cut: 2 })[r.status];
    return rank(a.row) - rank(b.row) || Number(a.row.rr) - Number(b.row.rr);
  })[0].row;
  return `pool#${best.pool} rr#${best.rr} ${best.status}`;
};
const inSet = (lane, id, labels) =>
  labels.some((label) => set[lane].get(id)?.labels.has(label)) ? "in" : "—";

console.log(
  "\nthe 17 rows #609 files as retrieval misses (16 once one is refiled): carrier, per draw",
);
console.log(
  "  hit-rate leg: pool#/rr#/status, or «not printed» when the carrier is no target, catalogue reach or tier1-carriers entry",
);
console.log("  answer set:   the groundedness leg's set, «in» or «—»");
for (const [id, what, labels] of MISSES) {
  const expSame =
    hit.G.get(id)?.expansion === hit.C.get(id)?.expansion ? "same" : "differs";
  console.log(`\n${id} — ${what}`);
  console.log(`  carrier: ${labels.join(" | ")}`);
  console.log(
    `  expansion G vs C: ${expSame} · steps ${hit.G.get(id)?.steps ?? "?"} / ${hit.C.get(id)?.steps ?? "?"}`,
  );
  console.log(
    `  Wave G   hit-rate ${where("G", id, labels).padEnd(26)} answer set ${inSet("G", id, labels)}`,
  );
  console.log(
    `  confirm  hit-rate ${where("C", id, labels).padEnd(26)} answer set ${inSet("C", id, labels)}`,
  );
}
