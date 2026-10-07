"use client";

/**
 * Landing = chat (SPEC §8, issue #22). Single column, 44rem, centered.
 * Talks to POST /api/ask through the #21 contract (`{ question, history? }`
 * in — the history window is #132's — UI message stream with `data-citations`
 * parts out). Errors — including the
 * 429 rate-limit nudge — render inline in the flow, never as a modal.
 */
import * as React from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { toast } from "sonner";
import {
  askErrorMessage,
  askErrorRecovery,
  askRequestBody,
  citationsFrom,
  HISTORY_SAVE_FAILED_NOTE,
  messageText,
  statusFrom,
  unsavedFrom,
  type AskErrorRecovery,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { AnswerBlock } from "@/components/chat/answer-block";
import {
  AskStatus,
  completionAnnouncement,
} from "@/components/chat/ask-status";
import { ChatInput, type ChatInputHandle } from "@/components/chat/chat-input";
import {
  ACERCA_PATH,
  ACERCA_SOURCES_ANCHOR,
} from "@/components/chat/privacy-note";
import { SeedPrompts } from "@/components/chat/seed-prompts";
import { Colophon } from "@/components/colophon";
import { Sello } from "@/components/sello";
import type { Citation } from "@/lib/citations";
import { SCOPE_PHRASE } from "@/lib/routing";
import { useHistoryRefresh } from "@/components/history/history-refresh";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

/**
 * Every send carries the newest question and, since #132, the bounded window
 * of exchanges before it — that is the whole client half of multi-turn. The
 * window is built by `askRequestBody` (contract.ts) rather than here so the
 * unit lane can pin it without standing up a transport, and the server
 * re-applies the same bound to whatever arrives.
 *
 * `regenerate()` (#74's "Reintentar") needs nothing special: it replays the
 * same last user message, and the turns before it are unchanged, so the retry
 * condenses against exactly the history the first attempt did.
 */
const transport = new DefaultChatTransport<AskUIMessage>({
  api: "/api/ask",
  prepareSendMessagesRequest: ({ messages }) => ({
    body: askRequestBody(messages),
  }),
});

/**
 * The scope and the non-promise (#264, decision record on #254 Part A §A2),
 * visible before the first ask: two lines under the headline, what the
 * assistant covers and what it does not. The first line reuses the phrase
 * the routed decline says (`routing.ts`), so the promise on the landing
 * page and the boundary a decline names are one string. DESIGN §9 voice:
 * sentence case, usted, no exclamation, no apology.
 */
const SCOPE_STEM = `Responde sobre ${SCOPE_PHRASE}, citando el artículo`;
export const SCOPE_LINE = `${SCOPE_STEM} oficial.`;
/** The same line when the corpus count closes it: «…citando el artículo de 23 documentos oficiales.» */
export const SCOPE_LEAD = `${SCOPE_STEM} de`;
export const NON_PROMISE_LINE =
  "No calcula su caso ni cubre sociedades ni otras instituciones.";

/** The status region's completion state: which message it belongs to, and for how long. */
interface Completion {
  messageId: string;
  text: string;
}

/** A failed ask as the inline error shows it: the Spanish, and the way back. */
interface AskFailure {
  message: string;
  recovery: AskErrorRecovery;
}

export function Chat({
  corpusCount,
  corpusSample = [],
}: {
  /**
   * «23 documentos oficiales» (`corpusCount` in lib/corpus-summary.ts), the
   * linked count the scope sentence closes on — read from the manifest on
   * the server and passed down, so this client component never bundles the
   * manifest. Absent, the sentence ends on «el artículo oficial».
   */
  corpusCount?: string;
  /**
   * A few of those documents as stamps, set over the scope sentence (#478) —
   * `corpusSample()` in the same module, passed down for the same reason.
   */
  corpusSample?: Citation[];
} = {}) {
  const [failure, setFailure] = React.useState<AskFailure | null>(null);
  const [completion, setCompletion] = React.useState<Completion | null>(null);
  // #74 (audit F-49): `status` catches up with a click a render or two
  // later — it rides the same async chain as the network request, so a
  // second click landing in that gap could otherwise start a second
  // exchange (the composer's own `busy` prop, derived from `status`, would
  // not yet have caught up either). `ask`/`retry` below are the only two
  // doors that start an exchange; both gate on this ref *before* touching
  // React state. Reset lives in `onFinish`, which — per the SDK's
  // `makeRequest` — runs in a `finally` for every outcome (success, error,
  // abort, disconnect), so the guard never outlives the exchange it guards.
  const inFlightRef = React.useRef(false);
  // #138: the history list is a sibling surface (it wraps this one), so a
  // finished exchange tells it to refetch. No-op when signed out — nothing was
  // persisted and no list is mounted.
  const refreshHistory = useHistoryRefresh();
  // #436: the text of the question in flight, and the composer it came from,
  // so a question whose own text failed (`rephrase`) goes back where it can be
  // edited.
  // Refs, because `onError` below is an SDK callback that must not read a
  // stale render.
  const askedRef = React.useRef("");
  const composerRef = React.useRef<ChatInputHandle>(null);
  const { messages, sendMessage, regenerate, stop, status } =
    useChat<AskUIMessage>({
      transport,
      onError: (error) => {
        const recovery = askErrorRecovery(error);
        setFailure({ message: askErrorMessage(error), recovery });
        if (recovery === "rephrase") {
          composerRef.current?.restore(askedRef.current);
        }
      },
      // #72: the one accessible completion signal (audit U-3) — never fired for
      // an aborted request, a stream that ended in an `error` part (ADR 0009),
      // or a dropped connection: none of the three delivered an answer worth
      // announcing as ready, and `isDisconnect` in particular is easy to miss
      // since a network drop still reaches `onFinish` (it's the `finally` in
      // the SDK's request loop) rather than surfacing as `isError`.
      onFinish: ({ message, isError, isAbort, isDisconnect }) => {
        inFlightRef.current = false;
        if (isError || isAbort || isDisconnect) return;
        // #139: the answer is on screen and cited, but the server could not
        // write its history row. A toast, not the inline error surface —
        // nothing the reader asked for failed, so nothing about the answer
        // changes. And no refetch: the retry loop behind `refreshHistory`
        // exists to wait out the write-vs-read race, and there is no row
        // coming, so it would poll three times for nothing.
        if (unsavedFrom(message)) {
          toast.error(HISTORY_SAVE_FAILED_NOTE);
        } else {
          // Same guard the announcement uses, for the same reason: none of
          // those three outcomes wrote a row to refetch.
          refreshHistory();
        }
        setCompletion({
          messageId: message.id,
          text: completionAnnouncement(citationsFrom(message).length),
        });
      },
    });

  // The summary's 3s display window lives in answer-block.tsx since #219 —
  // it starts when the summary is actually shown (after the word-fade
  // reveal), not when the stream finished. This state only needs to survive
  // until then; the next ask clears it either way.

  const busy = status === "submitted" || status === "streaming";
  const ask = (question: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    askedRef.current = question;
    setFailure(null);
    setCompletion(null);
    void sendMessage({ text: question });
  };
  // #74 (req 3): the inline error's "Reintentar" — resends the last question
  // without retyping. `regenerate()` targets whichever message is last: the
  // errored assistant message if the stream got far enough to start one, or
  // the user's own question if the request never got a byte back (a
  // pre-stream 429/503 never pushes an assistant message at all). Either way
  // it lands back on the same last user message `prepareSendMessagesRequest`
  // already keys off — no separate "last question" state to track here.
  const retry = () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setFailure(null);
    setCompletion(null);
    void regenerate();
  };

  // The gap this issue closes: between `sendMessage` and the assistant
  // message's first byte (its `start` + "buscando" `data-status` land in the
  // same flush — ADR 0009 — but the round trip still takes a moment), there
  // is no message to read a stage off yet. Rather than sit blank, show the
  // same "buscando" copy the real snapshot is about to report — the handoff
  // is invisible since the copy is identical either way.
  const lastMessage = messages.at(-1);
  const hasLiveStatus =
    lastMessage?.role === "assistant" && statusFrom(lastMessage) !== null;
  const showPreStartStatus = status === "submitted" && !hasLiveStatus;

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The invitation scrolls; the composer does not. On a phone the ten
            seeded prompts run past the fold, and a centered stack put the
            field itself below it — a first-time visitor saw no place to
            type. The composer takes the same pinned bottom slot it has in
            the conversation, and the headline + prompts center in whatever
            space is left (`my-auto` on the child, not `justify-center` on the
            scroller: the latter clips the top once the content overflows). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-safe">
          <div className="mx-auto my-auto flex w-full max-w-[44rem] flex-col gap-8 py-8">
            <div className="flex flex-col gap-3">
              <h1 className="text-center font-serif text-[2rem] font-semibold tracking-display text-balance">
                ¿Qué trámite le quita el sueño?
              </h1>
              {/* The record, shown before it is described (#478): the
                  sello is the signature (DESIGN §5), and without this a
                  first-time visitor never saw one before asking. Still
                  stamps, not settling ones — a row stamping on page load is
                  a staggered entrance (§8) — and not links: the count in the
                  scope sentence under them is the way into the full list. */}
              {corpusSample.length > 0 && (
                <ul
                  aria-label="Algunas fuentes"
                  data-slot="corpus-sample"
                  className="mt-1 flex list-none flex-wrap justify-center gap-2 p-0"
                >
                  {corpusSample.map((source) => (
                    <li key={source.docKey}>
                      <Sello citation={source} settle={false} />
                    </li>
                  ))}
                </ul>
              )}
              {/* The scope and the non-promise (#264): two short lines in
                  the body voice, under the sellos and above the seeds, so a
                  first-time visitor reads what this covers before choosing a
                  question. Not a card, not an eyebrow — prose (DESIGN §10).
                  The record's count closes the first line rather than
                  standing as a line of its own, which only repeated that
                  every answer cites the artículo. */}
              <p
                data-slot="scope"
                className="mt-1 text-center text-sm text-balance text-muted-foreground"
              >
                {corpusCount ? (
                  <>
                    {SCOPE_LEAD}{" "}
                    <Link
                      href={`${ACERCA_PATH}#${ACERCA_SOURCES_ANCHOR}`}
                      data-slot="corpus-count"
                      className="text-foreground underline decoration-border underline-offset-4 transition-colors duration-150 ease-out-quart hover:decoration-current"
                    >
                      {corpusCount}
                    </Link>
                    .
                  </>
                ) : (
                  SCOPE_LINE
                )}
                <br />
                {NON_PROMISE_LINE}
              </p>
            </div>
            <SeedPrompts onSelect={ask} disabled={busy} />
            {failure && <InlineError failure={failure} onRetry={retry} />}
          </div>
        </div>
        {/* The floating composer: no full-width rule or band behind it, so
            nothing meets the history sidebar's border — the box itself is the
            edge. 12px off the bottom, or the device's inset if larger. The
            colophon sits under it here only: a first-time visitor's way to
            the standing pages, gone once the conversation starts. */}
        <div className="pt-2 [--safe-pad:0.75rem] pb-safe">
          <div className="mx-auto w-full max-w-[44rem] [--safe-pad:1rem] px-safe">
            <ChatInput
              ref={composerRef}
              onSubmit={ask}
              onStop={() => void stop()}
              busy={busy}
              privacyLink={false}
            />
            <Colophon className="mt-3" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The empty state's invitation is this view's h1; once the
            conversation starts it is gone, and a page whose only headings are
            the sidebar's h2 starts at the wrong level (#138). Silent for
            sighted readers — the messages already say what this is. */}
        <h1 className="sr-only">Conversación</h1>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="[--scroll-fade-size:1.5rem]">
            <MessageScrollerContent className="mx-auto w-full max-w-[44rem] gap-0 px-4 py-6">
              {messages.map((message, index) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={index === messages.length - 1}
                  className={
                    message.role === "user"
                      ? "mt-8 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
                      : "mt-4"
                  }
                >
                  {message.role === "user" ? (
                    // The folio (#478): each exchange opens with its question
                    // set as the page's heading, the way the history view
                    // has always shown a saved one — not an ink bubble that
                    // outweighed the answer under it. An h2 under the sr-only
                    // h1, so the thread reads as a list of questions. A
                    // pasted question can be one unbroken string (#138).
                    <h2
                      data-slot="question"
                      className="font-serif text-xl leading-snug font-semibold tracking-display text-balance wrap-break-word"
                    >
                      {messageText(message)}
                    </h2>
                  ) : (
                    <Message align="start">
                      <MessageContent>
                        <AnswerBlock
                          message={message}
                          busy={busy && index === messages.length - 1}
                          completionText={
                            completion?.messageId === message.id
                              ? completion.text
                              : null
                          }
                        />
                      </MessageContent>
                    </Message>
                  )}
                </MessageScrollerItem>
              ))}
              {/*
                Both items below carry no `messageId` on purpose (#79): they
                are not messages, so registering them would put ids in
                `visibleMessageIds` that resolve to nothing. They still scroll
                into view — the primitive finds anchors through
                `data-scroll-anchor`, without consulting the id. Once the real
                assistant message exists, its own `AnswerBlock` reports the
                (now real, server-sent) stage instead — this is only the
                narrow window before that message exists at all (#72, ADR
                0009). `announce={false}`: the real message's identical
                "Consultando…" region is about to mount right after this one
                unmounts, and each mount is its own live-region announcement
                — without this, the same submission could announce twice.
                This placeholder stays visually identical either way; only
                whether a screen reader hears it changes.
              */}
              {showPreStartStatus && (
                <MessageScrollerItem scrollAnchor className="mt-6">
                  <AskStatus
                    state={{ kind: "stage", stage: "buscando" }}
                    announce={false}
                  />
                </MessageScrollerItem>
              )}
              {failure && (
                <MessageScrollerItem scrollAnchor className="mt-6">
                  <InlineError failure={failure} onRetry={retry} />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {/* "Ir al final" drops into the thread's bottom fade, just above
              the floating composer, and reads as a control resting on the
              faded edge rather than a square stamped mid-paragraph: round,
              on the composer's own `--card` ground, with the same `--lift`. */}
          <MessageScrollerButton className="size-8 rounded-full bg-card shadow-lift data-[direction=end]:bottom-1 pointer-coarse:size-11" />
        </MessageScroller>
        {/* The composer floats on the bottom edge and clears the home
            indicator itself (#138) — 12px or the device's inset, whichever is
            larger. The thread fades out above it (the viewport's bottom
            scroll fade) instead of ending on a hard rule. */}
        <div className="sticky bottom-0 pt-2 [--safe-pad:0.75rem] pb-safe">
          <div className="mx-auto w-full max-w-[44rem] [--safe-pad:1rem] px-safe">
            <ChatInput
              ref={composerRef}
              onSubmit={ask}
              onStop={() => void stop()}
              busy={busy}
              focusOnMount
            />
          </div>
        </div>
      </div>
    </MessageScrollerProvider>
  );
}

/**
 * #74 (req 3): "Reintentar" is the one recovery control on an error —
 * outline, verb-first (DESIGN §6), never the filled primary. `role="alert"`
 * on the wrapper (not just the copy) so the button's own accessible name
 * arrives as part of the same announcement.
 *
 * Except where resending cannot work (#436): a question whose own text the
 * search could not use fails the same way again, and is charged again; one
 * the route turned away as invalid (too long, most likely) is turned away
 * again. There the copy asks for other words, the question is already back
 * in the composer with focus on it, and a button that resends it would only
 * contradict the copy. The failed question stays in the thread above, as
 * every failed ask's does — it is the record of what was sent, and the
 * history window already leaves an unanswered question out (`conversationTurns`).
 */
function InlineError({
  failure,
  onRetry,
}: {
  failure: AskFailure;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex max-w-[68ch] flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">{failure.message}</p>
      {failure.recovery === "retry" && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
