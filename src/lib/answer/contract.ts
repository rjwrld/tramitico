/**
 * The /api/ask wire contract (issues #21/#22/#57).
 *
 * The single module both sides build against: the route (#21) streams this
 * shape, the chat UI (#22) consumes it.
 *
 * - Request body: `{ question: string }` — the newest user message's text.
 * - Response: an AI SDK UI message stream. Citations arrive as
 *   `data-citations` parts, each a cumulative snapshot of the deduped
 *   citations in order of use — the UI renders the latest snapshot, so
 *   sellos stamp in as the answer applies them. `data-markers` carries the
 *   chunk-index → seal-ordinal map the inline superscripts resolve against
 *   (#133), written with every citations snapshot. `data-status` parts report
 *   which pipeline stage is running, under the same snapshot rule (#71), and
 *   `data-degraded` marks an answer retrieved without its vector leg (#127).
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

export interface AskRequestBody {
  question: string;
}

/**
 * Stages the route reports while the answer is still on its way. `buscando`
 * covers retrieval + rerank, `redactando` starts when the model does. The
 * stream carries no stage once text flows — the text is the status.
 */
export type AskStatusStage = "buscando" | "redactando";

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
};

export type AskUIMessage = UIMessage<never, AskDataParts>;

/** Stable `data-citations` part id — every write updates the same part. */
export const CITATIONS_PART_ID = "citations";

/** Stable `data-markers` part id — one part, superseded on every write. */
export const MARKERS_PART_ID = "markers";

/** Stable `data-degraded` part id — written at most once per answer. */
export const DEGRADED_PART_ID = "degraded";

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
