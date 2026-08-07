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
 *   sellos stamp in as the answer applies them.
 * - Non-OK responses carry a JSON body `{ error, message }` where `message`
 *   is user-facing Spanish (the 429 carries the rate-limit nudge from #24).
 *   The AI SDK transport throws the raw body text; `askErrorMessage`
 *   recovers the friendly message from it.
 */
import type { UIMessage } from "ai";
import type { Citation } from "@/lib/retrieval";

export interface AskRequestBody {
  question: string;
}

/** Data parts the ask stream may carry alongside text. */
export type AskDataParts = {
  citations: Citation[];
};

export type AskUIMessage = UIMessage<never, AskDataParts>;

/** Stable `data-citations` part id — every write updates the same part. */
export const CITATIONS_PART_ID = "citations";

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

/** DESIGN §9: what happened + what to do, no apology theater. */
export const ASK_FALLBACK_ERROR_MESSAGE =
  "No se pudo obtener la respuesta. Intente de nuevo.";

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
