/**
 * POST /api/ask — the core endpoint (SPEC §5–§7, issue #21).
 *
 * Flow: rate-limit check (fail-closed, #24) → hybrid retrieval over a rerank
 * pool (#20) → Voyage rerank to top-8 (default on since #25) → an answer from
 * the Vercel AI SDK, checked against the citation invariant and only then
 * written to the wire with its `data-citations` snapshot. Weak retrieval
 * short-circuits to a deterministic honest decline — no model call, no
 * citations, no guessing. Signed-in callers get the exchange persisted to
 * `questions`.
 *
 * Stream-first since #71: everything the caller cannot see the result of —
 * validation and the rate limit — stays a pre-stream HTTP error, and the
 * response opens the moment those pass. Retrieval and rerank then run *inside*
 * `execute`, reporting themselves through `data-status` parts, so the first
 * byte costs the auth+limit budget instead of the whole pipeline. The price is
 * that every failure past that point is a 200 with an `error` part in it —
 * hence `askStreamErrorText` on the paths below.
 *
 * The answer itself is no longer streamed through as it is generated (#131,
 * ADR 0011). Citations were prompt-led and unchecked, so an answer could ship
 * citing nothing or citing a document nobody retrieved; that can only be
 * checked once the answer is whole, and a check that runs after the text has
 * gone out enforces nothing. So generation is buffered in `generateAnswer`,
 * `validateCitations` judges it, one retry is allowed, and a second violation
 * fails closed onto the same honest decline. What #71 bought is untouched —
 * the 200, the `buscando`/`redactando` stages, the error envelope — and what
 * #73 established survives on the wire, since `writeAnswer` still emits the
 * validated text a word per event.
 *
 * A history write that fails is no longer silent (#139). It still never
 * touches the answer — persistence is best-effort and always has been — but
 * the caller believed the exchange was saved, and only this side knows it was
 * not. So the same data-part channel #127 opened carries a `data-unsaved`
 * marker before `finish`, which the chat client turns into a non-blocking
 * toast, and the failure is counted (`persist-failure.ts`) for #141.
 *
 * Degraded search (#127): the embedding provider is the one dependency here
 * that is allowed to be down. `retrieve` drops the vector leg rather than
 * throwing, so what used to be a `retrieval_failed` is now an answer off a
 * thinner search — and because the reader cannot see that for themselves, the
 * stream carries a `data-degraded` part that the answer block turns into a
 * visible note.
 *
 * Multi-turn (#132, ADR 0012): the client sends a bounded window of preceding
 * exchanges with the question, and when there is one, `condenseQuestion`
 * rewrites the two into a single standalone Spanish question that feeds the
 * pipeline below verbatim. Everything past that line — retrieval, rerank, the
 * groundedness prompt, the citation invariant — still reasons about exactly
 * one question and is untouched. A first turn skips the call entirely, and a
 * condensation that fails or times out hands the raw question back, so
 * multi-turn can degrade an answer but can never fail an ask. History keeps
 * the reader's literal words, with the condensed form in its own column.
 *
 * Telemetry (#141): every ask leaves exactly one structured, content-free
 * line — outcome class, latency bucket, provider error class, and the two
 * flags (#131 citation failure, #126 quota hit) whose counters had no
 * denominator until now. It is accumulated as the route goes and written in
 * `onFinish`, or on the pre-stream returns that never get one; see
 * `telemetry.ts` for what may and may not appear in it.
 *
 * Institution routing (#264, decision record on #254): a weak-retrieval
 * decline no longer points everyone at hacienda.go.cr. `classifyRouting` — a
 * keyword table, no model call — reads the condensed question and names the
 * institution it belongs to; the decline text names it and its official
 * URL, a `data-routed` part lets the client link it from the table, and the
 * category rides on the telemetry event as `routedCategory`, the content-free
 * counter that decides Tier 2 promotion. The #131 fail-closed decline is not
 * routed: retrieval was strong there, and the classifier is a scope
 * decision, not a substitute for a model that could not cite.
 *
 * Derived figures survive the cut (#287). A figure is arithmetic over every
 * one of its inputs, so a rerank that keeps `ccss-escala-ivm` and drops the
 * `salarios-minimos` artículo it multiplies does not weaken the answer — it
 * deletes the figure. `pinDerivedFigureInputs` appends the missing inputs
 * from the pool the reranker just read whenever a sibling survived and the
 * corpus can complete the figure. It appends and never substitutes, so the
 * answer set the rerank chose is intact and the citation numbering the prompt
 * hands the model is unchanged; the pinned chunk is an ordinary source, cited
 * and validated like the rest. On by default since the pin-at-8 reading of
 * 2026-09-15 (ADR 0018): the probe showed the append touches four dataset
 * cases and nothing else, and those four read grounded, completely cited and
 * abstention-clean at the shipped top 8. `PIN_DERIVED_INPUTS=off` is the
 * measured baseline.
 *
 * Stop/retry (#74, audit F-11): `request.signal` is threaded into `streamText`
 * as `abortSignal`, so a client-side `stop()` (chat.tsx) cancels the paid
 * Anthropic call once generation has started — the issue's named target for
 * F-11. Persistence-on-abort is a no-op: no user was ever shown "listo" for
 * it, so there is nothing worth remembering.
 *
 * Aborts refund, and the pipeline carries its own deadline (#205, ADR 0013).
 * `request.signal` fires on Detener and on a passive network drop alike — a
 * WiFi handoff, a locked phone, a proxy idle-kill — and the server cannot
 * tell them apart, so every client abort refunds the slot and persists
 * nothing. ADR 0011's "abort = deliberate stop, nothing owed" reading is
 * replaced: the reader received no value either way. Generation also runs
 * under `startAskDeadline` (~50 s, cumulative across both attempts), so a
 * slow retry run surfaces as a refundable system failure *inside* the route
 * instead of hitting the platform's silent `maxDuration` kill — which runs
 * no `finally`, lands no refund, writes no telemetry. Refunds themselves
 * settle in `execute`'s own `finally`, not in the stream's `onFinish`: a
 * disconnect can fire `onFinish` via `cancel()` before the debt is even
 * marked, and settlement must not depend on that ordering.
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessageStreamWriter,
} from "ai";
import {
  ASK_FALLBACK_ERROR_MESSAGE,
  askStreamErrorText,
  CITATIONS_PART_ID,
  DEGRADED_PART_ID,
  MARKERS_PART_ID,
  RETRIEVAL_FAILED_MESSAGE,
  ROUTED_PART_ID,
  STATUS_PART_ID,
  UNSAVED_PART_ID,
  boundTurns,
  type AskErrorCode,
  type AskStatusStage,
  type AskUIMessage,
  type ConversationTurn,
} from "@/lib/answer/contract";
import {
  createCitationTracker,
  renumberCitationMarkers,
  type CitationTracker,
} from "@/lib/answer/citations";
import {
  recordCitationFailure,
  validateCitations,
} from "@/lib/answer/invariant";
import { condenseQuestion } from "@/lib/answer/condense";
import {
  incompletelyCitedDerivedFigures,
  pinDerivedFigureInputs,
  resolveDerivedFigures,
  type ResolvedDerivedFigure,
} from "@/lib/answer/derived";
import { startAskDeadline } from "@/lib/answer/deadline";
import { getAnswerModel } from "@/lib/answer/model";
import { describeError } from "@/lib/log-redaction";
import { saveQuestion, type SaveQuestionInput } from "@/lib/answer/persist";
import {
  recordHistorySaveFailure,
  type SavedAnswerKind,
} from "@/lib/answer/persist-failure";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  WEAK_RETRIEVAL_ANSWER,
} from "@/lib/answer/prompt";
import { RERANK_POOL, rerankChunks } from "@/lib/answer/rerank";
import { getUserId } from "@/lib/answer/user";
import {
  classifyRouting,
  declineAnswer,
  type RoutedCategory,
} from "@/lib/routing";
import {
  checkRateLimit,
  NO_REFUND,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  subjectForAnon,
  subjectForUser,
  type RateLimitResult,
} from "@/lib/rate-limit";
import { retrieve, type RetrievedChunk } from "@/lib/retrieval";
import { createAskTelemetry, type AskTelemetry } from "@/lib/telemetry";

export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 1_000;

/**
 * The question in the two forms this route has needed since #132, carried
 * together so no call site has to remember which one it wants.
 *
 * `query` is what the pipeline runs on — retrieval, rerank and the answer
 * prompt all take the standalone form, which on a first turn is the literal
 * question and on a follow-up is the condensed one. `question` is what the
 * reader typed, and it is what history stores: a row saying "¿y si también
 * soy asalariado?" is the exchange they had, while a row rewritten on their
 * behalf is not. `condensed` rides along beside it for debuggability (req.
 * 3) and is null whenever the pipeline ran on the literal question — a first
 * turn, or a condensation that fell back.
 */
interface AskedQuestion {
  question: string;
  condensed: string | null;
  query: string;
}

/**
 * Generations allowed per ask: the first, plus the one retry #131 grants a
 * citation-invariant violation. Two, not "until it works" — a model that
 * cannot cite twice in a row is not going to on the third try, and each
 * attempt is paid tokens against a 60 s budget.
 */
const MAX_ANSWER_ATTEMPTS = 2;

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
async function anonRateLimit(
  request: Request,
  now: Date,
): Promise<RateLimitResult> {
  let subject: string;
  try {
    subject = subjectForAnon(
      clientIp(request),
      request.headers.get("user-agent") ?? "",
      now,
    );
  } catch (error) {
    console.error(
      `ask: anonymous rate-limit subject unavailable: ${describeError(error)}`,
    );
    return {
      allowed: false,
      remaining: 0,
      resetAt: now,
      reason: "unavailable",
      message: RATE_LIMIT_UNAVAILABLE_MESSAGE,
      refund: NO_REFUND,
    };
  }
  return checkRateLimit(subject, "anon", undefined, now);
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

/**
 * Marks the whole answer as retrieved without its vector leg (#127). Written
 * before any text, once, so the label is on the wire whatever comes next — an
 * answer, or the honest decline a lexical-only miss can still produce. The
 * telemetry counter is not written here: `retrieve` records it at the one
 * place that knows the embed failed (`retrieval-degraded.ts`).
 */
function writeDegraded(writer: Writer): void {
  writer.write({ type: "data-degraded", id: DEGRADED_PART_ID, data: true });
}

function writeStatus(writer: Writer, stage: AskStatusStage): void {
  writer.write({
    type: "data-status",
    id: STATUS_PART_ID,
    data: { stage },
  });
}

/**
 * Marks a delivered answer as unsaved (#139). Written after the answer and
 * before `finish`, which is the whole reason both callers below hold their
 * `finish` back until the save has resolved: a part written past the finish
 * part belongs to no message the client will still be assembling.
 */
function writeUnsaved(writer: Writer): void {
  writer.write({ type: "data-unsaved", id: UNSAVED_PART_ID, data: true });
}

/**
 * Saves one delivered exchange and says so on the wire when it could not be
 * saved (#139).
 *
 * The bargain persist.ts struck is intact: a failure here never becomes an
 * error part, never refunds, never touches the text the reader already has.
 * What changes is that it is no longer *invisible* — silent history loss was
 * the defect (#121), since the reader has no way to tell a saved exchange
 * from a lost one until they go looking for it and it is gone.
 *
 * Both doors onto "not saved" land here: an insert that reported an error
 * (`saveQuestion` returns false, having logged the message) and a call that
 * rejected outright. The reader cannot tell them apart and neither can act on
 * the difference, so they produce the same part and the same toast; only the
 * counter's log line distinguishes them.
 */
async function persistExchange(
  writer: Writer,
  kind: SavedAnswerKind,
  input: SaveQuestionInput,
): Promise<void> {
  let saved: boolean;
  try {
    saved = await saveQuestion(input);
  } catch (error) {
    recordHistorySaveFailure({ kind, error });
    writeUnsaved(writer);
    return;
  }
  if (!saved) {
    recordHistorySaveFailure({ kind });
    writeUnsaved(writer);
  }
}

/**
 * Which failures give the ask back (#126, decision on #121). System failures
 * do: the user asked, our side broke, they should not pay a quota slot for
 * our outage. Everything else consumes — most importantly the honest decline
 * on weak retrieval, which is a *completed* answer. If declines were free the
 * boundary becomes a fishing hole: phrase asks so they decline, spend nothing.
 *
 * The degraded cases never reach here. `rerankChunks` swallows a Voyage
 * outage and falls back to the fused order (rerank.ts), and since #127 a dead
 * embedding provider falls back to lexical-only retrieval — both deliver an
 * answer, labeled, so both consume like one. Nor does an honest decline or a
 * client abort — neither is an error, so neither has a code at all.
 *
 * Exhaustive over `AskErrorCode` on purpose: a new failure mode cannot be
 * added to the contract without someone deciding, here, whether it costs the
 * user an ask.
 */
const REFUNDS_ASK: Record<AskErrorCode, boolean> = {
  invalid_question: false, // pre-stream, and nothing was consumed yet
  rate_limited: false, // pre-stream; the counter is the point
  rate_limit_unavailable: false, // pre-stream; no increment landed
  retrieval_failed: true,
  answer_failed: true,
};

/**
 * Records that this ask should be given back, without doing it yet. The
 * failure paths below reach it from places that cannot await — the SDK's
 * error mappers are synchronous — and a fire-and-forget RPC is not safe here:
 * a serverless function can freeze the moment the response completes, and an
 * unawaited refund would silently never land. So the paths only mark the
 * debt; `POST` settles it in the stream's `onFinish`, which the SDK awaits
 * inside the response's own flush, while the platform still considers the
 * request in flight.
 */
interface QuotaDebt {
  owe: () => void;
}

function writeStreamError(
  writer: Writer,
  code: AskErrorCode,
  message: string,
  quota: QuotaDebt,
): void {
  writer.write({ type: "error", errorText: askStreamErrorText(code, message) });
  if (REFUNDS_ASK[code]) quota.owe();
}

/**
 * Anything thrown past the 200 — a provider outage, a network drop mid-answer,
 * a bug in `execute`. The raw reason is for our logs; the client gets the
 * contract's Spanish (audit F-22: without this, the SDK's default
 * "An error occurred." reached the UI in English).
 *
 * `answer_failed` is a system failure, so this owes a refund too (#126). It
 * is the second door onto the same outcome — `writeStreamError` covers the
 * one failure the route raises itself — and both are safe to reach: the debt
 * is a flag, and the handle that settles it is once-only.
 */
function answerFailed(
  error: unknown,
  quota: QuotaDebt,
  telemetry: AskTelemetry,
): string {
  console.error(`ask: answer stream failed: ${describeError(error)}`);
  const code: AskErrorCode = "answer_failed";
  if (REFUNDS_ASK[code]) quota.owe();
  telemetry.failed(error);
  return askStreamErrorText(code, ASK_FALLBACK_ERROR_MESSAGE);
}

/**
 * Streams the canned honest decline and persists it — the answer we give when
 * we will not give an answer.
 *
 * Two callers reach it. Weak retrieval (#71), where no model was ever called,
 * and the #131 fail-closed path, where one was called twice and both answers
 * broke the citation invariant. Both are the same outcome for the reader: we
 * have nothing we can stand behind, said plainly, with the official sources to
 * go to instead. It carries no citations by design, which is exactly why the
 * invariant does not run on it (#131 req. 4).
 *
 * Only the first caller routes (#264): it passes the category the classifier
 * chose, the decline names that institution, and a `data-routed` part goes
 * out ahead of the text so the client can link it. The fail-closed caller
 * passes nothing and gets the general text — the pre-#264 decline.
 */
async function streamHonestDecline(
  writer: Writer,
  asked: AskedQuestion,
  userId: string | null,
  routed: RoutedCategory | null = null,
): Promise<void> {
  const id = "fallback";
  const text = routed === null ? WEAK_RETRIEVAL_ANSWER : declineAnswer(routed);
  if (routed !== null) {
    writer.write({
      type: "data-routed",
      id: ROUTED_PART_ID,
      data: { category: routed },
    });
  }
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
  if (userId) {
    // The decline is a delivered answer, so it is saved and labeled like one
    // — the reader who asked and got told "no official basis" expects to find
    // that in their history as much as any other exchange. `finish` waits for
    // the save (it used to precede it) so a `data-unsaved` part still has a
    // message to attach to.
    await persistExchange(writer, "decline", {
      userId,
      question: asked.question,
      condensedQuestion: asked.condensed,
      answer: text,
      citations: [],
    });
  }
  writer.write({ type: "finish" });
}

/**
 * One buffered generation. Returns the whole answer — nothing is written to
 * the wire from in here.
 *
 * That buffering is what #131 costs, and it is not incidental: an answer can
 * only be checked for "cites at least one retrieved source, and nothing else"
 * once it is complete, and a check that runs after the text has been streamed
 * enforces nothing. So the model's deltas are drained here into a string, the
 * invariant runs on it, and only a passing answer is emitted (`writeAnswer`).
 *
 * Consequences, all deliberate:
 * - `smoothStream` (#73) came off this call. Its job was to pace the provider's
 *   bursts on the way to the client; there is no longer a client on the other
 *   side of it, so all it could do is delay our own buffer. The word-sized
 *   deltas it produced are still what the wire carries — `writeAnswer` emits
 *   them from the validated text, so the client-side contract is unchanged.
 * - A failure mid-generation now yields no text at all rather than the partial
 *   answer #71 let through. A partial answer is precisely an unvalidated one.
 * - `streamText`'s `onFinish` is gone with it; persistence moved to the caller,
 *   which is the only place that knows *which* attempt was shown.
 *
 * `abortSignal` still goes straight through to the provider (#74/F-11) — the
 * retry hands it the same signal, so a client stop cancels whichever attempt
 * is in flight.
 */
async function generateAnswer(
  question: string,
  chunks: readonly RetrievedChunk[],
  derivedFigures: readonly ResolvedDerivedFigure[],
  signal: AbortSignal,
  attempt: number,
): Promise<string> {
  // Both doors a model failure can come through, closed onto one exit. A
  // stream-stopping error rejects the iteration below; a recoverable one
  // arrives as an error part, which `textStream` drops on the floor — so it is
  // captured here and rethrown, rather than letting a truncated answer be
  // mistaken for a complete one and judged on its citations.
  let failure: unknown = null;
  const result = streamText({
    model: getAnswerModel(),
    system: ANSWER_SYSTEM_PROMPT,
    prompt: buildUserPrompt(question, chunks, {
      citationRetry: attempt > 1,
      derivedFigures,
    }),
    abortSignal: signal,
    onError: ({ error }) => {
      failure ??= error;
    },
  });
  let text = "";
  for await (const delta of result.textStream) text += delta;
  if (failure !== null) throw failure;
  return text;
}

/**
 * Writes a validated answer out: the text word by word, then the citations
 * snapshot it earned. `finish` is the caller's, not this function's — since
 * #139 it comes after persistence has resolved, so a `data-unsaved` part can
 * still land on the message.
 *
 * Word-sized deltas keep the wire shape #73 established — one word per event,
 * so the client paints word by word rather than in one block — even though the
 * whole answer is already in hand. The citations follow the text rather than
 * leading it, which is the order the streaming path produced and the order the
 * client's part-ordering assertions pin.
 */
function writeAnswer(
  writer: Writer,
  text: string,
  tracker: CitationTracker,
): void {
  const id = "answer";
  writer.write({ type: "text-start", id });
  for (const word of text.split(/(?<= )/)) {
    writer.write({ type: "text-delta", id, delta: word });
  }
  writer.write({ type: "text-end", id });
  writeCitations(writer, tracker);
}

export async function POST(request: Request): Promise<Response> {
  // Started here so the latency bucket covers the whole request, including the
  // auth and rate-limit work #71 kept in front of the 200 (telemetry.ts, #141).
  const telemetry = createAskTelemetry();
  let question: unknown;
  let rawHistory: unknown;
  try {
    ({ question, history: rawHistory } = (await request.json()) as {
      question?: unknown;
      history?: unknown;
    });
  } catch {
    telemetry.emit();
    return jsonError("invalid_question", INVALID_QUESTION_MESSAGE, 400);
  }
  if (
    typeof question !== "string" ||
    question.trim() === "" ||
    question.length > MAX_QUESTION_LENGTH
  ) {
    telemetry.emit();
    return jsonError("invalid_question", INVALID_QUESTION_MESSAGE, 400);
  }
  const literal = question.trim();
  // Bounded here, not trusted from the wire (#132 req. 4): the client applies
  // the same window in `askRequestBody`, but a hand-rolled POST with two
  // hundred turns in it would otherwise spend the condensation budget without
  // limit. Anything that is not a pair of non-empty strings is dropped rather
  // than rejected — a malformed history is not a reason to refuse an ask that
  // carries a perfectly good question.
  const history: ConversationTurn[] = Array.isArray(rawHistory)
    ? boundTurns(rawHistory)
    : [];

  const userId = await getUserId(request);
  // One clock read for the whole rate-limit decision (#205): the anonymous
  // subject and the quota window each derive a date, and two separate reads
  // straddling CR midnight would key the subject to one day and the window
  // to the next.
  const now = new Date();
  const limit = userId
    ? await checkRateLimit(subjectForUser(userId), "authed", undefined, now)
    : await anonRateLimit(request, now);
  if (!limit.allowed) {
    // Fail-closed: an unavailable limiter denies too, but as a 503 so the
    // client can tell "try later" from "you hit the limit".
    const unavailable = limit.reason === "unavailable";
    // A spent quota is the caller's own doing; a limiter that cannot answer is
    // ours. Only the second belongs in the error rate the runbook alerts on —
    // and it never charged the ask, so it is `refunded_error` by the same
    // reading (#141).
    if (unavailable) telemetry.failed();
    else telemetry.quotaHit();
    telemetry.emit();
    return jsonError(
      unavailable ? "rate_limit_unavailable" : "rate_limited",
      limit.message ?? RATE_LIMIT_UNAVAILABLE_MESSAGE,
      unavailable ? 503 : 429,
    );
  }

  let refundOwed = false;
  const quota: QuotaDebt = {
    owe: () => {
      refundOwed = true;
    },
  };

  // The pipeline's own budget (#205, deadline.ts): expire it inside the route,
  // observably, before the platform's silent `maxDuration` kill can. Started
  // here, after the increment landed, because this is the moment there is a
  // slot to lose.
  const deadline = startAskDeadline();

  /**
   * Settles the debt and writes the event — the two things that must happen
   * however the ask ended. Reached from `execute`'s `finally` (the path that
   * cannot be skipped short of a platform kill) and from `onFinish` as a
   * backstop. Meeting it twice pays at most once — but a debt marked *after*
   * the first settlement (the `onError` door) is still paid by the second.
   */
  let refundPaid = false;
  const settle = async (): Promise<void> => {
    if (refundOwed && !refundPaid) {
      refundPaid = true;
      await limit.refund();
    }
    telemetry.emit();
  };

  const runAsk = async (writer: Writer): Promise<void> => {
    /**
     * The two doors out of a cut-short ask (#205), checked in this order at
     * every await boundary below — the deadline first, because when both have
     * fired, our expired budget is the fact worth reporting.
     *
     * `deadlineHit` is a system failure: the reader is (as far as we know)
     * still connected and waiting, so they get the contract's Spanish error,
     * a refund, and a `refunded_error` event. `clientGone` is the caller's
     * signal — Detener and a passive network drop are indistinguishable here,
     * so both refund and neither persists; there is nobody left to write an
     * error part for.
     */
    const deadlineHit = (): boolean => {
      if (!deadline.signal.aborted) return false;
      console.error("ask: internal deadline exceeded before the answer");
      telemetry.aborted("deadline");
      telemetry.failed(deadline.signal.reason);
      writeStreamError(
        writer,
        "answer_failed",
        ASK_FALLBACK_ERROR_MESSAGE,
        quota,
      );
      return true;
    };
    const clientGone = (): boolean => {
      if (!request.signal.aborted) return false;
      telemetry.aborted("client");
      quota.owe();
      return true;
    };
    // The one check the boundaries below actually call. Always both doors,
    // always in the same order — leaving a caller free to check only one is
    // how a boundary quietly loses its deadline coverage.
    const cutShort = (): boolean => deadlineHit() || clientGone();

    // Our own `start` so the status parts have a message to attach to
    // before retrieval begins.
    writer.write({ type: "start" });
    writeStatus(writer, "buscando");

    // #132: a follow-up is resolved into a standalone question before
    // anything else runs, and the rest of this route neither knows nor
    // cares that it happened. Inside the 200 rather than in front of it —
    // it is a model call, so it belongs on the same side of the stream as
    // the other two, under the `buscando` stage the reader is already
    // watching. A first turn makes no call at all, and a condensation that
    // fails hands the literal question back (condense.ts), so this line can
    // slow an ask down but can never fail one.
    const { query, condensed } = await condenseQuestion(literal, history);
    const asked: AskedQuestion = { question: literal, condensed, query };

    let retrieval;
    try {
      retrieval = await retrieve(asked.query, { matchCount: RERANK_POOL });
    } catch (error) {
      console.error(`ask: retrieval failed: ${describeError(error)}`);
      telemetry.failed(error);
      writeStreamError(
        writer,
        "retrieval_failed",
        RETRIEVAL_FAILED_MESSAGE,
        quota,
      );
      return;
    }
    // A reader who left during condensation or retrieval gets their slot
    // back (#205) — nothing below is on their behalf, and nothing was
    // delivered. A budget already spent by retrieval alone is caught here
    // too, before any paid generation begins.
    if (cutShort()) return;

    // #127: the vector leg was skipped, so the reader is told before they
    // read anything — including on the decline path below, where a thin
    // search is part of why we have nothing to say.
    if (retrieval.isDegraded) {
      writeDegraded(writer);
      telemetry.degraded();
    }

    if (retrieval.isWeak) {
      // #264: the one place the classifier runs. On the condensed question,
      // so a follow-up («¿y la patente?») is routed on what it resolved to.
      const routed = classifyRouting(asked.query);
      telemetry.routed(routed);
      await streamHonestDecline(writer, asked, userId, routed);
      return;
    }

    // Rerank is still "buscando" — the stage flips only when the model does.
    // #287: the rerank cut can strand a derived figure by dropping one of its
    // inputs while its sibling survives, and the figure is then unprintable.
    // Pinning the missing input back in from the pool the reranker just read
    // is an append, so nothing the rerank chose is displaced.
    // #286: the reranker scores the question *and* its corpus-register
    // expansion, for the same reason the fused legs do — and, since #304,
    // the step catalogue's sentences when retrieval ran a probe.
    const chunks = pinDerivedFigureInputs(
      await rerankChunks(asked.query, retrieval.chunks, {
        expansion: retrieval.expansion,
        steps: retrieval.steps?.sentences ?? null,
      }),
      retrieval.chunks,
    );
    if (cutShort()) return;
    const derivedFigures = resolveDerivedFigures(chunks);
    writeStatus(writer, "redactando");

    // The client's signal and our deadline, composed: either one cancels
    // the paid provider call (#74/F-11 kept the first; #205 adds the
    // second). Which one fired is re-read off the source signals after —
    // the composed signal cannot say.
    const generationSignal = AbortSignal.any([request.signal, deadline.signal]);

    // #131: generate, check, and only then write. The loop is the whole
    // enforcement — an answer leaves this block either having satisfied the
    // invariant or not at all.
    let answer: string | null = null;
    for (let attempt = 1; attempt <= MAX_ANSWER_ATTEMPTS; attempt += 1) {
      // The retry is the model writing again, so the stage says so (#219) —
      // the first attempt rides the `redactando` written above.
      if (attempt > 1) writeStatus(writer, "redactando");
      let text: string;
      try {
        text = await generateAnswer(
          asked.query,
          chunks,
          derivedFigures,
          generationSignal,
          attempt,
        );
      } catch (error) {
        // An aborted generation arrives here as a rejection. Which signal
        // cut it decides everything (#205): the deadline is our failure
        // (error part, refund, telemetry — all inside `deadlineHit`), and
        // a client abort — Detener or a network drop, indistinguishable —
        // refunds quietly and persists nothing.
        if (cutShort()) return;
        writer.write({
          type: "error",
          errorText: answerFailed(error, quota, telemetry),
        });
        return;
      }
      // The quieter half of the same stops: an abort mid-generation can end
      // the provider stream without an error at all (the SDK routes it
      // through its own `onAbort`), so the loop simply gets a truncated
      // draft back. Validating, retrying or persisting it would be work on
      // an answer nobody will receive.
      if (cutShort()) return;

      // #219: the invariant check is a real pipeline moment, so it gets a
      // stage. The check itself takes microseconds — the client is the one
      // that holds the label on screen long enough to be legible.
      writeStatus(writer, "verificando");
      const verdict = validateCitations(text, chunks.length);
      const incompleteDerived = verdict.ok
        ? incompletelyCitedDerivedFigures(text, derivedFigures)
        : [];
      if (verdict.ok && incompleteDerived.length === 0) {
        answer = text;
        break;
      }
      if (verdict.ok) {
        recordCitationFailure({
          violation: "incomplete_derived_markers",
          attempt,
        });
      } else {
        recordCitationFailure({
          violation: verdict.violation,
          attempt,
          unresolved: verdict.unresolved,
        });
      }
      telemetry.citationFailure();
    }

    // Fail closed. The retry is spent and we still have no answer we can
    // stand behind, so the user gets the same honest decline weak retrieval
    // gives rather than prose with nothing under it. It is a *delivered*
    // answer, so it consumes the ask like any other decline (#126) and is
    // persisted like one — refunding here would hand a free ask back every
    // time a badly-behaved model misbehaves, which is a hole whose shape we
    // do not control.
    if (answer === null) {
      await streamHonestDecline(writer, asked, userId);
      return;
    }

    // The last look before anything is delivered (#205). A validated
    // answer the reader disconnected in front of is still an answer they
    // never received: refund, write nothing, persist nothing.
    if (cutShort()) return;

    const tracker = createCitationTracker(chunks);
    tracker.append(answer);
    writeAnswer(writer, answer, tracker);
    telemetry.answered();

    if (userId) {
      await persistExchange(writer, "answer", {
        userId,
        question: asked.question,
        condensedQuestion: asked.condensed,
        // History stores the reader's numbering, not the wire's: the
        // markers are rewritten to seal ordinals here (#133) so a restored
        // answer carries its superscripts without needing the chunk map,
        // which is not persisted.
        answer: renumberCitationMarkers(answer, tracker.ordinals()),
        citations: tracker.used(),
      });
    }
    writer.write({ type: "finish" });
  };

  const stream = createUIMessageStream<AskUIMessage>({
    execute: async ({ writer }) => {
      try {
        await runAsk(writer);
      } catch (error) {
        // A throw the pipeline did not map itself — a bug in `execute`, a
        // missing key. Caught here rather than left to the SDK's `onError`
        // so the debt is marked *before* the `finally` settles it; `onError`
        // fires after `execute` rejects, which is after `finally` has run.
        writer.write({
          type: "error",
          errorText: answerFailed(error, quota, telemetry),
        });
      } finally {
        // Where refunds actually settle (#205). `execute` runs to completion
        // even when the client is gone — the stream machinery awaits it — so
        // this is the one block every path above funnels through, whatever
        // `onFinish`'s cancel-vs-flush timing did. The deadline timer dies
        // here too, expired or not, so it cannot hold the function open.
        deadline.clear();
        await settle();
      }
    },
    // The doors `execute`'s own try cannot cover: a failure in the stream
    // machinery itself. `onFinish` then settles what this marks.
    onError: (error) => answerFailed(error, quota, telemetry),
    // The backstop. The SDK awaits this in the stream's flush, so on the
    // paths that reach it a refund still completes before the response does;
    // `settle`'s halves are once-only, so following `execute`'s `finally` is
    // a no-op.
    onFinish: settle,
  });
  return createUIMessageStreamResponse({ stream });
}
