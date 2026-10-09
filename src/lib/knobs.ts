/**
 * Knob readers. Mode knobs are the environment variables that switch one
 * pipeline stage between a closed set of modes — `RERANK`, `EXPAND`,
 * `STEPS`, `STEPS_RERANK`, `PIN_DERIVED_INPUTS` (#499),
 * `PIN_CROSS_REFERENCES` (#508), `PIN_NAMED_SOURCES` (#559).
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
 * `ANSWER_EFFORT` reads here too (#519), with no mode as its default: an
 * unknown effort still sends nothing, the provider default, and now says so.
 *
 * The two numeric answer-set knobs, `ANSWER_TOP_K` and `ANSWER_DOC_CAP`, read
 * by the same rules through `positiveIntKnob` (#519): a value that is not a
 * positive integer — nor one of the knob's words, `off` for the cap — is the
 * default, logged on the same prefix.
 *
 * The three daily quotas, `RATE_LIMIT_ANON`, `RATE_LIMIT_AUTHED` and
 * `RATE_LIMIT_ANON_IP`, read through `positiveIntKnob` too (#532): a quota is
 * a count of asks, so a fraction is a typo like any other. The umbrella's
 * default is derived from the anonymous quota, so it reads with a `null`
 * fallback, logged as `unset`, and rate-limit.ts supplies the multiple.
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
 * mode unset, empty and unknown values all read as — or `null` for a knob
 * whose default is no mode at all (`ANSWER_EFFORT`, which then sends
 * nothing), logged as `unset`. The reader keeps the last value it reported,
 * so a cold start logs a bad value once, not per ask.
 */
export function modeKnob<const T extends string, const F extends T | null = T>(
  name: string,
  modes: readonly T[],
  fallback: F,
): () => T | F {
  const report = logOncePerValue(name, modes.join(" | "), fallback ?? "unset");
  return () => {
    const raw = process.env[name] || "";
    if (raw === "") return fallback;
    const mode = modes.find((m) => m === raw);
    if (mode !== undefined) return mode;
    report(raw);
    return fallback;
  };
}

/**
 * A reader for one numeric knob (#519): a positive integer, as `Number` reads
 * it, or one of `words` — `{ off: Infinity }` for `ANSWER_DOC_CAP`. Unset,
 * empty and anything else read as `fallback`, the last logged once per cold
 * start exactly as `modeKnob` logs. A `null` fallback, logged as `unset`, is
 * for a knob whose default the caller derives (`RATE_LIMIT_ANON_IP`, #532).
 */
export function positiveIntKnob<F extends number | null = number>(
  name: string,
  fallback: F,
  words: Readonly<Record<string, number>> = {},
): () => number | F {
  const label = (n: number | null) =>
    n === null
      ? "unset"
      : (Object.keys(words).find((word) => words[word] === n) ?? String(n));
  const report = logOncePerValue(
    name,
    ["a positive integer", ...Object.keys(words)].join(" | "),
    label(fallback),
  );
  return () => {
    const raw = process.env[name] || "";
    if (raw === "") return fallback;
    if (Object.hasOwn(words, raw)) return words[raw];
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
    report(raw);
    return fallback;
  };
}

/**
 * Logs a knob's bad value, unless it is the one it logged last — so a cold
 * start logs it once, not per ask, and a second, different typo still shows.
 */
function logOncePerValue(
  name: string,
  accepted: string,
  readAs: string,
): (raw: string) => void {
  let reported: string | null = null;
  return (raw) => {
    if (raw === reported) return;
    reported = raw;
    console.error(
      `${KNOB_ERROR_PREFIX} ${name}=${shown(raw)}; accepted: ${accepted}, or unset; reading it as ${readAs}`,
    );
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
