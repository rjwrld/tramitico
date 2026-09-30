/**
 * Frozen rewrites for a comparison run (#457).
 *
 * Two identical full-lane arms of 2026-09-28 put the same chunk list in front
 * of the model on only 11 of 27 Tier 1 cases. #457 measured where that comes
 * from with `pnpm answer-set-probe` (eval/README.md): the text the
 * pipeline's two small-model calls write — the expansion (#286) on every
 * case, the condensation (#132) on a follow-up — differs from run to run
 * although both calls already send `temperature: 0`, and every stage after
 * it inherits the difference. Replaying one run's rewrites in another put
 * the same answer set in front of the model on 62 of the 63 cases where no
 * Voyage call was dropped.
 *
 * So a comparison can pin them. `EVAL_REWRITES=<file>` names the rewrites an
 * earlier `pnpm answer-set-probe` recorded, and the lanes that retrieve
 * (groundedness, abstention, hit-rate) run each case on its recorded query
 * and expansion instead of asking Haiku again. Both arms of an A/B set it to
 * the same file; the difference between them is then the change, not the
 * draw. Unset — the default — every lane runs live, which is what production
 * does and what a gate run measures.
 *
 * What it does not pin: the Voyage embeddings (not bit-identical run to run,
 * which moved one answer set in 63) and a rerank reading Voyage rejects
 * under load (the probe counts those per case).
 */
import { readFileSync } from "node:fs";
import { condenseQuestion } from "../answer/condense";
import type { QueryExpander } from "../retrieval";
import type { EvalCase } from "./dataset";

/** The env var naming a frozen rewrites file. */
export const REWRITES_ENV = "EVAL_REWRITES";

/** What the pipeline's two small-model calls wrote for one case. */
export interface CaseRewrites {
  /** The standalone question: the case's own, or a follow-up's condensation. */
  query: string;
  /** The corpus-register expansion (#286), null when there was none. */
  expansion: string | null;
}

/**
 * The rewrites an answer-set probe recorded, by case id. `source` names the
 * file in the error a run that predates #457 gets: it recorded answer sets
 * and nothing a lane could replay.
 */
export function parseRewrites(
  text: string,
  source: string,
): Map<string, CaseRewrites> {
  const { reads } = JSON.parse(text) as {
    reads: { id: string; query?: unknown; expansion?: unknown }[];
  };
  const rewrites = new Map<string, CaseRewrites>();
  for (const { id, query, expansion } of reads) {
    if (
      typeof query !== "string" ||
      (typeof expansion !== "string" && expansion !== null)
    ) {
      throw new Error(
        `${source} recorded no rewrites for ${id}: an answer-set probe run ` +
          `from before #457 carries answer sets only`,
      );
    }
    rewrites.set(id, { query, expansion });
  }
  return rewrites;
}

/**
 * The file `EVAL_REWRITES` names, parsed — or `null` when it is unset, which
 * means live. Says so on the console when it is set: a run's log must show
 * that its rewrites were not its own.
 */
export function rewritesFromEnv(): Map<string, CaseRewrites> | null {
  const file = process.env[REWRITES_ENV];
  if (!file) return null;
  const rewrites = parseRewrites(readFileSync(file, "utf8"), file);
  console.log(
    `\n${REWRITES_ENV}: ${rewrites.size} cases' query and expansion replayed from ${file}`,
  );
  return rewrites;
}

/** What a lane runs one case on. */
export interface RewrittenCase {
  /** The standalone question retrieval, the rerank and the prompt read. */
  query: string;
  /** The condensation alone, null when the pipeline ran the question itself. */
  condensed: string | null;
  /**
   * `retrieve`'s expansion seam: the recorded expansion when frozen,
   * `undefined` (the production expander) when live.
   */
  expander: QueryExpander | undefined;
}

/**
 * A case's rewrites: condensed live, exactly as the route does it, when
 * `frozen` is null; replayed from `frozen` otherwise. A case the frozen file
 * does not carry is an error, not a quiet fallback — a comparison that ran
 * one case live would not be one.
 */
export async function rewriteCase(
  evalCase: EvalCase,
  frozen: ReadonlyMap<string, CaseRewrites> | null,
): Promise<RewrittenCase> {
  if (frozen === null) {
    const { query, condensed } = await condenseQuestion(
      evalCase.question,
      evalCase.history ?? [],
    );
    return { query, condensed, expander: undefined };
  }
  const recorded = frozen.get(evalCase.id);
  if (recorded === undefined) {
    throw new Error(`${REWRITES_ENV} carries no rewrites for ${evalCase.id}`);
  }
  return {
    query: recorded.query,
    condensed: recorded.query === evalCase.question ? null : recorded.query,
    expander: { expand: async () => recorded.expansion },
  };
}
