/**
 * The Tier 1 central requirements: per case, the one required claim that
 * answers the question as the person asked it, committed as
 * `eval/tier1-central.json`. The requirement count weighs «the cuota is
 * 2,89 %» the same as the law that sets it; this count asks only whether the
 * answer said what was asked. Read off a transcript's own adequacy misses, so
 * it is free on any committed lane. Reported, never gated.
 */
import path from "node:path";
import type { AdequacyMisses } from "./adequacy";

export const CENTRAL_PATH = path.join(
  process.cwd(),
  "eval",
  "tier1-central.json",
);

/** Case id → the exact dataset text of its central claim. */
export function parseCentral(text: string): Map<string, string> {
  const raw: unknown = JSON.parse(text);
  const cases =
    typeof raw === "object" && raw !== null && "cases" in raw
      ? (raw as { cases: unknown }).cases
      : undefined;
  if (typeof cases !== "object" || cases === null || Array.isArray(cases)) {
    throw new Error("tier1-central.json must carry a `cases` object");
  }
  const central = new Map<string, string>();
  for (const [id, claim] of Object.entries(cases)) {
    if (typeof claim !== "string" || claim.length === 0) {
      throw new Error(`tier1-central.json: ${id} needs its claim's text`);
    }
    central.set(id, claim);
  }
  return central;
}

/**
 * Whether a row's adequacy read left its central claim out. A judged claim
 * is missed when `missing` lists its text; a literal-checked one when a
 * `literals` failure opens with it (`literalFailures` appends the variants).
 */
export function centralMissed(
  claim: string,
  adequacy: AdequacyMisses,
): boolean {
  return (
    adequacy.missing.includes(claim) ||
    adequacy.literals.some((failure) => failure.startsWith(`${claim} (`))
  );
}

/**
 * Central claims stated over cases read. A row without an adequacy read
 * (`null`) or without a central claim adds nothing.
 */
export function centralCoverage(
  rows: readonly { id: string; adequacy: AdequacyMisses | null }[],
  central: ReadonlyMap<string, string>,
): { stated: number; total: number; missed: string[] } {
  let stated = 0;
  let total = 0;
  const missed: string[] = [];
  for (const { id, adequacy } of rows) {
    const claim = central.get(id);
    if (claim === undefined || adequacy === null) continue;
    total += 1;
    if (centralMissed(claim, adequacy)) missed.push(id);
    else stated += 1;
  }
  return { stated, total, missed };
}

/** `literalFailures`' suffix: ` (<variants>: absent|present but uncited)`. */
const LITERAL_SUFFIX = / \([^()]*: (?:absent|present but uncited)\)$/;

/**
 * The misses a row names that its case no longer declares. A transcript
 * stores the requirement text of its day, so a claim rewritten since then
 * never matches `centralMissed` and reads as stated: a lane with any of
 * these reads high, and the count is only trusted on a clean one.
 */
export function staleMisses(
  declared: readonly string[],
  adequacy: AdequacyMisses,
): string[] {
  return [
    ...adequacy.missing,
    ...adequacy.literals.map((failure) => failure.replace(LITERAL_SUFFIX, "")),
  ].filter((text) => !declared.includes(text));
}
