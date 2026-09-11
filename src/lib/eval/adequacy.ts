/**
 * The adequacy gate (issue #130, extended by #261) — and the two checks that
 * travel with it: the deterministic figure check and the abstention judge.
 *
 * Groundedness asks "is this answer supported by the fragments?" and, by
 * design, an incomplete answer passes it: everything it says is true, it just
 * never mentioned the rate. That is #130's complaint, and this module is the
 * second question the eval has to ask — *did the answer contain what a reader
 * came for?* The two are deliberately independent. An answer can be perfectly
 * grounded and inadequate (the supported-but-rate-less CCSS answer that
 * `adequacy.eval.test.ts` pins), and an ungrounded answer that happens to
 * state every required claim is still a groundedness failure.
 *
 * Three checks, in ascending order of trust required:
 *
 * 1. `checkLiterals` — no model at all. A required claim carrying `literal`
 *    is a figure or a date, and a figure is either printed with a citation
 *    beside it or it is not. Regex, no judge, no flakiness budget.
 * 2. `judgeAdequacy` — a judge, one requirement at a time, for the claims and
 *    steps that are prose. Same pinned model, same temperature 0, same
 *    fail → re-judge → majority orchestration as `judgeAnswer`, so the two
 *    gates have the same flakiness behavior.
 * 3. `judgeAbstention` — the binary question the abstention set asks: did the
 *    answer decline *and* name the right place to go? Paired with
 *    `figureMentions`, which is the deterministic half: an abstention that
 *    prints a colón amount or a percentage has invented a figure, and no
 *    judge is needed to see it.
 *
 * The rule that makes the gate bite is not in any of the three: a
 * weak-retrieval decline on a satisfiable Tier 1 case is an adequacy failure
 * (`declineAdequacy`). Groundedness passes that decline — it claims nothing —
 * so without this the honest fallback would be a way to score full marks on a
 * question the product promised to answer.
 */
import { generateObject, generateText } from "ai";
import { z } from "zod";
import {
  getJudgeModel,
  JUDGE_TEMPERATURE,
  majorityVerdict,
  REJUDGE_COUNT,
  type Verdict,
} from "./groundedness";
import type { EvalCase, RequiredClaim } from "./dataset";

/**
 * Tier 1 is 100% per case — it is blocking, so there is no rate to set. This
 * is the Tier 2 aggregate of the trust contract (#254 §A3). Ratchet up.
 */
export const ADEQUACY_TIER2_GATE = 0.8;

/** Where a requirement came from — the judge is told which it is reading. */
export type RequirementKind = "claim" | "step";

export interface Requirement {
  kind: RequirementKind;
  text: string;
}

/**
 * The prose requirements of a case: every step, and every claim that is not
 * already covered by a deterministic literal check. A claim with `literal` is
 * checked by regex and never reaches the judge — asking a model whether "13 %"
 * appears in a string it can read is spending money on a worse `includes`.
 */
export function judgedRequirements(evalCase: EvalCase): Requirement[] {
  const claims = (evalCase.requiredClaims ?? [])
    .filter((claim) => claim.literal === undefined)
    .map((claim): Requirement => ({ kind: "claim", text: claim.claim }));
  const steps = (evalCase.requiredSteps ?? []).map((text): Requirement => ({
    kind: "step",
    text,
  }));
  return [...claims, ...steps];
}

// ---------------------------------------------------------------------------
// 1. Deterministic figure/date checks (#261 req. 3)
// ---------------------------------------------------------------------------

/**
 * Sentence end, for the "is the figure cited?" window. `\s` after the
 * punctuation is load-bearing: "¢462.200" and "45333-H" carry dots and dashes
 * that are not sentence ends, and treating them as ones would cut the window
 * before the marker that follows the figure.
 */
const SENTENCE_END = /[.;:!?](?=\s|$)|\n/;
const CITATION_MARKER = /\[\d+\]/;

/**
 * A "." or "," standing *between two digits* — the decimal or thousands
 * separator inside a figure, never the period that ends a sentence.
 */
const FIGURE_SEPARATOR = /(?<=\d)[.,](?=\d)/g;

/**
 * Answers and dataset literals both spell figures with whatever the source
 * used, so both sides are normalized before they meet. Two normalizations,
 * one rule — a figure is the digits, not the typography around them:
 *
 * - Spaces: "13 %" arrives with U+00A0 as often as with a plain space.
 * - Separators (#289): the CCSS actas print every rate with a period
 *   ("2.89%", "0.9295 SM", "6.24%") and prompt rule 3 forbids the model from
 *   rewriting a figure it was handed, so an answer quoting the acta faithfully
 *   could never match a dataset literal written the Spanish way with a comma.
 *   That is a transcription check, not an adequacy one, and it marked five
 *   satisfiable claims "absent" in the 2026 baseline.
 *
 * Nothing else is touched: digits, currency signs and word order must match as
 * written, and a period that is not between digits stays a sentence end — the
 * citation window depends on it.
 *
 * The known limit, stated because a deterministic check is only worth what it
 * is trusted for: collapsing the two characters also erases which one meant
 * *decimal* and which meant *thousands*, so "1.234" and "1,234" — 1234 and one
 * point two three four — normalize alike. Widening a check always widens what
 * it accepts, and here that is a deliberate trade: a literal whose separator
 * is followed by exactly three digits ("¢462.200") now also matches the same
 * digits grouped the other way ("¢462,200"), which in a Costa Rican answer is
 * that figure mistyped rather than a different one. The narrower reading — the
 * one that would make the two genuinely different values — is not a reading
 * this corpus produces. If a case ever needs to tell 1.234 from 1,234, this
 * must learn the two roles apart before its verdict means anything.
 */
function normalizeSpaces(text: string): string {
  return text.replace(/[   ]/g, " ");
}

/** …and the separator collapse on top, for the two sides of a literal check. */
function normalizeFigures(text: string): string {
  return normalizeSpaces(text).replace(FIGURE_SEPARATOR, ".");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface LiteralCheck {
  claim: string;
  variants: readonly string[];
  /** One of the accepted spellings appears in the answer. */
  found: boolean;
  /** …and at least one occurrence carries a [n] before its sentence ends. */
  cited: boolean;
}

/**
 * A markdown table row, in the form prompt rule 11 dictates — «tablas simples
 * con barras verticales (| columna | columna |)». Markdown's pipe-less variant
 * ("Tramo | Tarifa") is deliberately not matched: recognising a row by "has a
 * pipe in it" would let a prose sentence carrying one borrow a citation from
 * elsewhere, and for this check the two errors are not symmetric — missing a
 * cited figure fails loudly and gets read, while vouching for an uncited one
 * passes silently, which is the whole thing #131 and #261 req. 3 exist to
 * prevent. `adequacy.test.ts` pins the limit.
 */
const TABLE_ROW = /^\s*\|/;

/**
 * The citation window for a figure whose line is a table row: the rest of the
 * table, plus the sentence that closes it.
 *
 * Rule 10 tells the answer to use a table «cuando los datos sean realmente
 * tabulares, como tramos, plazos o montos» — precisely the figures this check
 * scores — and an answer that does so cites the table around it, not inside
 * every cell. Since a row ends in a newline and `SENTENCE_END` stops there, a
 * figure in a cell could never be scored as cited however well the answer
 * cited its table: the prompt asked for tables and the check forbade them
 * (#289, found by a smoke run on `ho-800-mil-que-porcentaje-caja`).
 *
 * The widening is scoped to figures *inside* a table. A figure in ordinary
 * prose keeps the sentence window, so a cited table cannot vouch for the
 * uncited paragraph above it.
 */
function tableWindow(rest: string): string {
  const lines = rest.split("\n");
  // lines[0] is the tail of the row the match sits on; the row itself began
  // before the match, so the caller has already established it is a table row.
  let i = 1;
  while (i < lines.length && TABLE_ROW.test(lines[i]!)) i += 1;
  // …then the closing prose, up to its first sentence end: an answer captions
  // its table immediately, and anything further is a different claim. The
  // blank lines between table and caption are a paragraph break rather than
  // distance, so they are stepped over — what bounds the window is the first
  // sentence after the table, not how much whitespace precedes it.
  while (i < lines.length && lines[i]!.trim() === "") i += 1;
  const after = lines.slice(i).join("\n");
  const end = after.search(SENTENCE_END);
  return (
    lines.slice(0, i).join("\n") +
    "\n" +
    (end === -1 ? after : after.slice(0, end))
  );
}

/**
 * The sentence that introduces a table, for a figure sitting inside it.
 *
 * `tableWindow` looks forward, on the reading that an answer captions its
 * table immediately after it. Spanish prose puts the caption first at least
 * as often — «Los tramos vigentes para 2026 son los siguientes [3]:» and then
 * the rows — and #289's own baseline recorded the consequence: the tramos of
 * `ho-minimo-renta-2026` scored "present but uncited" against an answer that
 * had cited its table, just on the other side. So the window for a figure in
 * a cell is the lead-in *and* the table and its caption; a figure in ordinary
 * prose keeps the sentence window, which is what stops a cited table from
 * vouching for the paragraph above it.
 */
function tableLeadIn(haystack: string, index: number): string {
  const before = haystack.slice(0, index).split("\n");
  let i = before.length - 1;
  while (i > 0 && TABLE_ROW.test(before[i - 1]!)) i -= 1;
  // The blank line between a paragraph and the table it introduces is a
  // paragraph break, not distance — the same step `tableWindow` makes.
  while (i > 0 && before[i - 1]!.trim() === "") i -= 1;
  if (i === 0) return "";
  const lead = before[i - 1]!;
  // Its last sentence only: an earlier sentence in the same paragraph is a
  // different claim, and its citation does not reach the table.
  const ends = [...lead.matchAll(/[.;:!?](?=\s)/g)];
  const lastEnd = ends.at(-1);
  return lastEnd === undefined ? lead : lead.slice(lastEnd.index + 1);
}

/** Whether the line `index` falls on is a markdown table row. */
function onTableRow(haystack: string, index: number): boolean {
  const lineStart = haystack.lastIndexOf("\n", index - 1) + 1;
  return TABLE_ROW.test(haystack.slice(lineStart, index));
}

/**
 * Whether any occurrence of any variant is followed, before the end of its
 * sentence, by a citation marker.
 *
 * The window is the sentence, not the whole answer, because an answer-wide
 * search would let a citation on an unrelated paragraph vouch for a figure
 * that carries none — which is precisely the shape #131 exists to stop from
 * shipping and #261 req. 3 exists to stop from scoring. The one exception is
 * a figure in a table row; see `tableWindow`.
 */
export function checkLiteral(
  answer: string,
  variants: readonly string[],
): { found: boolean; cited: boolean } {
  const haystack = normalizeFigures(answer);
  let found = false;
  for (const variant of variants) {
    const needle = normalizeFigures(variant);
    if (needle === "") continue;
    const pattern = new RegExp(escapeRegExp(needle), "gi");
    for (const match of haystack.matchAll(pattern)) {
      found = true;
      const rest = haystack.slice(match.index + match[0].length);
      if (onTableRow(haystack, match.index)) {
        const window =
          tableLeadIn(haystack, match.index) + "\n" + tableWindow(rest);
        if (CITATION_MARKER.test(window)) {
          return { found: true, cited: true };
        }
        continue;
      }
      const end = rest.search(SENTENCE_END);
      const window = end === -1 ? rest : rest.slice(0, end);
      if (CITATION_MARKER.test(window)) return { found: true, cited: true };
    }
  }
  return { found, cited: false };
}

/** One row per required claim that declares `literal`; judged claims skipped. */
export function checkLiterals(
  answer: string,
  claims: readonly RequiredClaim[],
): LiteralCheck[] {
  return claims
    .filter((claim) => claim.literal !== undefined)
    .map((claim) => {
      const variants = claim.literal as string[];
      return {
        claim: claim.claim,
        variants,
        ...checkLiteral(answer, variants),
      };
    });
}

/** The failing rows, rendered for an assertion message. */
export function literalFailures(checks: readonly LiteralCheck[]): string[] {
  return checks
    .filter((check) => !check.cited)
    .map(
      (check) =>
        `${check.claim} (${check.variants.join(" | ")}: ` +
        `${check.found ? "present but uncited" : "absent"})`,
    );
}

// ---------------------------------------------------------------------------
// 2. The adequacy judge (#130)
// ---------------------------------------------------------------------------

export const ADEQUACY_SYSTEM_PROMPT = `You are a strict adequacy judge for a Costa Rican tax/trámite assistant. You are given a user question, a numbered list of requirements the answer had to satisfy, and the assistant's answer (in Spanish).

For each numbered requirement, decide one thing: does the answer actually state it?

Rules:
- Judge presence, not support. Whether a statement is backed by an official fragment is a different judge's job; here an unsupported statement of the requirement still counts as present.
- Paraphrase counts. The answer need not use the requirement's wording, and a figure written differently ("trece por ciento" for "13 %") counts.
- A requirement is absent if the answer only alludes to it ("hay un plazo", "se paga una cuota") without stating the substance the requirement names.
- An answer that declines — saying it finds no official basis and referring the user elsewhere — satisfies no requirement.
- Requirements marked [step] are next steps the reader must be able to act on: naming the portal, form, place or deadline. A step is present only if the answer tells the reader what to do, not merely that something must be done.

Respond with only a JSON object, no other text:
{"items": [{"index": 1, "present": true, "reason": "<one short sentence>"}, …]}
Include exactly one entry per requirement, in order.`;

export function buildAdequacyPrompt(
  question: string,
  requirements: readonly Requirement[],
  answer: string,
): string {
  const list = requirements
    .map((req, i) => `${i + 1}. [${req.kind}] ${req.text}`)
    .join("\n");
  return (
    `Pregunta:\n${question}\n\n` +
    `Requisitos:\n${list}\n\n` +
    `Respuesta del asistente:\n${answer}`
  );
}

export interface RequirementVerdict {
  index: number;
  present: boolean;
  reason: string;
}

/**
 * Extract the judge's per-requirement report. Like `parseJudgeVerdict` it
 * tolerates fences and surrounding prose, and throws on anything malformed —
 * including a report that skips, repeats or invents an index, since a judge
 * that answered about four of five requirements must not be read as four
 * passes and a silence.
 */
/**
 * The first balanced `{…}` in `text`, or null.
 *
 * A greedy `/\{[\s\S]*\}/` runs to the *last* brace in the response, so a
 * judge that prints its object and then a sentence containing a brace hands
 * the parser the object plus that prose, and `JSON.parse` fails on text that
 * had a perfectly good object at the front of it. Counting depth — and
 * skipping braces inside strings, where a `reason` may quote one — takes the
 * object and stops.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function parseAdequacyReport(
  text: string,
  count: number,
): RequirementVerdict[] {
  const object = firstJsonObject(text);
  if (object === null) {
    throw new Error(
      `adequacy judge output has no JSON object: ${text.slice(0, 200)}`,
    );
  }
  const match = [object];
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch (cause) {
    throw new Error(
      `adequacy judge output is malformed JSON: ${match[0].slice(0, 200)}`,
      { cause },
    );
  }
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length !== count) {
    throw new Error(
      `adequacy judge must report exactly ${count} item(s): ${match[0].slice(0, 200)}`,
    );
  }
  const seen = new Set<number>();
  return items.map((item) => {
    const entry = item as {
      index?: unknown;
      present?: unknown;
      reason?: unknown;
    };
    if (
      typeof entry.index !== "number" ||
      !Number.isInteger(entry.index) ||
      entry.index < 1 ||
      entry.index > count ||
      seen.has(entry.index)
    ) {
      throw new Error(
        `adequacy judge item has a bad index: ${JSON.stringify(item)}`,
      );
    }
    seen.add(entry.index);
    if (typeof entry.present !== "boolean") {
      throw new Error(
        `adequacy judge item needs a boolean "present": ${JSON.stringify(item)}`,
      );
    }
    return {
      index: entry.index,
      present: entry.present,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    };
  });
}

/** A case is adequate only when every requirement is present — no rate. */
export function reportVerdict(items: readonly RequirementVerdict[]): Verdict {
  return items.every((item) => item.present) ? "pass" : "fail";
}

/** The requirements a report marks absent, in the order they were asked. */
export function missingRequirements(
  requirements: readonly Requirement[],
  items: readonly RequirementVerdict[],
): string[] {
  return [...items]
    .sort((a, b) => a.index - b.index)
    .filter((item) => !item.present)
    .map((item) => requirements[item.index - 1]?.text ?? `#${item.index}`);
}

export interface AdequacyOutcome {
  verdict: Verdict;
  /** One entry per judge call: 1 normally, 1 + REJUDGE_COUNT after a fail. */
  verdicts: Verdict[];
  missing: string[];
}

/** One adequacy judge call. Injectable so the orchestration is unit-testable. */
export type AdequacyJudgeOnce = (
  question: string,
  requirements: readonly Requirement[],
  answer: string,
) => Promise<RequirementVerdict[]>;

/**
 * The report's shape, handed to the provider rather than asked for in prose.
 *
 * The judge is run at temperature 0, so an unreadable reply is not bad luck
 * to be retried away — it is the same reply every time. Observed 2026-09-05:
 * three identical attempts, each closing `items` with `}` instead of `]`.
 * Constraining the output removes that whole class; `MALFORMED_RETRIES`
 * stays as the net under the semantic checks the schema cannot express.
 */
export const ADEQUACY_REPORT_SCHEMA = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      present: z.boolean(),
      reason: z.string(),
    }),
  ),
});

/**
 * How many times one judge call is re-asked when its *output* cannot be read.
 *
 * A judgement that does not parse is not a verdict, and until this existed it
 * was worse than that: `parseAdequacyReport` threw, the throw left
 * `judgeAdequacy`, left the suite's `beforeAll`, and skipped every test in
 * the file. One unlucky response therefore destroyed a whole paid run —
 * observed 2026-09-05, 222 s of answers lost to a single report that broke at
 * character 798. Re-asking is what the judge already does for a *failing*
 * verdict (`REJUDGE_COUNT`); this is the same move for an unreadable one, and
 * it keeps the strictness of the parser: a report that skips or invents an
 * index is still rejected, it is just rejected without taking the run with it.
 */
export const MALFORMED_RETRIES = 2;

const realAdequacyJudgeOnce: AdequacyJudgeOnce = async (
  question,
  requirements,
  answer,
) => {
  let last: unknown;
  for (let attempt = 0; attempt <= MALFORMED_RETRIES; attempt++) {
    // The call is *inside* the try, not in front of it: `generateObject`
    // rejects with `AI_NoObjectGeneratedError` when the provider cannot meet
    // the schema, and a rejection outside the loop would leave the run
    // exactly as fragile as the throw this retry exists to absorb.
    // Declared out here so the catch can log a report that parsed as JSON
    // and failed the index checks; a rejection from `generateObject` never
    // gets that far and leaves it empty.
    let text = "";
    try {
      const { object } = await generateObject({
        model: getJudgeModel(),
        schema: ADEQUACY_REPORT_SCHEMA,
        system: ADEQUACY_SYSTEM_PROMPT,
        prompt: buildAdequacyPrompt(question, requirements, answer),
        temperature: JUDGE_TEMPERATURE,
      });
      // Back through the parser on purpose: the schema settles the *syntax*,
      // and the parser is what still refuses a report that skips, repeats or
      // invents an index — the check that stops four answers about five
      // requirements being read as four passes and a silence.
      text = JSON.stringify(object);
      return parseAdequacyReport(text, requirements.length);
    } catch (error) {
      last = error;
      // The whole response, not the parser's 200-character preview: the one
      // thing a rerun needs is what the judge actually said.
      console.warn(
        `eval: adequacy judge output unreadable (attempt ${attempt + 1} of ` +
          `${MALFORMED_RETRIES + 1}) — ${(error as Error).message}` +
          (text === "" ? "" : `\n${text}`),
      );
    }
  }
  throw last;
};

/**
 * Judge once; on a fail re-judge REJUDGE_COUNT more times and let the majority
 * stand — `judgeAnswer`'s orchestration, for the same reason. `missing` is
 * taken from the last failing report, so a fail always carries the list of
 * what was absent. A case with no prose requirements passes without a call.
 */
export async function judgeAdequacy(
  question: string,
  requirements: readonly Requirement[],
  answer: string,
  judgeOnce: AdequacyJudgeOnce = realAdequacyJudgeOnce,
): Promise<AdequacyOutcome> {
  if (requirements.length === 0) {
    return { verdict: "pass", verdicts: [], missing: [] };
  }
  const first = await judgeOnce(question, requirements, answer);
  const verdicts: Verdict[] = [reportVerdict(first)];
  let missing = missingRequirements(requirements, first);
  if (verdicts[0] === "fail") {
    for (let i = 0; i < REJUDGE_COUNT; i++) {
      const again = await judgeOnce(question, requirements, answer);
      const verdict = reportVerdict(again);
      verdicts.push(verdict);
      if (verdict === "fail")
        missing = missingRequirements(requirements, again);
    }
  }
  const verdict = majorityVerdict(verdicts);
  return { verdict, verdicts, missing: verdict === "pass" ? [] : missing };
}

/**
 * The verdict for a case the pipeline declined on weak retrieval (#261 req. 2).
 *
 * Every requirement is missing, because the honest fallback states none of
 * them. This is a *fail* on a Tier 1 case and it is the point of the rule: the
 * satisfiability census says the corpus can answer the question, so declining
 * it is a product failure that groundedness — which passes any answer making
 * no claims — cannot see.
 */
export function declineAdequacy(
  requirements: readonly Requirement[],
): AdequacyOutcome {
  return {
    verdict: "fail",
    verdicts: [],
    missing: requirements.map((req) => req.text),
  };
}

// ---------------------------------------------------------------------------
// 3. The abstention judge (#261 req. 5)
// ---------------------------------------------------------------------------

export const ABSTENTION_SYSTEM_PROMPT = `You are judging whether a Costa Rican tax/trámite assistant correctly refused a question it must not answer. You are given the question, the reason it must be refused, the institution or professional the user should be sent to, and the assistant's answer (in Spanish).

Decide two things:
- "declined": does the answer refuse — saying it has no official basis, that the question is outside what it covers, or that the premise is wrong — instead of answering the question anyway? An answer that gives the substantive answer and adds a disclaimer has NOT declined.
- "routed": does the answer name where the user should go (the institution, or a professional such as a contador or abogado)? A generic "consulte a un experto" with no addressee is not routing; naming the expected institution, or the right one for this question, is.

Respond with only a JSON object, no other text:
{"declined": true, "routed": true, "reason": "<one short sentence>"}`;

export function buildAbstentionPrompt(
  question: string,
  answer: string,
  { abstainIf, routeTo }: { abstainIf: string; routeTo?: string },
): string {
  return (
    `Pregunta:\n${question}\n\n` +
    `Por qué debe declinar:\n${abstainIf}\n\n` +
    `A dónde debe enrutar:\n${routeTo ?? "la institución competente"}\n\n` +
    `Respuesta del asistente:\n${answer}`
  );
}

export interface AbstentionVerdict {
  declined: boolean;
  routed: boolean;
  /** Pass only when it did both — declining into a dead end helps nobody. */
  verdict: Verdict;
  reason: string;
}

export function parseAbstentionVerdict(text: string): AbstentionVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `abstention judge output has no JSON object: ${text.slice(0, 200)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch (cause) {
    throw new Error(
      `abstention judge output is malformed JSON: ${match[0].slice(0, 200)}`,
      { cause },
    );
  }
  const entry = raw as {
    declined?: unknown;
    routed?: unknown;
    reason?: unknown;
  };
  if (
    typeof entry.declined !== "boolean" ||
    typeof entry.routed !== "boolean"
  ) {
    throw new Error(
      `abstention judge needs boolean "declined" and "routed": ${match[0].slice(0, 200)}`,
    );
  }
  return {
    declined: entry.declined,
    routed: entry.routed,
    verdict: entry.declined && entry.routed ? "pass" : "fail",
    reason: typeof entry.reason === "string" ? entry.reason : "",
  };
}

export type AbstentionJudgeOnce = (
  question: string,
  answer: string,
  context: { abstainIf: string; routeTo?: string },
) => Promise<AbstentionVerdict>;

const realAbstentionJudgeOnce: AbstentionJudgeOnce = async (
  question,
  answer,
  context,
) => {
  const { text } = await generateText({
    model: getJudgeModel(),
    system: ABSTENTION_SYSTEM_PROMPT,
    prompt: buildAbstentionPrompt(question, answer, context),
    temperature: JUDGE_TEMPERATURE,
  });
  return parseAbstentionVerdict(text);
};

/** Same fail → re-judge → majority orchestration as the other two gates. */
export async function judgeAbstention(
  question: string,
  answer: string,
  context: { abstainIf: string; routeTo?: string },
  judgeOnce: AbstentionJudgeOnce = realAbstentionJudgeOnce,
): Promise<{ verdict: Verdict; verdicts: Verdict[]; reason: string }> {
  const first = await judgeOnce(question, answer, context);
  const verdicts: Verdict[] = [first.verdict];
  let reason = first.reason;
  if (first.verdict === "fail") {
    for (let i = 0; i < REJUDGE_COUNT; i++) {
      const again = await judgeOnce(question, answer, context);
      verdicts.push(again.verdict);
      if (again.verdict === "fail") reason = again.reason;
    }
  }
  return { verdict: majorityVerdict(verdicts), verdicts, reason };
}

/**
 * Colón amounts and percentages in an answer — the deterministic half of the
 * abstention contract (#254 §A3: "0 respuestas con cifra inventada").
 *
 * Deliberately narrow about *what* is a figure: money and percentages, not
 * every integer, because "artículo 5" and "20 días hábiles" are the kind of
 * thing an honest routing sentence legitimately carries.
 *
 * Two forms, because the abstention set has two routes and the word
 * "invented" does not mean the same thing on both (#290):
 *
 * - **No `sources` — the fallback route.** The decline was streamed without a
 *   model call and has no fragments behind it, so every figure in it was
 *   invented, full stop. This is the strict form, and it stays strict.
 * - **With `sources` — the model route.** The model was handed fragments, and
 *   rule 6 asks it to state the rule that *does* exist while declining the
 *   part that does not: «la tarifa vigente es del 13 % [2], y ninguna fuente
 *   fija la de 2027». Quoting a corpus figure with its citation is the
 *   contract working, not a fabrication, and counting it as one failed two
 *   passing cases in the 2026 baseline. A figure is invented here only if it
 *   appears in no source, or if it appears in one but the answer prints it
 *   without a citation — an uncited figure is unattributable whatever the
 *   corpus holds, which is the #131/#261 rule this check shares.
 *
 * `sources` is the text the answer was written from: the fragment contents,
 * plus the values of any system-derived figures handed to the prompt, which
 * are by construction in no fragment (`formatDerivedFigures`).
 */
/**
 * `normalizeFigures`, plus the space a figure is written with but not
 * identified by: "13 %" and "13%", "¢ 462.200" and "¢462.200". The answer
 * takes its spacing from prompt rule 11 and the fragment takes its from the
 * Gaceta, so a figure quoted faithfully still differs by that one character.
 * Only used to ask "is this figure in the corpus?" — the literal checks keep
 * the stricter comparison.
 */
function normalizeFigureSpacing(text: string): string {
  return normalizeFigures(text)
    .replace(/(\d)\s+%/g, "$1%")
    .replace(/(¢|₡)\s+(\d)/g, "$1$2");
}

export function figureMentions(
  answer: string,
  sources?: readonly string[],
): string[] {
  const text = normalizeSpaces(answer);
  const matches = [
    ...text.matchAll(/(?:¢|₡)\s?\d+(?:[.,]\d+)*/g),
    ...text.matchAll(/\d+(?:[.,]\d+)?\s?%/g),
  ].map((match) => match[0].trim());
  const figures = [...new Set(matches)];
  if (sources === undefined) return figures;
  const corpus = sources.map(normalizeFigureSpacing);
  return figures.filter((figure) => {
    const needle = normalizeFigureSpacing(figure);
    const inCorpus = corpus.some((source) => source.includes(needle));
    return !inCorpus || !checkLiteral(answer, [figure]).cited;
  });
}
