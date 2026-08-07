/**
 * POST /api/ask — the core endpoint (SPEC §5–§7, issue #21).
 *
 * Flow: rate-limit check (fail-closed, #24) → hybrid retrieval over a rerank
 * pool (#20) → Voyage rerank to top-8 (default on since #25) → streamed answer via the
 * Vercel AI SDK with `data-citations` parts as sellos apply. Weak retrieval
 * short-circuits to a deterministic honest fallback — no model call, no
 * citations, no guessing. Signed-in callers get the exchange persisted to
 * `questions` after the stream completes.
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessageStreamWriter,
} from "ai";
import { CITATIONS_PART_ID, type AskUIMessage } from "@/lib/answer/contract";
import { createCitationTracker } from "@/lib/answer/citations";
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
} from "@/lib/rate-limit";
import { retrieve, type Citation } from "@/lib/retrieval";

export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 1_000;

const INVALID_QUESTION_MESSAGE =
  "Falta la pregunta o es demasiado larga. Escriba su pregunta en el cuadro de texto e intente de nuevo.";

const RETRIEVAL_FAILED_MESSAGE =
  "No se pudo buscar en los documentos oficiales. Intente de nuevo en unos minutos.";

type AskErrorCode =
  | "invalid_question"
  | "rate_limited"
  | "rate_limit_unavailable"
  | "retrieval_failed";

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

type Writer = UIMessageStreamWriter<AskUIMessage>;

function writeCitations(writer: Writer, citations: Citation[]): void {
  writer.write({
    type: "data-citations",
    id: CITATIONS_PART_ID,
    data: citations,
  });
}

/** Weak retrieval: stream the canned honest fallback without a model call. */
function weakRetrievalResponse(
  question: string,
  userId: string | null,
): Response {
  const stream = createUIMessageStream<AskUIMessage>({
    execute: ({ writer }) => {
      const id = "fallback";
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: WEAK_RETRIEVAL_ANSWER });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish" });
    },
    onFinish: async () => {
      if (userId) {
        await saveQuestion({
          userId,
          question,
          answer: WEAK_RETRIEVAL_ANSWER,
          citations: [],
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
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
    : await checkRateLimit(
        subjectForAnon(
          clientIp(request),
          request.headers.get("user-agent") ?? "",
        ),
        "anon",
      );
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

  let retrieval;
  try {
    retrieval = await retrieve(asked, { matchCount: RERANK_POOL });
  } catch (error) {
    console.error(`ask: retrieval failed: ${String(error)}`);
    return jsonError("retrieval_failed", RETRIEVAL_FAILED_MESSAGE, 502);
  }

  if (retrieval.isWeak) {
    return weakRetrievalResponse(asked, userId);
  }

  const chunks = await rerankChunks(asked, retrieval.chunks);
  const tracker = createCitationTracker(chunks);

  const stream = createUIMessageStream<AskUIMessage>({
    execute: ({ writer }) => {
      const result = streamText({
        model: getAnswerModel(),
        system: ANSWER_SYSTEM_PROMPT,
        prompt: buildUserPrompt(asked, chunks),
        onChunk: ({ chunk }) => {
          if (chunk.type !== "text-delta") return;
          if (tracker.append(chunk.text).length > 0) {
            writeCitations(writer, tracker.used());
          }
        },
        onFinish: async ({ text }) => {
          if (userId) {
            await saveQuestion({
              userId,
              question: asked,
              answer: text,
              citations: tracker.used(),
            });
          }
        },
      });
      writer.merge(toUIMessageStream({ stream: result.stream }));
    },
  });
  return createUIMessageStreamResponse({ stream });
}
