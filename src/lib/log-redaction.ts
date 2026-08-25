/**
 * The one way to put a caught error into an operational log (issue #136,
 * privacy contract from #121).
 *
 * A question is the most sensitive thing this app handles — someone asks how
 * to fix an unfiled D-101 in their own words — and until this module existed
 * it leaked into logs by accident rather than by design. Three routes for it:
 * `retrieval.ts` interpolated the query straight into a thrown message, a
 * Postgres/PostgREST error can quote the offending row (which *is* the
 * question, on the `questions` insert), and a provider error can echo the
 * prompt it rejected — and the prompt carries the question. Every one of
 * those reached a `console.error` through `String(error)` or `error.message`.
 *
 * So the rule here is a whitelist, not a scrub: an error's free text is never
 * logged at all. What comes out is its *identity* — constructor name, `name`
 * when it adds something, a short opaque `code`/`status`, and the same again
 * for its `cause`. That is enough to tell a 429 from a socket reset from a
 * unique-violation, and there is no path by which a question reaches it.
 *
 * Context that used to live in the message goes in the error's *class name*
 * instead (see `SearchChunksError` in retrieval.ts): a name is ours, a
 * message may not be.
 *
 * Format — one whitespace-free token, so it drops into the existing
 * `key=value` log lines (`error=${describeError(err)}`) without changing the
 * prefixes #141 will count on:
 *
 *     Error
 *     DOMException.TimeoutError
 *     PostgrestError#42883
 *     SearchChunksError<Object#42883>
 */

/**
 * What a class name, `name` or `code` may look like to be logged verbatim.
 * No whitespace and no non-ASCII, which is what makes it a poor hiding place
 * for a question: Spanish prose carries spaces, accents and `¿` within the
 * first few characters. Anything else becomes `redacted` rather than being
 * trusted because of where it was found.
 */
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,48}$/;

/** Stands in for a field whose value did not look like an identifier. */
export const REDACTED = "redacted";

/** How far down the `cause` chain to walk before saying "more below". */
const MAX_CAUSE_DEPTH = 3;

function safe(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || value === "") return null;
  return SAFE_TOKEN.test(value) ? value : REDACTED;
}

/**
 * The short opaque identifier an error carries, if it carries one: SQLSTATE
 * on a Postgres error, `ETIMEDOUT` on a socket, an HTTP status on a provider
 * call. Deliberately not `details`, `hint` or `message` — all three quote
 * input on at least one of our dependencies.
 */
function codeOf(error: object): string | null {
  const record = error as Record<string, unknown>;
  for (const field of ["code", "status", "statusCode"] as const) {
    const token = safe(record[field]);
    if (token !== null) return token;
  }
  return null;
}

function classOf(error: object): string {
  const name = safe(
    (error as { constructor?: { name?: unknown } }).constructor?.name,
  );
  return name ?? "object";
}

function describe(error: unknown, depth: number, seen: Set<object>): string {
  if (error === null) return "null";
  if (typeof error !== "object") return typeof error;
  if (seen.has(error)) return "cycle";
  seen.add(error);

  let token = classOf(error);

  // `name` only when it says something the constructor did not: every
  // `DOMException` is a `DOMException`, but only some are `TimeoutError`.
  // A subclass that never set `this.name` inherits the bare "Error", which
  // adds nothing to the class name already in hand.
  const name = safe((error as { name?: unknown }).name);
  if (name !== null && name !== token && name !== "Error") token += `.${name}`;

  const code = codeOf(error);
  if (code !== null) token += `#${code}`;

  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) {
    token +=
      depth >= MAX_CAUSE_DEPTH
        ? "<...>"
        : `<${describe(cause, depth + 1, seen)}>`;
  }
  return token;
}

/**
 * A caught value as a log-safe token. Total: an exotic thrown value, a Proxy
 * that throws on property access, a getter with a side effect — none of them
 * may take down the error path that is already handling a failure.
 */
export function describeError(error: unknown): string {
  try {
    if (error === undefined) return "undefined";
    return describe(error, 0, new Set());
  } catch {
    return "unknown";
  }
}
