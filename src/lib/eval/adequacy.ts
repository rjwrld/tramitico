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
import { generateText } from "ai";
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
 * Answers and dataset literals both spell figures with whatever space the
 * source used — "13 %" arrives with U+00A0 as often as with a plain space —
 * so both sides are normalized before they meet. Nothing else is touched:
 * digits, currency signs and separators must match as written.
 */
function normalizeSpaces(text: string): string {
  return text.replace(/[   ]/g, " ");
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
 * Whether any occurrence of any variant is followed, before the end of its
 * sentence, by a citation marker.
 *
 * The window is the sentence, not the whole answer, because an answer-wide
 * search would let a citation on an unrelated paragraph vouch for a figure
 * that carries none — which is precisely the shape #131 exists to stop from
 * shipping and #261 req. 3 exists to stop from scoring.
 */
export function checkLiteral(
  answer: string,
  variants: readonly string[],
): { found: boolean; cited: boolean } {
  const haystack = normalizeSpaces(answer);
  let found = false;
  for (const variant of variants) {
    const needle = normalizeSpaces(variant);
    if (needle === "") continue;
    const pattern = new RegExp(escapeRegExp(needle), "gi");
    for (const match of haystack.matchAll(pattern)) {
      found = true;
      const rest = haystack.slice(match.index + match[0].length);
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
export function parseAdequacyReport(
  text: string,
  count: number,
): RequirementVerdict[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `adequacy judge output has no JSON object: ${text.slice(0, 200)}`,
    );
  }
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

const realAdequacyJudgeOnce: AdequacyJudgeOnce = async (
  question,
  requirements,
  answer,
) => {
  const { text } = await generateText({
    model: getJudgeModel(),
    system: ADEQUACY_SYSTEM_PROMPT,
    prompt: buildAdequacyPrompt(question, requirements, answer),
    temperature: JUDGE_TEMPERATURE,
  });
  return parseAdequacyReport(text, requirements.length);
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
 * A refusal has no fragments behind it, so any figure it prints was invented
 * by the model. Deliberately narrow: it matches money and percentages, not
 * every integer, because "artículo 5" and "20 días hábiles" are the kind of
 * thing an honest routing sentence legitimately carries.
 */
export function figureMentions(answer: string): string[] {
  const text = normalizeSpaces(answer);
  const matches = [
    ...text.matchAll(/(?:¢|₡)\s?\d+(?:[.,]\d+)*/g),
    ...text.matchAll(/\d+(?:[.,]\d+)?\s?%/g),
  ].map((match) => match[0].trim());
  return [...new Set(matches)];
}
