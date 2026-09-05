/**
 * Eval dataset loader + hit matcher (SPEC §9, issue #25).
 *
 * `eval/dataset.jsonl` holds 25±5 hand-written questions, each with the
 * expected source docs/artículos a correct retrieval must surface. The
 * integration eval (retrieval-hitrate.eval.test.ts) runs each question
 * through the production retrieval path and asserts the expected artículo is
 * in the answer top-k; this module is the pure part — parsing and the "does
 * this chunk satisfy this expectation" predicate — so matching semantics are
 * unit-testable without a database.
 *
 * Since #132 a case may also carry `history`: preceding turns that make its
 * `question` a follow-up. Those cases exist to prove the condensation step
 * earns its keep, so the eval condenses them the way the route does and then
 * runs the standalone result through the same path as every other case.
 *
 * Since #261 a case also carries its place in the coverage contract (#254
 * Part A §A3): `tier`, `family`, and — for the Tier 1 families — the
 * `requiredClaims`/`requiredSteps` an answer must actually contain. That is a
 * different question from the one `expected` asks. `expected` is about
 * retrieval: did the right artículo reach the model? Required claims are about
 * adequacy: did the answer say the things a reader came for? Groundedness sits
 * between the two and passes an answer that is supported but incomplete
 * (#130), which is exactly why the contract needs its own field here and its
 * own judge in `adequacy.ts`.
 *
 * Part B of #261 then filled that contract in: `heldOut` marks the 48 cases
 * written from the demand vocabulary of #254 Part B §B8 rather than from
 * corpus wording, and `variant` records which of the three shapes — literal,
 * colloquial, follow-up — a Tier 1 case is. The corpus-derived cases stay
 * where they are, as the retrieval regression suite they always were.
 */
import path from "node:path";
import type { ConversationTurn } from "../answer/contract";

export const DATASET_PATH = path.join(process.cwd(), "eval", "dataset.jsonl");

/**
 * One acceptable retrieval target. `articulo` omitted accepts any chunk of
 * the document (single-artículo docs like the CABYS subset or the tramos
 * decree). `pathIncludes` disambiguates artículo labels that repeat across
 * Títulos of one norma (ley-9635 has three distinct "Artículo 15"s) — it must
 * equal one of the chunk's `path` elements exactly.
 */
export interface ExpectedTarget {
  docKey: string;
  articulo?: string;
  pathIncludes?: string;
}

/**
 * Coverage tier (#254 Part B §B3). Tier 1 is the published beta promise —
 * every such case is individually blocking on hit-rate, groundedness and
 * adequacy, and a strong average never excuses a red one. Tier 2 is measured
 * but not advertised. `"abstain"` is the third kind: a case the product must
 * decline and route, which is why it is the one tier that carries no
 * `expected` retrieval targets.
 */
export type Tier = 1 | 2 | "abstain";

/** The nine Tier 1 families of the coverage contract (#254 Part B §B3). */
export const FAMILIES = [
  "T1-A",
  "T1-B",
  "T1-C",
  "T1-D",
  "T1-E",
  "T1-F",
  "T1-G",
  "T1-H",
  "T1-I",
] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * The three shapes every Tier 1 family is asked in (#261 req. 4, #254 §A5).
 * The point of the trio is that they fail differently: `literal` is the
 * question as the family names it, `coloquial` is the same need in the
 * vocabulary the demand research recorded ("meterme en Hacienda"), and
 * `seguimiento` is a follow-up that only makes sense after a previous turn,
 * so it exercises condensation (#132) rather than retrieval alone.
 */
export const VARIANTS = ["literal", "coloquial", "seguimiento"] as const;
export type Variant = (typeof VARIANTS)[number];

/**
 * One thing the answer must say. Written short and verifiable, because a
 * judge reads it one at a time: "la tarifa general del IVA es 13 %", not "the
 * answer explains IVA".
 *
 * `literal` turns the claim into a **deterministic** check instead of a judged
 * one (#261 req. 3). It lists the accepted spellings of a figure or date —
 * `["13 %", "13%"]` — one of which must appear verbatim in the answer *and*
 * carry a citation marker in the same sentence. No judge is asked about a
 * claim that has `literal`: a number is either printed or it is not, and a
 * printed number a reader cannot trace to a source is the failure mode the
 * marker requirement exists to catch. The prose `claim` still travels with it
 * for the report line.
 */
export interface RequiredClaim {
  claim: string;
  literal?: string[];
}

/** A bare string in the JSONL is the judged form of a claim. */
export type RequiredClaimEntry = string | RequiredClaim;

export interface EvalCase {
  id: string;
  /**
   * Provenance: "appendix-a:<n>" (a SPEC Appendix A seed, numbered by Tier 1
   * family since #264), "demand:<family>" (the demand taxonomy of #254),
   * "held-out:<family>" (#261 Part B) or "corpus".
   */
  seed: string;
  question: string;
  /**
   * Preceding turns, for a case whose `question` is a follow-up (#132). When
   * present, the eval condenses the two into a standalone question and runs
   * the pipeline on that — exactly as /api/ask does — so `expected` is the
   * retrieval the *condensed* question must produce. Absent on every
   * single-turn case, which is most of them.
   */
  history?: ConversationTurn[];
  /**
   * Retrieval targets. Empty only on an abstention case, which has no correct
   * source by construction — the whole point is that none exists.
   */
  expected: ExpectedTarget[];
  /** Blocking cases fail the eval on their own, regardless of hit-rate. */
  blocking: boolean;
  /** Coverage tier; defaults to 2, the tier that promises nothing. */
  tier: Tier;
  /**
   * Membership in the held-out set of #261 req. 4: 27 Tier 1 cases (nine
   * families x three variants), 12 Tier 2 and 9 abstention cases, written
   * from the demand vocabulary of #254 Part B rather than from corpus
   * wording. The flag exists because the discipline it records is not
   * visible in a question: a held-out case is one nobody may consult while
   * tuning retrieval until the #267 baseline is published, and a set nobody
   * can enumerate is a set nobody can hold out.
   */
  heldOut: boolean;
  /** Which of the three shapes this is. Required on a held-out tier 1 case. */
  variant?: Variant;
  /** Tier 1 family. Required on tier 1, absent elsewhere. */
  family?: Family;
  /** What the answer must contain (≤5). Required on tier 1. */
  requiredClaims?: RequiredClaim[];
  /** For a procedural case: the next steps the answer must give. */
  requiredSteps?: string[];
  /**
   * The condition that obliges the answer to decline. Required on an
   * abstention case, where it is what the abstention judge is told to check
   * the answer honored; optional elsewhere, where it documents the edge the
   * case does *not* cover.
   */
  abstainIf?: string;
  /** The institution or professional an abstention must name and route to. */
  routeTo?: string;
  /**
   * docKeys whose figures the answer depends on — the ones that go stale on a
   * decree cycle. Read by the freshness half of the trust contract, not by
   * the matcher.
   */
  freshness?: string[];
  notes?: string;
}

/** Cases the retrieval and groundedness lanes run: everything but abstention. */
export function retrievalCases(cases: readonly EvalCase[]): EvalCase[] {
  return cases.filter((evalCase) => evalCase.tier !== "abstain");
}

/** The held-out set (#261 req. 4), across all three tiers. */
export function heldOutCases(cases: readonly EvalCase[]): EvalCase[] {
  return cases.filter((evalCase) => evalCase.heldOut);
}

/** Cases the abstention judge runs. */
export function abstentionCases(cases: readonly EvalCase[]): EvalCase[] {
  return cases.filter((evalCase) => evalCase.tier === "abstain");
}

/** ≤5, per #261 req. 1: a longer list is a case that should have been split. */
export const MAX_REQUIRED_CLAIMS = 5;

function parseTier(where: string, raw: unknown): Tier {
  if (raw === undefined) return 2;
  if (raw === 1 || raw === 2 || raw === "abstain") return raw;
  throw new Error(`${where}: tier must be 1, 2 or "abstain"`);
}

function parseFamily(where: string, raw: unknown): Family | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !FAMILIES.includes(raw as Family)) {
    throw new Error(`${where}: family must be one of ${FAMILIES.join(", ")}`);
  }
  return raw as Family;
}

function parseVariant(where: string, raw: unknown): Variant | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !VARIANTS.includes(raw as Variant)) {
    throw new Error(`${where}: variant must be one of ${VARIANTS.join(", ")}`);
  }
  return raw as Variant;
}

function parseOptionalString(where: string, raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw === "") {
    throw new Error(`${where} must be a non-empty string`);
  }
  return raw;
}

function parseStringList(where: string, raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${where} must be a non-empty array`);
  }
  for (const item of raw) {
    if (typeof item !== "string" || item === "") {
      throw new Error(`${where} must hold non-empty strings`);
    }
  }
  return raw as string[];
}

function parseRequiredClaims(
  where: string,
  raw: unknown,
): RequiredClaim[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${where}: requiredClaims must be a non-empty array`);
  }
  if (raw.length > MAX_REQUIRED_CLAIMS) {
    throw new Error(
      `${where}: at most ${MAX_REQUIRED_CLAIMS} requiredClaims (got ${raw.length})`,
    );
  }
  return (raw as RequiredClaimEntry[]).map((entry, index) => {
    const at = `${where}: requiredClaims[${index}]`;
    if (typeof entry === "string") {
      if (entry === "") throw new Error(`${at} must be a non-empty string`);
      return { claim: entry };
    }
    const claim = parseOptionalString(`${at}.claim`, entry?.claim);
    if (claim === undefined) throw new Error(`${at} needs a claim`);
    const literal = parseStringList(`${at}.literal`, entry.literal);
    return literal === undefined ? { claim } : { claim, literal };
  });
}

export function parseDataset(jsonl: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const seen = new Set<string>();
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(lines[i]);
    } catch (cause) {
      throw new Error(`eval dataset line ${i + 1}: malformed JSON`, { cause });
    }
    const entry = raw as Partial<EvalCase> & { expected?: unknown };
    if (typeof entry.id !== "string" || entry.id === "") {
      throw new Error(`eval dataset line ${i + 1}: missing id`);
    }
    if (typeof entry.question !== "string" || entry.question === "") {
      throw new Error(
        `eval dataset line ${i + 1} (${entry.id}): missing question`,
      );
    }
    const where = `eval dataset line ${i + 1} (${entry.id})`;
    const tier = parseTier(where, (entry as { tier?: unknown }).tier);
    // An abstention case has no correct source, so demanding one would be
    // demanding the thing the case denies exists.
    const expected = (entry.expected ?? []) as ExpectedTarget[];
    if (!Array.isArray(expected)) {
      throw new Error(`${where}: expected must be an array`);
    }
    if (tier === "abstain") {
      if (expected.length > 0) {
        throw new Error(`${where}: an abstention case has no expected targets`);
      }
    } else if (expected.length === 0) {
      throw new Error(`${where}: missing expected targets`);
    }
    for (const target of expected) {
      if (typeof target.docKey !== "string" || target.docKey === "") {
        throw new Error(`${where}: target missing docKey`);
      }
    }
    if (seen.has(entry.id)) {
      throw new Error(`eval dataset line ${i + 1}: duplicate id ${entry.id}`);
    }
    seen.add(entry.id);
    const history = entry.history;
    if (history !== undefined) {
      if (!Array.isArray(history) || history.length === 0) {
        throw new Error(
          `eval dataset line ${i + 1} (${entry.id}): history must be a non-empty array`,
        );
      }
      for (const turn of history as ConversationTurn[]) {
        if (
          typeof turn?.question !== "string" ||
          turn.question === "" ||
          typeof turn?.answer !== "string" ||
          turn.answer === ""
        ) {
          throw new Error(
            `eval dataset line ${i + 1} (${entry.id}): history turn needs a question and an answer`,
          );
        }
      }
    }
    const coverage = entry as {
      heldOut?: unknown;
      variant?: unknown;
      family?: unknown;
      requiredClaims?: unknown;
      requiredSteps?: unknown;
      abstainIf?: unknown;
      routeTo?: unknown;
      freshness?: unknown;
    };
    const family = parseFamily(where, coverage.family);
    const variant = parseVariant(where, coverage.variant);
    if (
      coverage.heldOut !== undefined &&
      typeof coverage.heldOut !== "boolean"
    ) {
      throw new Error(`${where}: heldOut must be a boolean`);
    }
    const heldOut = (coverage.heldOut as boolean | undefined) ?? false;
    const requiredClaims = parseRequiredClaims(where, coverage.requiredClaims);
    const requiredSteps = parseStringList(
      `${where}: requiredSteps`,
      coverage.requiredSteps,
    );
    const freshness = parseStringList(
      `${where}: freshness`,
      coverage.freshness,
    );
    const abstainIf = parseOptionalString(
      `${where}: abstainIf`,
      coverage.abstainIf,
    );
    const routeTo = parseOptionalString(`${where}: routeTo`, coverage.routeTo);

    // Checked, not coerced: the old `entry.blocking === true` read any
    // non-`true` value as false, which would quietly swallow a hand-written
    // `"blocking": "false"` — a string, so the tier 1 guard below (strict
    // equality against the boolean) would miss it too, and a case that meant
    // to opt out would ship blocking. 45 hand-written held-out cases are
    // exactly the place that typo happens.
    if (entry.blocking !== undefined && typeof entry.blocking !== "boolean") {
      throw new Error(`${where}: blocking must be a boolean`);
    }

    // The Tier 1 contract (#254 §A3), enforced at parse time so a case cannot
    // claim the beta promise without carrying what makes it checkable.
    if (tier === 1) {
      if (family === undefined) {
        throw new Error(`${where}: a tier 1 case needs a family (T1-A…T1-I)`);
      }
      if (requiredClaims === undefined) {
        throw new Error(`${where}: a tier 1 case needs requiredClaims`);
      }
      if (entry.blocking === false) {
        throw new Error(`${where}: a tier 1 case is always blocking`);
      }
      // The three variants are the coverage claim itself (#261 req. 4): a
      // family measured only in its own words has not been shown to survive
      // the words a reader uses.
      if (heldOut && variant === undefined) {
        throw new Error(
          `${where}: a held-out tier 1 case needs a variant (${VARIANTS.join(", ")})`,
        );
      }
    }
    if (tier === "abstain") {
      if (abstainIf === undefined) {
        throw new Error(`${where}: an abstention case needs abstainIf`);
      }
      // Both halves, because the verdict has both: an abstention passes only
      // when it declined *and* routed, and without a named destination the
      // judge has nothing to check the routing against.
      if (routeTo === undefined) {
        throw new Error(`${where}: an abstention case needs routeTo`);
      }
    }

    cases.push({
      id: entry.id,
      seed: typeof entry.seed === "string" ? entry.seed : "corpus",
      question: entry.question,
      ...(history === undefined
        ? {}
        : { history: history as ConversationTurn[] }),
      expected,
      // Tier 1 is blocking by definition; anything else opts in.
      blocking: entry.blocking ?? tier === 1,
      tier,
      heldOut,
      ...(variant === undefined ? {} : { variant }),
      ...(family === undefined ? {} : { family }),
      ...(requiredClaims === undefined ? {} : { requiredClaims }),
      ...(requiredSteps === undefined ? {} : { requiredSteps }),
      ...(abstainIf === undefined ? {} : { abstainIf }),
      ...(routeTo === undefined ? {} : { routeTo }),
      ...(freshness === undefined ? {} : { freshness }),
      notes: typeof entry.notes === "string" ? entry.notes : undefined,
    });
  }
  return cases;
}

/** The slice of a retrieved chunk the matcher needs. */
export interface MatchableChunk {
  docKey: string;
  articulo: string | null;
  path: readonly string[];
}

export function chunkMatchesTarget(
  chunk: MatchableChunk,
  target: ExpectedTarget,
): boolean {
  if (chunk.docKey !== target.docKey) return false;
  if (target.articulo !== undefined) {
    if (chunk.articulo === null) return false;
    // Exact label match (not prefix — "Artículo 8" must not hit "Artículo 80");
    // case-insensitive because normas mix "Artículo"/"ARTÍCULO" casing.
    if (chunk.articulo.toLowerCase() !== target.articulo.toLowerCase()) {
      return false;
    }
  }
  if (target.pathIncludes !== undefined) {
    return chunk.path.includes(target.pathIncludes);
  }
  return true;
}

/** A case hits when any retrieved chunk satisfies any expected target. */
export function caseHit(
  chunks: readonly MatchableChunk[],
  expected: readonly ExpectedTarget[],
): boolean {
  return chunks.some((chunk) =>
    expected.some((target) => chunkMatchesTarget(chunk, target)),
  );
}
