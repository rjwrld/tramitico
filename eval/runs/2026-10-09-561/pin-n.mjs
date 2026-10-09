// Free re-read of step-picks.json: which #561 carriers the answer set would
// hold if pin1 appended the best N fresh step picks (by question rank, as
// answerSetFromOrder orders them) instead of one. The derived-figure
// exclusion is not modelled; on these ten cases it only touches
// salarios-minimos, which sorts last. Usage: node pin-n.mjs (from the repo root).
import fs from "node:fs";
const { reads } = JSON.parse(
  fs.readFileSync("eval/runs/2026-10-09-561/step-picks.json", "utf8"),
);
const carriers = {
  "ccss-pedir-prescripcion-cuotas": {
    1: ["ccss-prescripcion·¿Una vez recibida"],
  },
  "ccss-obligacion-ingreso-bajo": {
    3: ["ccss-faq·¿Dónde me corresponde realizar"],
  },
  "desinscripcion-dejar-actividad": {
    "4a": ["ley-iva·Artículo 27·", "reglamento-iva·Artículo 40·"],
    "4b": ["cnpt·Artículo 79·"],
  },
  "ho-hacienda-solo-cliente-eeuu": { 6: ["cnpt·Artículo 78·"] },
  "ho-trabajitos-por-mi-cuenta": {
    7: [
      "tribu-cr-faq·Declaraciones del RUT · 2·",
      "tribu-cr-faq·Registro Único Tributario (RUT) · 1·",
    ],
  },
  "ho-donde-me-afilio-caja": { 9: ["ccss-faq·¿Cuándo me corresponde pagar"] },
  "ho-factura-electronica-o-recibo": {
    11: [
      "reglamento-comprobantes·Artículo 16·",
      "reglamento-comprobantes·Artículo 22·",
    ],
    12: ["reglamento-comprobantes·Artículo 22·"],
  },
  "ho-rebajar-25-sin-facturas": { 18: ["tribu-cr-res-0011-2025·Artículo 2·"] },
  "ho-ademas-tengo-salario": { "23-25": ["ley-renta·ARTICULO 22·"] },
  "ho-desinscribir-debiendo-declaraciones": { 27: ["cnpt·Artículo 79·"] },
};
for (const r of reads) {
  const cut = r.order.slice(0, 8);
  const picks = [];
  for (const s of r.sentences) {
    const b = s.order[0]?.chunk;
    if (b && !picks.includes(b)) picks.push(b);
  }
  const fresh = picks
    .filter((p) => !cut.includes(p))
    .map((p) => ({ p, q: r.order.indexOf(p) + 1 }))
    .sort((a, b) => a.q - b.q);
  const line = [];
  for (const N of [1, 2, 3]) {
    const set = [...cut, ...fresh.slice(0, N).map((f) => f.p)];
    const got = Object.entries(carriers[r.id])
      .map(
        ([row, pre]) =>
          `${row}:${pre.some((x) => set.some((c) => c.startsWith(x))) ? "✓" : "✗"}`,
      )
      .join(",");
    line.push(`pin${N} ${got}`);
  }
  console.log(
    r.id.padEnd(40),
    "fresh by q:",
    fresh.map((f) => `${f.p.slice(0, 28)}(q${f.q})`).join(" < "),
  );
  console.log("   ", line.join("  |  "));
}
