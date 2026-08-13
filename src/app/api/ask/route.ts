/**
 * POST /api/ask — the core endpoint (SPEC §5–§7, issue #21).
 *
 * Flow: rate-limit check (fail-closed, #24) → hybrid retrieval over a rerank
 * pool (#20) → Voyage rerank to top-8 (default on since #25) → streamed answer via the
 * Vercel AI SDK with `data-citations` parts as sellos apply. Weak retrieval
 * short-circuits to a deterministic honest fallback — no model call, no
 * citations, no guessing. Signed-in callers get the exchange persisted to
 * `questions` after the stream completes.
 *
 * Stream-first since #71: everything the caller cannot see the result of —
 * validation and the rate limit — stays a pre-stream HTTP error, and the
 * response opens the moment those pass. Retrieval and rerank then run *inside*
 * `execute`, reporting themselves through `data-status` parts, so the first
 * byte costs the auth+limit budget instead of the whole pipeline. The price is
 * that every failure past that point is a 200 with an `error` part in it —
 * hence `askStreamErrorText` on the two paths below.
 *
 * Stop/retry (#74, audit F-11): `request.signal` is threaded into `streamText`
 * as `abortSignal`, so a client-side `stop()` (chat.tsx) cancels the paid
 * Anthropic call once generation has started — the issue's named target for
 * F-11. Retrieval and rerank are out of scope here and still run to
 * completion after an abort; they are comparatively cheap next to the model
 * call and #74 doesn't ask for their cancellation. Persistence-on-abort is a
 * deliberate no-op, not a separate branch: `streamText`'s `onFinish` below —
 * the only place that calls `saveQuestion` for the model path — simply never
 * fires on abort (the SDK routes an aborted stream through `onAbort`
 * instead), so an aborted exchange is never saved. No user was ever shown
 * "listo" for it, so there is nothing worth remembering.
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  streamText,
  toUIMessageStream,
  type UIMessageStreamWriter,
} from "ai";
import {
  ASK_FALLBACK_ERROR_MESSAGE,
  askStreamErrorText,
  CITATIONS_PART_ID,
  MARKERS_PART_ID,
  RETRIEVAL_FAILED_MESSAGE,
  STATUS_PART_ID,
  type AskErrorCode,
  type AskStatusStage,
  type AskUIMessage,
} from "@/lib/answer/contract";
import {
  createCitationTracker,
  renumberCitationMarkers,
  type CitationTracker,
} from "@/lib/answer/citations";
import { getAnswerModel } from "@/lib/answer/model";
import { saveQuestion } from "@/lib/answer/persist";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  WEAK_RETRIEVAL_ANSWER,
} from "@/lib/answer/prompt";
import { RERANK_POOL, rerankChunks } from "@/lib/answer/rerank";
import { getUserId } from "@/lib/answer/user";
import {
  checkRateLimit,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  subjectForAnon,
  subjectForUser,
  type RateLimitResult,
} from "@/lib/rate-limit";
import { retrieve } from "@/lib/retrieval";

export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 1_000;

const INVALID_QUESTION_MESSAGE =
  "Falta la pregunta o es demasiado larga. Escriba su pregunta en el cuadro de texto e intente de nuevo.";

/**
 * Non-OK body per the client contract (contract.ts): `error` is a stable
 * machine code, `message` the user-facing Spanish the UI renders inline.
 */
function jsonError(
  code: AskErrorCode,
  message: string,
  status: number,
): Response {
  return Response.json({ error: code, message }, { status });
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/**
 * Deriving the anonymous subject needs RATE_LIMIT_SUBJECT_SECRET (#125) and
 * throws without it. That is the same class of misconfiguration as missing
 * Supabase credentials, which `checkRateLimit` already reports as
 * `unavailable` — so catch it here and fail closed the same way, rather than
 * letting an unhandled throw turn into a 500 the client contract doesn't
 * describe.
 */
async function anonRateLimit(request: Request): Promise<RateLimitResult> {
  let subject: string;
  try {
    subject = subjectForAnon(
      clientIp(request),
      request.headers.get("user-agent") ?? "",
    );
  } catch (error) {
    console.error(`ask: anonymous rate-limit subject unavailable: ${error}`);
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      reason: "unavailable",
      message: RATE_LIMIT_UNAVAILABLE_MESSAGE,
    };
  }
  return checkRateLimit(subject, "anon");
}

type Writer = UIMessageStreamWriter<AskUIMessage>;

/**
 * One snapshot write: the seals themselves plus the map from the model's [n]
 * numbering onto them. They move together — a citations snapshot the client
 * cannot resolve markers against would render seals with no superscripts.
 */
function writeCitations(writer: Writer, tracker: CitationTracker): void {
  writer.write({
    type: "data-citations",
    id: CITATIONS_PART_ID,
    data: tracker.used(),
  });
  writer.write({
    type: "data-markers",
    id: MARKERS_PART_ID,
    data: tracker.ordinals(),
  });
}

function writeStatus(writer: Writer, stage: AskStatusStage): void {
  writer.write({
    type: "data-status",
    id: STATUS_PART_ID,
    data: { stage },
  });
}

function writeStreamError(
  writer: Writer,
  code: AskErrorCode,
  message: string,
): void {
  writer.write({ type: "error", errorText: askStreamErrorText(code, message) });
}

/**
 * Anything thrown past the 200 — a provider outage, a network drop mid-answer,
 * a bug in `execute`. The raw reason is for our logs; the client gets the
 * contract's Spanish (audit F-22: without this, the SDK's default
 * "An error occurred." reached the UI in English).
 */
function answerFailedText(error: unknown): string {
  console.error(`ask: answer stream failed: ${String(error)}`);
  return askStreamErrorText("answer_failed", ASK_FALLBACK_ERROR_MESSAGE);
}

/** Weak retrieval: stream the canned honest fallback without a model call. */
async function streamWeakRetrieval(
  writer: Writer,
  question: string,
  userId: string | null,
): Promise<void> {
  const id = "fallback";
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: WEAK_RETRIEVAL_ANSWER });
  writer.write({ type: "text-end", id });
  writer.write({ type: "finish" });
  if (userId) {
    // persist.ts promises failures are "logged, never surfaced — the user
    // already has their answer". That used to be free: this ran in the
    // stream's `onFinish`, past the last byte. Inside `execute` a rejection
    // would reach `onError` and stamp a Spanish failure under a delivered
    // answer, so the promise is kept explicitly here.
    try {
      await saveQuestion({
        userId,
        question,
        answer: WEAK_RETRIEVAL_ANSWER,
        citations: [],
      });
    } catch (error) {
      console.error(`ask: saving the weak-retrieval answer failed: ${error}`);
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  let question: unknown;
  try {
    ({ question } = (await request.json()) as { question?: unknown });
  } catch {
    return jsonError("invalid_question", INVALID_QUESTION_MESSAGE, 400);
  }
  if (
    typeof question !== "string" ||
    question.trim() === "" ||
    question.length > MAX_QUESTION_LENGTH
  ) {
    return jsonError("invalid_question", INVALID_QUESTION_MESSAGE, 400);
  }
  const asked = question.trim();

  const userId = await getUserId(request);
  const limit = userId
    ? await checkRateLimit(subjectForUser(userId), "authed")
    : await anonRateLimit(request);
  if (!limit.allowed) {
    // Fail-closed: an unavailable limiter denies too, but as a 503 so the
    // client can tell "try later" from "you hit the limit".
    const unavailable = limit.reason === "unavailable";
    return jsonError(
      unavailable ? "rate_limit_unavailable" : "rate_limited",
      limit.message ?? RATE_LIMIT_UNAVAILABLE_MESSAGE,
      unavailable ? 503 : 429,
    );
  }

  const stream = createUIMessageStream<AskUIMessage>({
    execute: async ({ writer }) => {
      // Our own `start` (the merge below runs with `sendStart: false`) so the
      // status parts have a message to attach to before retrieval begins.
      writer.write({ type: "start" });
      writeStatus(writer, "buscando");

      let retrieval;
      try {
        retrieval = await retrieve(asked, { matchCount: RERANK_POOL });
      } catch (error) {
        console.error(`ask: retrieval failed: ${String(error)}`);
        writeStreamError(writer, "retrieval_failed", RETRIEVAL_FAILED_MESSAGE);
        return;
      }

      if (retrieval.isWeak) {
        await streamWeakRetrieval(writer, asked, userId);
        return;
      }

      // Rerank is still "buscando" — the stage flips only when the model does.
      const chunks = await rerankChunks(asked, retrieval.chunks);
      const tracker = createCitationTracker(chunks);
      writeStatus(writer, "redactando");

      const result = streamText({
        model: getAnswerModel(),
        system: ANSWER_SYSTEM_PROMPT,
        prompt: buildUserPrompt(asked, chunks),
        // #74/F-11: cancels this model call the moment the client aborts
        // (stop() or a dropped connection), instead of paying for tokens
        // nobody reads through to `maxDuration`. Scoped to the model call
        // only, per the issue — retrieval/rerank above are not wired to this
        // signal and keep running if the client aborts during "buscando".
        abortSignal: request.signal,
        // #73: provider deltas arrive in bursts, which reads as multi-word
        // jumps. Re-chunk them word by word server-side so the text flows —
        // DESIGN §8 keeps streaming as native token flow, no CSS animation.
        // The transform runs before `onChunk` and before `result.stream`, so
        // the tracker below sees the same word-sized deltas the client does
        // (word boundaries keep "[3]" intact; citations.test.ts asserts the
        // tracker is indifferent either way).
        //
        // 20 ms measured against the local dev server, not guessed. Sonnet
        // feeds this route at ~30–40 ms/word, so 20 ms drains slower than the
        // model fills and the delay never becomes the bottleneck — it only
        // spends the bursts. Versus 10 ms on the same long answer, stalls over
        // 250 ms (the buffer running dry, which reads as the flow stopping)
        // fell from 3.8 to 0.6 per 100 words. **Keep delayInMs well under the
        // model's ms/word**: point ANSWER_MODEL at something faster and this
        // needs re-measuring, or pacing starts adding latency instead of
        // hiding it. Bounded either way by `maxDuration = 60`.
        experimental_transform: smoothStream({
          chunking: "word",
          delayInMs: 20,
        }),
        onChunk: ({ chunk }) => {
          if (chunk.type !== "text-delta") return;
          if (tracker.append(chunk.text).length > 0) {
            writeCitations(writer, tracker);
          }
        },
        onFinish: async ({ text }) => {
          if (userId) {
            await saveQuestion({
              userId,
              question: asked,
              // History stores the reader's numbering, not the wire's: the
              // markers are rewritten to seal ordinals here (#133) so a
              // restored answer carries its superscripts without needing the
              // chunk map, which is not persisted.
              answer: renumberCitationMarkers(text, tracker.ordinals()),
              citations: tracker.used(),
            });
          }
        },
      });
      // Two doors for a model failure: `stream` carries recoverable ones as
      // error parts (mapped here), while a stream-stopping one rejects the
      // merge and lands on `createUIMessageStream`'s `onError` below. Both
      // point at the same mapper so neither can leak English.
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendStart: false,
          onError: answerFailedText,
        }),
      );
    },
    onError: answerFailedText,
  });
  return createUIMessageStreamResponse({ stream });
}
