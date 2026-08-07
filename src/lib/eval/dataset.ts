/**
 * Eval dataset loader + hit matcher (SPEC §9, issue #25).
 *
 * `eval/dataset.jsonl` holds 25±5 hand-written questions, each with the
 * expected source docs/artículos a correct retrieval must surface. The
 * integration eval (retrieval-hitrate.integration.test.ts) runs each question
 * through the production retrieval path and asserts the expected artículo is
 * in the answer top-k; this module is the pure part — parsing and the "does
 * this chunk satisfy this expectation" predicate — so matching semantics are
 * unit-testable without a database.
 */
import path from "node:path";

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

export interface EvalCase {
  id: string;
  /** Provenance: "appendix-a:<n>" (SPEC Appendix A) or "corpus". */
  seed: string;
  question: string;
  expected: ExpectedTarget[];
  /** Blocking cases fail the eval on their own, regardless of hit-rate. */
  blocking: boolean;
  notes?: string;
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
    if (!Array.isArray(entry.expected) || entry.expected.length === 0) {
      throw new Error(
        `eval dataset line ${i + 1} (${entry.id}): missing expected targets`,
      );
    }
    for (const target of entry.expected as ExpectedTarget[]) {
      if (typeof target.docKey !== "string" || target.docKey === "") {
        throw new Error(
          `eval dataset line ${i + 1} (${entry.id}): target missing docKey`,
        );
      }
    }
    if (seen.has(entry.id)) {
      throw new Error(`eval dataset line ${i + 1}: duplicate id ${entry.id}`);
    }
    seen.add(entry.id);
    cases.push({
      id: entry.id,
      seed: typeof entry.seed === "string" ? entry.seed : "corpus",
      question: entry.question,
      expected: entry.expected as ExpectedTarget[],
      blocking: entry.blocking === true,
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
