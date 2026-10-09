/**
 * Where the Tier 1 requirements two lanes both missed go missing (#554): not
 * in the corpus (1), in the corpus but not in the answer set (2), or in the
 * answer set and dropped by the answer (3).
 *
 * Free on purpose: no provider, no database. The judgement «this chunk
 * carries the requirement» is made by hand, once, and committed as a carriers
 * file: one quote per carrier. This script does the rest mechanically. It
 * finds the requirements both lanes missed, takes each lane's cause from
 * whether a carrier's chunk is in that lane's answer set, and checks every
 * quote against the chunk's text wherever a transcript row carries it. A
 * carrier no row carries can't be checked from here. Its quotes come out as
 * one read-only SQL query for the shared local stack.
 *
 * A requirement the answers missed in more than one part takes the most
 * upstream cause among its parts. Fixing the answer alone would not state it.
 *
 * It also reads `eval/step-catalogue.json` and marks each row whose carrier is
 * already in the `reaches` of the case's own family (#304): a sentence finds
 * it. That is the catalogue's claim, not the lane's outcome, so a second
 * column says whether that carrier entered each lane's answer set. A cause-2
 * row the sentence finds and that enters no set is the lead: the catalogue
 * brings the chunk, and it loses its place before the answer (#561, #584).
 *
 * The carriers file lists its requirements in the table's order, and the
 * script fails when it doesn't, so «row N» names the same carrier in the
 * printed table, the file and every record that cites it (#584).
 *
 * Usage:
 *   pnpm tier1-miss-causes <lane1 groundedness.jsonl> <lane2 groundedness.jsonl> <carriers.json>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AdequacyMisses } from "../src/lib/eval/adequacy";
import {
  DATASET_PATH,
  isRobustness,
  parseDataset,
  type EvalCase,
} from "../src/lib/eval/dataset";
import { matchesTarget, type Target } from "./target-match";

export type Cause = 1 | 2 | 3;

const CATALOGUE_PATH = path.join(process.cwd(), "eval", "step-catalogue.json");

export interface Carrier {
  chunkId: string;
  docKey: string;
  articulo: string | null;
  quote: string;
}

export interface Part {
  what: string;
  carriers: Carrier[];
}

export interface Tagged {
  case: string;
  requirement: string;
  parts: Part[];
  note?: string;
  uncertain?: boolean;
}

interface Chunk {
  chunkId: string;
  docKey: string;
  articulo: string | null;
  content: string;
}

export interface Row {
  id: string;
  chunks: Chunk[];
  adequacy: AdequacyMisses | null;
}

export interface Miss {
  case: string;
  requirement: string;
}

/**
 * A failed literal reads `<claim> (<variants>: absent)` in the transcript.
 * The claim is the requirement, and both lanes must key it the same way.
 */
export function requirementOf(miss: string): string {
  return miss.replace(/ \([^()]*: (?:absent|present but uncited)\)$/, "");
}

/** The Tier 1 requirements a lane missed, outside the robustness block. */
export function lostRequirements(
  rows: readonly Row[],
  dataset: readonly Pick<EvalCase, "id" | "tier" | "variant">[],
): Miss[] {
  return rows.flatMap((row) => {
    const evalCase = dataset.find((c) => c.id === row.id);
    if (
      evalCase === undefined ||
      evalCase.tier !== 1 ||
      isRobustness(evalCase) ||
      row.adequacy === null
    ) {
      return [];
    }
    return [...row.adequacy.missing, ...row.adequacy.literals].map((miss) => ({
      case: row.id,
      requirement: requirementOf(miss),
    }));
  });
}

const key = (miss: Miss) => `${miss.case}\u0000${miss.requirement}`;

export function splitLanes(
  one: readonly Miss[],
  two: readonly Miss[],
): { both: Miss[]; onlyOne: Miss[]; onlyTwo: Miss[] } {
  const inOne = new Set(one.map(key));
  const inTwo = new Set(two.map(key));
  return {
    both: one.filter((miss) => inTwo.has(key(miss))),
    onlyOne: one.filter((miss) => !inTwo.has(key(miss))),
    onlyTwo: two.filter((miss) => !inOne.has(key(miss))),
  };
}

/** One lane's cause: the most upstream over the parts. */
export function causeIn(tagged: Tagged, answerSet: ReadonlySet<string>): Cause {
  const causes = tagged.parts.map((part): Cause => {
    if (part.carriers.length === 0) return 1;
    return part.carriers.some((c) => answerSet.has(c.chunkId)) ? 3 : 2;
  });
  return Math.min(...causes) as Cause;
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Checks each carrier against the chunk text any transcript row carries.
 * Returns the mismatches, and the carriers no row carries.
 */
export function checkQuotes(
  tagged: readonly Tagged[],
  rows: readonly Row[],
): { failures: string[]; unchecked: Carrier[] } {
  const chunks = new Map<string, Chunk>();
  for (const row of rows) {
    for (const chunk of row.chunks) chunks.set(chunk.chunkId, chunk);
  }
  const failures: string[] = [];
  const unchecked: Carrier[] = [];
  for (const t of tagged) {
    for (const carrier of t.parts.flatMap((part) => part.carriers)) {
      const chunk = chunks.get(carrier.chunkId);
      if (chunk === undefined) {
        unchecked.push(carrier);
      } else if (
        chunk.docKey !== carrier.docKey ||
        chunk.articulo !== carrier.articulo
      ) {
        failures.push(
          `${t.case}: ${carrier.chunkId} is ${chunk.docKey} · ${chunk.articulo}, not ${carrier.docKey} · ${carrier.articulo}`,
        );
      } else if (!normalize(chunk.content).includes(normalize(carrier.quote))) {
        failures.push(
          `${t.case}: «${carrier.quote}» is not in ${carrier.chunkId}`,
        );
      }
    }
  }
  return { failures, unchecked };
}

/** One read-only query that checks the quotes no transcript row carries. */
export function quoteCheckSql(carriers: readonly Carrier[]): string {
  const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;
  const values = carriers
    .map((c) => `  (${literal(c.chunkId)}, ${literal(normalize(c.quote))})`)
    .join(",\n");
  return [
    "select q.id, c.id is not null as found,",
    "  position(q.quote in regexp_replace(c.content, '\\s+', ' ', 'g')) > 0 as carries",
    "from (values",
    values,
    ") as q(id, quote)",
    "left join chunks c on c.id::text = q.id;",
  ].join("\n");
}

const LABEL: Record<Cause, string> = {
  1: "1 not in the corpus",
  2: "2 not in the answer set",
  3: "3 dropped by the answer",
};

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

export interface Classified {
  tagged: Tagged;
  lanes: [Cause, Cause];
  /**
   * A part that missed an answer set has a carrier in `reaches` of the
   * step-catalogue family that lists the case: a sentence finds it. A part
   * already in both sets is not counted: the catalogue reaching it says
   * nothing about the miss.
   */
  sentenceFinds: boolean;
  /**
   * Per lane, whether one of those catalogue-found carriers is in that lane's
   * answer set. Finding a chunk is not putting it in front of the model: the
   * pick can lose the pinned slot (#561). False on both when no sentence
   * finds the carrier.
   */
  entersSet: [boolean, boolean];
  /**
   * A part that missed an answer set has a carrier that is one of the case's
   * own `expected` targets. The case can still hit through another target, so
   * the hit-rate gate does not see the miss.
   */
  expectedTarget: boolean;
}

/** `eval/step-catalogue.json`'s shape, as far as this script reads it. */
export interface StepCatalogue {
  families: Record<string, { cases: string[]; reaches: string[] }>;
}

/**
 * The carriers in `parts` that the case's own family lists in `reaches`. The
 * catalogue labels a chunk `docKey · articulo`, or `docKey` alone.
 */
export function catalogueCarriers(
  caseId: string,
  parts: readonly Part[],
  catalogue: StepCatalogue,
): Carrier[] {
  const reaches = new Set(
    Object.values(catalogue.families)
      .filter((family) => family.cases.includes(caseId))
      .flatMap((family) => family.reaches),
  );
  return parts.flatMap((part) =>
    part.carriers.filter((c) =>
      reaches.has(c.articulo ? `${c.docKey} · ${c.articulo}` : c.docKey),
    ),
  );
}

export function classify(
  both: readonly Miss[],
  tagged: readonly Tagged[],
  rowsOne: readonly Row[],
  rowsTwo: readonly Row[],
  catalogue: StepCatalogue,
  expected: ReadonlyMap<string, Target[]>,
): { classified: Classified[]; errors: string[] } {
  const errors: string[] = [];
  const byKey = new Map(tagged.map((t) => [key(t), t]));
  const wanted = new Set(both.map(key));
  for (const t of tagged) {
    if (!wanted.has(key(t))) {
      errors.push(
        `tagged but not missed in both lanes: ${t.case}: ${t.requirement}`,
      );
    }
  }
  const tableOrder = both.map(key).filter((k) => byKey.has(k));
  const fileOrder = tagged.map(key).filter((k) => wanted.has(k));
  const at = fileOrder.findIndex((k, i) => k !== tableOrder[i]);
  if (at >= 0) {
    const name = (k: string | undefined) => k?.replace("\u0000", ": ");
    errors.push(
      `carriers file out of the table's order at row ${at + 1}: the file has ${name(fileOrder[at])}, the table ${name(tableOrder[at])}`,
    );
  }
  const answerSet = (rows: readonly Row[], id: string) =>
    new Set(rows.find((row) => row.id === id)?.chunks.map((c) => c.chunkId));
  const reached = (part: Part, set: ReadonlySet<string>) =>
    part.carriers.some((c) => set.has(c.chunkId));
  const classified = both.flatMap((miss) => {
    const t = byKey.get(key(miss));
    if (t === undefined) {
      errors.push(
        `missed in both lanes, not tagged: ${miss.case}: ${miss.requirement}`,
      );
      return [];
    }
    const sets = [answerSet(rowsOne, miss.case), answerSet(rowsTwo, miss.case)];
    const lanes: [Cause, Cause] = [causeIn(t, sets[0]), causeIn(t, sets[1])];
    const missedParts = t.parts.filter((part) =>
      sets.some((set) => !reached(part, set)),
    );
    const found = catalogueCarriers(miss.case, missedParts, catalogue);
    const entersSet = sets.map((set) =>
      found.some((c) => set.has(c.chunkId)),
    ) as [boolean, boolean];
    const targets = expected.get(miss.case) ?? [];
    const expectedTarget = missedParts.some((part) =>
      part.carriers.some((c) =>
        matchesTarget({ doc_key: c.docKey, articulo: c.articulo }, targets),
      ),
    );
    return [
      {
        tagged: t,
        lanes,
        sentenceFinds: found.length > 0,
        entersSet,
        expectedTarget,
      },
    ];
  });
  return { classified, errors };
}

export function countCauses(classified: readonly Classified[]) {
  const counts = {
    1: 0,
    2: 0,
    3: 0,
    split: 0,
    uncertain: 0,
    sentenceFindsCause2: 0,
    foundOutsideCause2: 0,
    expectedCause2: 0,
  };
  for (const c of classified) {
    const { tagged, lanes, sentenceFinds, entersSet, expectedTarget } = c;
    if (lanes[0] === lanes[1]) counts[lanes[0]] += 1;
    else counts.split += 1;
    if (tagged.uncertain) counts.uncertain += 1;
    if (sentenceFinds && lanes[0] === 2 && lanes[1] === 2) {
      counts.sentenceFindsCause2 += 1;
      if (!entersSet[0] && !entersSet[1]) counts.foundOutsideCause2 += 1;
    }
    if (expectedTarget && lanes[0] === 2 && lanes[1] === 2) {
      counts.expectedCause2 += 1;
    }
  }
  return counts;
}

export function renderTable(classified: readonly Classified[]): string {
  const lines = [
    "| # | Case | Requirement | Cause (lane 1 / lane 2) | Sentence finds it | Enters the set | Expected | Carrier: the quote |",
    "| - | ---- | ----------- | ----------------------- | ----------------- | -------------- | -------- | ------------------ |",
  ];
  const yesNo = (b: boolean) => (b ? "yes" : "no");
  classified.forEach((c, i) => {
    const { tagged, lanes, sentenceFinds, entersSet, expectedTarget } = c;
    const cause =
      lanes[0] === lanes[1]
        ? `**${lanes[0]}**`
        : `**${lanes[0]} / ${lanes[1]}**`;
    const enters = !sentenceFinds
      ? "—"
      : entersSet[0] === entersSet[1]
        ? yesNo(entersSet[0])
        : `${yesNo(entersSet[0])} / ${yesNo(entersSet[1])}`;
    const carriers = tagged.parts
      .map((part) =>
        part.carriers.length === 0
          ? `${part.what}: none`
          : part.carriers
              .map(
                (c) =>
                  `\`${c.docKey}\`${c.articulo ? ` · ${c.articulo}` : ""} (\`${c.chunkId.slice(0, 8)}\`): «${c.quote}»`,
              )
              .join("; "),
      )
      .join(" — ");
    const flag = tagged.uncertain ? " (uncertain)" : "";
    lines.push(
      `| ${i + 1} | \`${tagged.case}\` | ${cell(tagged.requirement)} | ${cause}${flag} | ${yesNo(sentenceFinds)} | ${enters} | ${yesNo(expectedTarget)} | ${cell(carriers)} |`,
    );
  });
  return lines.join("\n");
}

function main(): void {
  const [laneOne, laneTwo, carriersPath] = process.argv.slice(2);
  if (!laneOne || !laneTwo || !carriersPath) {
    console.error(
      "usage: pnpm tier1-miss-causes <lane1.jsonl> <lane2.jsonl> <carriers.json>",
    );
    process.exit(2);
  }
  const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const read = (file: string): Row[] =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Row);
  const rowsOne = read(laneOne);
  const rowsTwo = read(laneTwo);
  const tagged = (
    JSON.parse(readFileSync(carriersPath, "utf8")) as { requirements: Tagged[] }
  ).requirements;

  const lostOne = lostRequirements(rowsOne, dataset);
  const lostTwo = lostRequirements(rowsTwo, dataset);
  const { both, onlyOne, onlyTwo } = splitLanes(lostOne, lostTwo);
  const catalogue = JSON.parse(
    readFileSync(CATALOGUE_PATH, "utf8"),
  ) as StepCatalogue;
  const { classified, errors } = classify(
    both,
    tagged,
    rowsOne,
    rowsTwo,
    catalogue,
    new Map(dataset.map((c) => [c.id, c.expected])),
  );
  const { failures, unchecked } = checkQuotes(tagged, [...rowsOne, ...rowsTwo]);

  const counts = countCauses(classified);
  console.log(
    `Missed: lane 1 ${lostOne.length}, lane 2 ${lostTwo.length}; in both ${both.length}, lane 1 only ${onlyOne.length}, lane 2 only ${onlyTwo.length}.\n`,
  );
  console.log(renderTable(classified));
  console.log("\n| Cause | Requirements |\n| ----- | ------------ |");
  for (const cause of [1, 2, 3] as const) {
    console.log(`| ${LABEL[cause]} | ${counts[cause]} |`);
  }
  console.log(`| split between the lanes | ${counts.split} |`);
  console.log(
    `\nFlagged uncertain: ${counts.uncertain}. Cause 2 in both lanes with a carrier a step-catalogue sentence finds: ${counts.sentenceFindsCause2} of ${counts[2]}, ${counts.foundOutsideCause2} of them in neither lane's set; with a carrier that is one of the case's expected targets: ${counts.expectedCause2} of ${counts[2]}.`,
  );
  console.log("\nMissed in one lane only:\n");
  for (const [lane, misses] of [
    ["1", onlyOne],
    ["2", onlyTwo],
  ] as const) {
    for (const miss of misses) {
      console.log(`- lane ${lane}: \`${miss.case}\`: ${miss.requirement}`);
    }
  }
  console.log(
    `\nQuotes checked against transcript rows: ${
      classified.flatMap((c) => c.tagged.parts.flatMap((p) => p.carriers))
        .length - unchecked.length
    }. Outside every row: ${unchecked.length}, checked by:\n`,
  );
  console.log("```sql\n" + quoteCheckSql(unchecked) + "\n```");

  const problems = [...errors, ...failures];
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("tier1-miss-causes.ts")) main();
