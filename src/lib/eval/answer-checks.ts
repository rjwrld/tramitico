/**
 * The deterministic checks on one answer, run the same way by the
 * groundedness and abstention lanes, `answer-replay` and the route: a false
 * corpus-absence claim or count hedge (`absence.ts`, #500 and #547), a typo
 * run (`typo.ts`), and the reader's own case worked out (#546, below).
 *
 * What each caller does with them differs, and is decided here once for the
 * lanes: a false absence claim is a hard zero for its case, and a typo run or
 * a worked-out case is reported, never gated. The route counts the first two
 * (`telemetry.ts`).
 */
import {
  DERIVED_FIGURES,
  evaluateFormula,
  type DerivedFigure,
} from "../answer/derived";
import {
  citedChunks,
  COMMITTED_COVERAGE,
  describeFalseAbsence,
  detectAbsenceClaims,
  fold,
  sentences,
  type AbsenceReport,
  type CitedChunk,
} from "./absence";
import type { Verdict } from "./groundedness";
import { typoRuns } from "./typo";

export interface AnswerChecks {
  absence: AbsenceReport;
  typos: string[];
  /** #546: the reader's own case worked out. Absent on rows before #558. */
  readerCase?: ReaderCaseSlip[];
}

/** A numbered chunk as the checks read it: `content` only feeds #546. */
export interface CheckedChunk extends CitedChunk {
  content?: string;
}

// ── the reader's case (#546) ──────────────────────────────────────────────

/**
 * Prompt rule 3: the answer gives the rule and its figures, and leaves the
 * reader's own arithmetic to the reader or the institution — «no multiplique
 * un monto por su número de hijos ni por los meses que lleva sin cumplir … ni
 * diga si su caso ya llegó a un tope o lo supera». #556's control broke it
 * («Para su caso, un año sin registrarse supera los meses necesarios para
 * llegar al tope») and every judge passed it: the arithmetic is right, and the
 * judges read support, not rule 3.
 */
export interface ReaderCaseSlip {
  /** `product`: an amount that is a figure times the reader's count; `tope`: a cap applied to the reader. */
  kind: "product" | "tope";
  sentence: string;
  /** `¢231.100 × 12 = ¢2.773.200`, or the reader's words the sentence repeats. */
  detail: string;
}

const COUNT_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};
const COUNT_UNITS = String.raw`(?:mes|meses|ano|anos|hijo|hijos|hija|hijas|dependientes|declaraciones|periodos|trimestres)`;
const READER_COUNT = new RegExp(
  String.raw`\b(\d{1,2}|${Object.keys(COUNT_WORDS).join("|")})\s+(${COUNT_UNITS})\b`,
  "g",
);

interface ReaderCount {
  /** What a figure may be multiplied by: the count, and a year's months. */
  multipliers: number[];
  /** The phrase as the reader wrote it and as an answer may write it back. */
  phrases: string[];
}

/** The counts the question gives about the reader: «tres meses», «2 hijos», «un año». */
export function readerCounts(question: string): ReaderCount[] {
  return [...fold(question).matchAll(READER_COUNT)].flatMap((match) => {
    const n = COUNT_WORDS[match[1]] ?? Number(match[1]);
    const unit = match[2];
    const year = unit.startsWith("ano");
    const multipliers = [...(n >= 2 ? [n] : []), ...(year ? [12 * n] : [])];
    if (multipliers.length === 0) return [];
    const words = Object.keys(COUNT_WORDS).filter((w) => COUNT_WORDS[w] === n);
    const phrases = [String(n), ...words].map((count) => `${count} ${unit}`);
    return [{ multipliers, phrases }];
  });
}

/** «¢231.100», «₡373.092,30», «2.773.200 colones», as numbers, with where each sits. */
const AMOUNT =
  /[¢₡]\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?|(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?\s+colones\b/g;

function amounts(text: string): { value: number; text: string }[] {
  return [...text.matchAll(AMOUNT)].map((match) => {
    const whole = (match[1] ?? match[3]).replaceAll(".", "");
    const decimals = match[2] ?? match[4];
    return {
      value: Number(decimals === undefined ? whole : `${whole}.${decimals}`),
      text: match[0],
    };
  });
}

/** The derived figures the numbered chunks resolve, as values. */
function derivedValues(
  chunks: readonly CheckedChunk[],
  figures: readonly DerivedFigure[],
): number[] {
  return figures.flatMap((figure) => {
    const states = figure.inputs.every((input) =>
      chunks.some(
        (chunk) =>
          chunk.docKey === input.docKey && chunk.articulo === input.articulo,
      ),
    );
    if (!states) return [];
    const values = Object.fromEntries(
      figure.inputs.map((input) => [input.name, input.value]),
    );
    return [evaluateFormula(figure.formula, values)];
  });
}

/** Equal to the colón, the precision every figure here is written at. */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 1;
}

const TOPE = /\btope\b/;
/**
 * The answer leaving the count to the reader or to Hacienda, which rule 3
 * asks for: «decir si llega al tope le corresponde a usted o a Hacienda,
 * porque no calculo su caso».
 */
const DEFERRAL =
  /\bno\s+(?:le\s+)?(?:calculo|multiplico|hago|digo)\b|\ble\s+corresponde\b|\bconfirm|\busted\s+o\s+hacienda\b|\bhacienda\s+o\s+usted\b|\bdeben?\s+aplicar\b|\bdecir\s+si\b/;
/**
 * The tope reached, not stated: «llegaría al tope», «alcanza ese tope», «el
 * tope es el límite». «…con ese tope de tres salarios base» beside the
 * reader's count states the rule, and is left alone.
 */
const REACHED =
  /\b(?:llega|llego|llegaria|llegado|llegar|alcanza|alcanzo|alcanzaria|alcanzado|alcanzar|supera|supero|superaria|superado|sobrepasa|sobrepasaria|excede|excederia|rebasa|rebasaria|aplicaria)\b|\btope\b[^.,;]*?\bes\s+el\b/;

/**
 * Rule 3's two slips, deterministically:
 *
 * - `product`: an amount the answer writes that equals another amount it
 *   writes, or a derived figure the chunks resolve, times a count the
 *   question gives about the reader (×12 for a year). An amount a chunk
 *   states, or a derived figure itself (the tope is 3 × the salario base), is
 *   the source's, not the reader's arithmetic.
 * - `tope`: a sentence that puts the tope next to the reader's count («para
 *   un año sin registrarse, el tope es el límite») or says «su caso» reaches
 *   or passes it, without handing the count back to the reader or Hacienda.
 *
 * `question` is the one the answer was written for: the condensed question,
 * which carries a follow-up's count («un año» from two turns back).
 */
export function readerCaseSlips(
  answer: string,
  {
    question,
    chunks,
    figures = DERIVED_FIGURES,
  }: {
    question: string;
    chunks: readonly CheckedChunk[];
    figures?: readonly DerivedFigure[];
  },
): ReaderCaseSlip[] {
  const counts = readerCounts(question);
  if (counts.length === 0) return [];
  const slips: ReaderCaseSlip[] = [];
  const derived = derivedValues(chunks, figures);
  const sourced = [
    ...derived,
    ...chunks.flatMap((chunk) =>
      amounts(chunk.content ?? "").map((a) => a.value),
    ),
  ];
  const written = amounts(answer);
  const bases = [...written.map((a) => a.value), ...derived];
  const multipliers = [...new Set(counts.flatMap((c) => c.multipliers))];
  const phrases = counts.flatMap((c) => c.phrases);
  for (const sentence of sentences(answer)) {
    for (const product of amounts(sentence)) {
      if (sourced.some((value) => sameAmount(value, product.value))) continue;
      const hit = bases.flatMap((base) =>
        multipliers
          .filter((n) => sameAmount(base * n, product.value))
          .map((n) => ({ base, n })),
      )[0];
      if (hit === undefined) continue;
      const base = written.find((a) => sameAmount(a.value, hit.base));
      slips.push({
        kind: "product",
        sentence,
        detail: `${base?.text ?? hit.base} × ${hit.n} = ${product.text}`,
      });
    }
    const folded = fold(sentence);
    if (!TOPE.test(folded) || DEFERRAL.test(folded)) continue;
    const phrase = phrases.find((p) => new RegExp(`\\b${p}\\b`).test(folded));
    if (!REACHED.test(folded)) continue;
    if (phrase !== undefined || /\bsu caso\b/.test(folded)) {
      slips.push({ kind: "tope", sentence, detail: phrase ?? "su caso" });
    }
  }
  return slips;
}

/** One case's checks, as a lane hands them to the two functions below. */
export interface CheckedCase {
  id: string;
  /** `null` when there was nothing to check: a fixed-text decline. */
  checks: AnswerChecks | null;
}

/**
 * `chunks` is the numbered list the prompt showed; the answer's markers pick
 * from it. `question` is the one the answer was written for (the condensed
 * question); without it the #546 check has no count to read, and is not run.
 */
export function checkAnswer(
  answer: string,
  chunks: readonly CheckedChunk[],
  question?: string,
): AnswerChecks {
  return {
    absence: detectAbsenceClaims(answer, {
      cited: citedChunks(answer, chunks),
      coverage: COMMITTED_COVERAGE,
    }),
    typos: typoRuns(answer),
    ...(question === undefined
      ? {}
      : { readerCase: readerCaseSlips(answer, { question, chunks }) }),
  };
}

/**
 * The hard zero: a case whose answer claims absent what the corpus carries
 * fails whatever the judge said. The judge cannot see it — it reads the same
 * fragments the model did — so its pass is kept in `verdicts` and only the
 * case's verdict and reason change.
 */
export function withAbsenceGate<T extends { verdict: Verdict; reason: string }>(
  judged: T,
  checks: AnswerChecks | null,
): T {
  const claims = checks?.absence.falseClaims ?? [];
  if (claims.length === 0) return judged;
  return {
    ...judged,
    verdict: "fail",
    reason:
      `false corpus-absence claim (#500): ` +
      claims.map((claim) => claim.target).join("; "),
  };
}

/** Every false absence claim in `rows`, one line each: the lanes' zero gate. */
export function falseAbsenceFailures(rows: readonly CheckedCase[]): string[] {
  return rows.flatMap(({ id, checks }) =>
    (checks?.absence.falseClaims ?? []).map((claim) =>
      describeFalseAbsence(id, claim),
    ),
  );
}

/**
 * A lane's console block: the false absence claims (each already a failed
 * case), then what is reported and never gated — answers that open with an
 * absence claim, typo runs, and the reader's case worked out. Rows with
 * `null` checks (weak-retrieval declines, a fixed text) are left out of every
 * count.
 */
export function formatAnswerChecks(rows: readonly CheckedCase[]): string {
  const checked = rows.flatMap(({ id, checks }) =>
    checks === null ? [] : [{ id, checks }],
  );
  const claims = falseAbsenceFailures(checked);
  const openings = checked.filter(({ checks }) => checks.absence.opening);
  const typos = checked.filter(({ checks }) => checks.typos.length > 0);
  const readerCase = checked.flatMap(({ id, checks }) =>
    (checks.readerCase ?? []).map((slip) => `${id} (${slip.kind})`),
  );
  return [
    `false absence claims (#500): ${claims.length}`,
    ...claims.map((claim) => `  ${claim}`),
    `opens with an absence claim (reported): ${openings.length}/${checked.length}` +
      (openings.length > 0 ? ` — ${openings.map((c) => c.id).join(", ")}` : ""),
    `typo runs (reported): ${typos.length}` +
      (typos.length > 0
        ? ` — ${typos.map((c) => `${c.id} (${c.checks.typos.join(", ")})`).join("; ")}`
        : ""),
    `reader's case worked out (#546, reported): ${readerCase.length}` +
      (readerCase.length > 0 ? ` — ${readerCase.join(", ")}` : ""),
  ].join("\n");
}
