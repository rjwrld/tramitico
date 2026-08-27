/**
 * The /api/ask wire contract (issues #21/#22/#57).
 *
 * The single module both sides build against: the route (#21) streams this
 * shape, the chat UI (#22) consumes it.
 *
 * - Request body: `{ question, history? }` — the newest user message's text,
 *   plus the bounded window of preceding exchanges a follow-up needs to be
 *   resolvable (#132). The server condenses the two into one standalone
 *   question; `history` is never stored.
 * - Response: an AI SDK UI message stream. Citations arrive as
 *   `data-citations` parts, each a cumulative snapshot of the deduped
 *   citations in order of use — the UI renders the latest snapshot, so
 *   sellos stamp in as the answer applies them. `data-markers` carries the
 *   chunk-index → seal-ordinal map the inline superscripts resolve against
 *   (#133), written with every citations snapshot. `data-status` parts report
 *   which pipeline stage is running, under the same snapshot rule (#71), and
 *   `data-degraded` marks an answer retrieved without its vector leg (#127).
 *   `data-unsaved` marks a delivered answer that never reached the signed-in
 *   caller's history (#139).
 * - Non-OK responses carry a JSON body `{ error, message }` where `message`
 *   is user-facing Spanish (the 429 carries the rate-limit nudge from #24).
 *   The AI SDK transport throws the raw body text; `askErrorMessage`
 *   recovers the friendly message from it.
 * - The stream opens before retrieval runs (#71), so a failure after the 200
 *   can no longer be an HTTP status. It arrives as a stream `error` part whose
 *   text is that same `{ error, message }` JSON — one envelope, one parser.
 */
import type { UIMessage } from "ai";
import type { Citation } from "@/lib/retrieval";

/**
 * One completed exchange the client may send back with a follow-up (#132).
 * Both halves are the literal text the reader saw — the server condenses
 * them into a standalone question, and nothing here is ever stored.
 */
export interface ConversationTurn {
  question: string;
  answer: string;
}

export interface AskRequestBody {
  question: string;
  /**
   * The bounded window of preceding exchanges (#132), oldest first. Absent or
   * empty on a first turn, which is exactly how the server knows to skip
   * condensation entirely. The server re-applies `boundTurns` to whatever
   * arrives — this bound is a cost guarantee, so it cannot be the client's to
   * keep.
   */
  history?: ConversationTurn[];
}

/**
 * How many preceding exchanges travel with a follow-up (#132 req. 4).
 *
 * Three, not "the conversation": the antecedent a follow-up needs is almost
 * always in the turn immediately before it, and every turn past that is
 * prompt tokens paid on every ask of every session. A fixed count is what
 * makes per-ask condensation cost flat rather than growing with the thread.
 */
export const MAX_HISTORY_TURNS = 3;

/**
 * Per-half character caps for a turn on the wire. The question cap matches
 * the route's own question limit — a prior turn was once a live question, so
 * it cannot be longer than one. The answer is truncated far harder: what
 * condensation needs from it is the subject matter ("la CCSS", "el régimen
 * simplificado"), which is established in its opening sentences, not the
 * artículo-by-artículo detail that follows.
 */
export const MAX_TURN_QUESTION_CHARS = 1_000;
export const MAX_TURN_ANSWER_CHARS = 600;

/** Cuts `text` to `max` characters on a whole word where it can. */
function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The window bound, applied identically on both sides of the wire: the last
 * `MAX_HISTORY_TURNS` exchanges, each half clamped, and anything that is not
 * a pair of non-empty strings dropped.
 *
 * The server calls this on the parsed request body rather than trusting the
 * client's own bounding: a hand-rolled POST with two hundred turns in it
 * would otherwise be a way to spend our condensation budget without limit.
 */
export function boundTurns(turns: readonly unknown[]): ConversationTurn[] {
  const bounded: ConversationTurn[] = [];
  for (const turn of turns.slice(-MAX_HISTORY_TURNS)) {
    if (typeof turn !== "object" || turn === null) continue;
    const { question, answer } = turn as Partial<ConversationTurn>;
    if (typeof question !== "string" || typeof answer !== "string") continue;
    const q = clamp(question, MAX_TURN_QUESTION_CHARS);
    const a = clamp(answer, MAX_TURN_ANSWER_CHARS);
    if (q === "" || a === "") continue;
    bounded.push({ question: q, answer: a });
  }
  return bounded;
}

/**
 * Stages the route reports while the answer is still on its way. `buscando`
 * covers retrieval + rerank, `redactando` starts when the model does, and
 * `verificando` is the citation-invariant check between a finished generation
 * and the first text on the wire (#131, #219) — a retry flips back to
 * `redactando` and earns its own `verificando`. The stream carries no stage
 * once text flows — the text is the status.
 */
export type AskStatusStage = "buscando" | "redactando" | "verificando";

/** Data parts the ask stream may carry alongside text. */
export type AskDataParts = {
  citations: Citation[];
  /**
   * Chunk index → seal ordinal (`MarkerOrdinals`, citations.ts), under the
   * same cumulative-snapshot rule as `citations`. Without it the client
   * cannot tell which seal a [n] marker belongs to — several chunks of one
   * artículo collapse into one seal — so the inline superscripts (#133) would
   * have nothing to resolve against.
   */
  markers: number[];
  status: { stage: AskStatusStage };
  /**
   * True when this answer came out of degraded retrieval (#127): the
   * embedding provider was unreachable, so only the lexical leg ran. One
   * boolean under the snapshot rule the other parts follow — the route writes
   * it once, before any text, and the UI turns it into the visible note.
   */
  degraded: boolean;
  /**
   * True when this answer was delivered but its history row was not written
   * (#139): the caller was signed in, the answer is on screen, and the save
   * failed. One boolean under the same snapshot rule, written after the
   * answer and before `finish` — the client reads it once the exchange
   * finishes and raises the non-blocking toast. Anonymous asks and successful
   * saves never carry the part at all.
   */
  unsaved: boolean;
};

export type AskUIMessage = UIMessage<never, AskDataParts>;

/** Stable `data-citations` part id — every write updates the same part. */
export const CITATIONS_PART_ID = "citations";

/** Stable `data-markers` part id — one part, superseded on every write. */
export const MARKERS_PART_ID = "markers";

/** Stable `data-degraded` part id — written at most once per answer. */
export const DEGRADED_PART_ID = "degraded";

/** Stable `data-unsaved` part id — written at most once per answer (#139). */
export const UNSAVED_PART_ID = "unsaved";

/**
 * Stable `data-status` part id. Same idempotency bargain ADR 0004 struck for
 * citations: every write is a full snapshot superseding the last, so a
 * re-emitted or reordered part can never stack two stages in the UI.
 */
export const STATUS_PART_ID = "status";

/** Concatenated text of a message's text parts. */
export function messageText(message: AskUIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * The bounded history that travels with the newest question (#132).
 *
 * Reads the thread the way the reader sees it: every user message before the
 * one being asked, paired with the assistant message that answered it. The
 * newest user message is excluded — it *is* the question — and a user message
 * with no answered assistant message after it (an ask that errored, or the
 * one in flight) contributes nothing, because a turn with half of it missing
 * is not a turn a condenser can resolve an antecedent against.
 *
 * Pure and message-shaped rather than a hook, so the unit lane can pin the
 * window without a transport (the client's `prepareSendMessagesRequest` calls
 * it and does nothing else).
 */
export function conversationTurns(
  messages: readonly AskUIMessage[],
): ConversationTurn[] {
  const asking = messages.findLastIndex((m) => m.role === "user");
  if (asking <= 0) return [];
  const turns: ConversationTurn[] = [];
  for (let i = 0; i < asking; i += 1) {
    if (messages[i].role !== "user") continue;
    const reply = messages[i + 1];
    if (!reply || reply.role !== "assistant") continue;
    turns.push({
      question: messageText(messages[i]),
      answer: messageText(reply),
    });
  }
  return boundTurns(turns);
}

/**
 * The whole request body for one ask: the newest question, plus the history
 * window when there is one (#132). A first turn carries no `history` key at
 * all rather than an empty array — "absent" is the shape the server's
 * skip-condensation branch reads, and an empty array means the same thing to
 * it, but the wire says what it means.
 */
export function askRequestBody(
  messages: readonly AskUIMessage[],
): AskRequestBody {
  const asking = messages.findLast((m) => m.role === "user");
  const question = asking ? messageText(asking) : "";
  const history = conversationTurns(messages);
  return history.length > 0 ? { question, history } : { question };
}

/** Latest citations snapshot streamed with the message; [] before any. */
export function citationsFrom(message: AskUIMessage): Citation[] {
  let latest: Citation[] = [];
  for (const part of message.parts) {
    if (part.type === "data-citations") latest = part.data;
  }
  return latest;
}

/** Latest marker→seal map streamed with the message; [] before any. */
export function markerOrdinalsFrom(message: AskUIMessage): number[] {
  let latest: number[] = [];
  for (const part of message.parts) {
    if (part.type === "data-markers") latest = part.data;
  }
  return latest;
}

/** Did this answer come out of degraded (lexical-only) retrieval? (#127) */
export function degradedFrom(message: AskUIMessage): boolean {
  let latest = false;
  for (const part of message.parts) {
    if (part.type === "data-degraded") latest = part.data;
  }
  return latest;
}

/** Did this delivered answer fail to reach the caller's history? (#139) */
export function unsavedFrom(message: AskUIMessage): boolean {
  let latest = false;
  for (const part of message.parts) {
    if (part.type === "data-unsaved") latest = part.data;
  }
  return latest;
}

/** Latest stage snapshot streamed with the message; null before any. */
export function statusFrom(message: AskUIMessage): AskStatusStage | null {
  let latest: AskStatusStage | null = null;
  for (const part of message.parts) {
    if (part.type === "data-status") latest = part.data.stage;
  }
  return latest;
}

/** Stable machine codes on the non-OK / stream-error envelope. */
export type AskErrorCode =
  | "invalid_question"
  | "rate_limited"
  | "rate_limit_unavailable"
  | "retrieval_failed"
  | "answer_failed";

/** DESIGN §9: what happened + what to do, no apology theater. */
export const ASK_FALLBACK_ERROR_MESSAGE =
  "No se pudo obtener la respuesta. Intente de nuevo.";

/**
 * The degraded-search label (#127 req. 3), DESIGN §9 voice: what happened and
 * what to do, in one quiet sentence, with no apology and no jargon about
 * embeddings. It sits with the answer rather than replacing it — the answer
 * is still cited to real documents, it just came out of a thinner search.
 */
export const DEGRADED_SEARCH_NOTE =
  "Búsqueda parcial: solo se buscó por coincidencia de texto, no por significado. Vuelva a preguntar en unos minutos para una búsqueda completa.";

/**
 * The history-save toast (#139 req. 1), DESIGN §9 voice: what happened and
 * what to do, in usted, with no apology theater. It names the one thing the
 * reader can act on — the answer is in front of them and will not be there
 * later — rather than offering a "Reintentar" we cannot honour, since the
 * exchange is finished and re-asking would spend another quota slot.
 *
 * A toast rather than anything inline: nothing about the answer is wrong, so
 * nothing about the answer should change. The issue's draft wording is tuteo;
 * every other surface here says usted, so this does too.
 */
export const HISTORY_SAVE_FAILED_NOTE =
  "No se pudo guardar en su historial. Copie la respuesta si la necesita después.";

export const RETRIEVAL_FAILED_MESSAGE =
  "No se pudo buscar en los documentos oficiales. Intente de nuevo en unos minutos.";

/**
 * Body of a failure the client renders inline: `error` is the machine code,
 * `message` the user-facing Spanish.
 */
export interface AskErrorBody {
  error: AskErrorCode;
  message: string;
}

/**
 * Text for a mid-stream `error` part. Encoded as the non-OK JSON body so the
 * one path that already recovers our Spanish copy — `askErrorMessage`, which
 * the client feeds from the transport's thrown Error — also covers failures
 * that happen after the 200. Raw prose here would be indistinguishable from a
 * leaked provider message and would fall through to the generic line.
 */
export function askStreamErrorText(
  code: AskErrorCode,
  message: string,
): string {
  return JSON.stringify({ error: code, message } satisfies AskErrorBody);
}

/**
 * User-facing Spanish for a failed ask. The transport surfaces the response
 * body as the Error message; anything without our `{ message }` shape (proxy
 * HTML, network failures) falls back to the generic line.
 */
export function askErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      const body: unknown = JSON.parse(error.message);
      if (
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string" &&
        body.message !== ""
      ) {
        return body.message;
      }
    } catch {
      // not a JSON body — fall through
    }
  }
  return ASK_FALLBACK_ERROR_MESSAGE;
}
