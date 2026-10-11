// Free: reads #591's replay transcript against the pass bar in README.md.
// Per row: pin-on set or the `/sboff` control, the groundedness verdict, the
// false absence claims (#500), whether the answer cites the salario base's
// marker, whether it names the salario base or its colones, and every figure
// in it — for the abstention case, also the lane's «invents no figure while
// declining» reading (`figureMentions` against the row's sources).
//
//   pnpm exec tsx eval/runs/2026-10-10-591/replay-check.ts <replay transcript.jsonl>
import { readFileSync } from "node:fs";
import { fold } from "../../../src/lib/articulo-key";
import { figureMentions } from "../../../src/lib/eval/adequacy";
import type { TranscriptRow } from "../../../src/lib/eval/transcript";

const file = process.argv[2];
if (file === undefined) throw new Error("usage: replay-check.ts <jsonl>");
const rows = readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as TranscriptRow);

const cited = (answer: string): Set<number> =>
  new Set(
    [...answer.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)].flatMap((m) =>
      m[1].split(/[,–-]/).map((n) => Number(n.trim())),
    ),
  );

for (const row of rows) {
  const base = row.chunks.find((c) => c.docKey.startsWith("salario-base"));
  const markers = cited(row.answer);
  const names = /salarios? base/.test(fold(row.answer));
  const colones = /462[.,\s]?200/.test(row.answer);
  const figures = figureMentions(row.answer);
  const sources = [
    ...row.chunks.map((c) => c.content),
    ...row.derivedFigures.map((f) => f.formattedValue),
  ];
  console.log(
    [
      row.id.padEnd(36),
      (base === undefined ? "sboff" : "pin on").padEnd(7),
      `grounded ${row.groundedness.verdict}`,
      `falseAbsence ${row.checks?.absence.falseClaims.length ?? "?"}`,
      `cites salario base ${base === undefined ? "—" : markers.has(base.marker) ? "YES" : "no"}`,
      `names salario base ${names ? "YES" : "no"}`,
      `states ¢462.200 ${colones ? "YES" : "no"}`,
      `figures [${figures.join(" ")}]`,
      ...(String(row.tier) === "abstain"
        ? [`lane leak [${figureMentions(row.answer, sources).join(" ")}]`]
        : []),
    ].join(" | "),
  );
}
