/**
 * Mode knobs: the environment variables that switch one pipeline stage
 * between a closed set of modes — `RERANK`, `EXPAND`, `STEPS`, `STEPS_RERANK`,
 * `PIN_DERIVED_INPUTS` (#499), `PIN_CROSS_REFERENCES` (#508).
 *
 * Production never reranked from launch until #498, because the deploy
 * wizard wrote `RERANK=on` and the reader treated anything but `voyage` as
 * off, without a word in the logs. So every mode knob reads the same way:
 *
 * - unset, or the empty string CI interpolates for an unset `vars.X`, is the
 *   default — `||`, never `??`;
 * - a value from the knob's set is that mode;
 * - **anything else is the default too, and says so**: one `console.error`
 *   on `KNOB_ERROR_PREFIX`, once per cold start, naming the knob and the
 *   modes it accepts.
 *
 * The default rather than a throw: a typo must not take the ask down, and the
 * defaults are the measured production pipeline, so a typo can no longer
 * silently degrade it either. Opting *out* of a stage takes the exact word
 * `off`, and the log line is what tells the operator the word they set was
 * not one.
 *
 * `EMBEDDINGS_PROVIDER` is the one mode knob that does not read through here:
 * `createEmbedder` already throws on a provider it does not know, and has to
 * (ingestion/embedder.ts) — a fallback there would quietly embed questions
 * with another provider, or with none.
 */

/** The stable prefix a log query matches on (docs/runbook.md). */
export const KNOB_ERROR_PREFIX = "config: unknown knob value";

/**
 * A reader for one knob. `modes` is the whole accepted set, `fallback` the
 * mode unset, empty and unknown values all read as. The reader keeps the last
 * value it reported, so a cold start logs a bad value once, not per ask.
 */
export function modeKnob<const T extends string>(
  name: string,
  modes: readonly T[],
  fallback: T,
): () => T {
  let reported: string | null = null;
  return () => {
    const raw = process.env[name] || "";
    if (raw === "") return fallback;
    const mode = modes.find((m) => m === raw);
    if (mode !== undefined) return mode;
    if (raw !== reported) {
      reported = raw;
      console.error(
        `${KNOB_ERROR_PREFIX} ${name}=${shown(raw)}; accepted: ${modes.join(" | ")}, or unset; reading it as ${fallback}`,
      );
    }
    return fallback;
  };
}

/**
 * The bad value, when it looks like a mistyped mode. Anything longer or
 * stranger could be a key pasted into the wrong variable, and a log line is
 * no place for one of those.
 */
function shown(raw: string): string {
  return /^[\w.-]{1,16}$/.test(raw)
    ? JSON.stringify(raw)
    : `(${raw.length} chars, not shown)`;
}
