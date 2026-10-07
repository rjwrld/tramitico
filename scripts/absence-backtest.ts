/**
 * The #500 backtest: the false-absence detector and the typo heuristic over
 * every answer committed under `eval/runs/`. Free — it reads committed files
 * only: no database, no model, no judge.
 *
 *   pnpm absence-backtest            # one line per finding, then the totals
 *   pnpm absence-backtest --openings # also every absence-claim opening
 *
 * A groundedness row carries its numbered chunks, so a bare «artículo 10»
 * resolves against what the answer cited. An abstention row carries none, and
 * resolves against the documents the answer names.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  citedChunks,
  corpusCoverage,
  detectAbsenceClaims,
} from "../src/lib/eval/absence";
import {
  CORPUS_INDEX_PATH,
  parseCorpusIndex,
} from "../src/lib/eval/corpus-index";
import { typoRuns } from "../src/lib/eval/typo";

const RUNS_DIR = path.join(process.cwd(), "eval", "runs");

function jsonlFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return jsonlFiles(full);
      return name.endsWith(".jsonl") ? [full] : [];
    });
}

interface Row {
  id: string;
  answer?: string;
  chunks?: { docKey: string }[];
}

const showOpenings = process.argv.includes("--openings");
const coverage = corpusCoverage(
  parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8")),
);

let rows = 0;
let answered = 0;
let claims = 0;
const flaggedRows = new Set<string>();
let openings = 0;
let typos = 0;
for (const file of jsonlFiles(RUNS_DIR)) {
  const where = path.relative(RUNS_DIR, file);
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    rows += 1;
    const row = JSON.parse(line) as Row;
    if (typeof row.answer !== "string" || row.answer === "") continue;
    answered += 1;
    const report = detectAbsenceClaims(row.answer, {
      cited: citedChunks(row.answer, row.chunks ?? []),
      coverage,
    });
    for (const claim of report.falseClaims) {
      claims += 1;
      flaggedRows.add(`${where}\t${row.id}`);
      console.log(
        `FALSE\t${where}\t${row.id}\t${claim.target}\t${claim.sentence}`,
      );
    }
    if (report.opening !== null) {
      openings += 1;
      if (showOpenings) {
        console.log(`OPENING\t${where}\t${row.id}\t${report.opening}`);
      }
    }
    for (const word of typoRuns(row.answer)) {
      typos += 1;
      console.log(`TYPO\t${where}\t${row.id}\t${word}`);
    }
  }
}
console.log(
  `\nrows ${rows}, answers ${answered}; false absence claims ${claims} ` +
    `in ${flaggedRows.size} answers; absence openings ${openings}; ` +
    `typo runs ${typos}`,
);
