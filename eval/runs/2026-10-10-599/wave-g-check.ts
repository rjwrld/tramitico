// Free: which of Wave G's answer sets that carry the salario base would keep
// it under #599's trigger. Reads the lane's groundedness transcript (and the
// abstention one), no database, no provider. A set's cut is its chunks with
// no pin or a step pin (`answerSetFromOrder` picks them before
// `pinAnswerSet`); the trigger reads only the cut, and a circular another
// append brought (a derived figure's input, #287) stays whatever it reads.
//
//   pnpm exec tsx eval/runs/2026-10-10-599/wave-g-check.ts <transcript.jsonl>…
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  statesAmountInSalariosBase,
  triggersSalarioBase,
} from "../../../src/lib/answer/salario-base";

interface Chunk {
  docKey: string;
  articulo: string | null;
  content: string;
  pin?: string | null;
}

for (const file of process.argv.slice(2)) {
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { id: string; chunks?: Chunk[] | null });
  const tally = { carry: 0, keep: 0, lose: 0, other: 0 };
  console.log(`\n${path.basename(file)}: ${rows.length} rows`);
  for (const row of rows) {
    const chunks = row.chunks ?? [];
    const base = chunks.find((c) => c.docKey.startsWith("salario-base"));
    if (base === undefined) continue;
    tally.carry += 1;
    const cut = chunks.filter((c) => c.pin == null || c.pin === "step");
    const label = (c: Chunk) => `${c.docKey} · ${c.articulo ?? "*"}`;
    if (base.pin !== "salarioBase") {
      tally.other += 1;
      console.log(`  ${row.id}: KEEPS (${base.pin ?? "in the cut"})`);
      continue;
    }
    const triggers = cut.filter(triggersSalarioBase);
    if (triggers.length > 0) {
      tally.keep += 1;
      console.log(`  ${row.id}: KEEPS; ${triggers.map(label).join(", ")}`);
    } else {
      tally.lose += 1;
      console.log(
        `  ${row.id}: LOSES; #591 only: ${cut.filter(statesAmountInSalariosBase).map(label).join(", ")}`,
      );
    }
  }
  console.log(
    `  sets carrying the circular: ${tally.carry}; keep it ${tally.keep + tally.other} ` +
      `(${tally.other} through another append or the cut); lose it ${tally.lose}`,
  );
}
