"use client";

/**
 * Landing = chat (SPEC §8, issue #22). Single column, 44rem, centered.
 * Talks to POST /api/ask through the #21 contract (`{ question }` in, UI
 * message stream with `data-citations` parts out). Errors — including the
 * 429 rate-limit nudge — render inline in the flow, never as a modal.
 */
import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { toast } from "sonner";
import {
  askErrorMessage,
  citationsFrom,
  HISTORY_SAVE_FAILED_NOTE,
  messageText,
  statusFrom,
  unsavedFrom,
  type AskRequestBody,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { AnswerBlock } from "@/components/chat/answer-block";
import {
  AskStatus,
  completionAnnouncement,
} from "@/components/chat/ask-status";
import { ChatInput } from "@/components/chat/chat-input";
import { SeedPrompts } from "@/components/chat/seed-prompts";
import { useHistoryRefresh } from "@/components/history/history-refresh";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
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

const transport = new DefaultChatTransport<AskUIMessage>({
  api: "/api/ask",
  prepareSendMessagesRequest: ({ messages }) => {
    const question = messages.findLast((m) => m.role === "user");
    const body: AskRequestBody = {
      question: question ? messageText(question) : "",
    };
    return { body };
  },
});

/**
 * How long the completion summary sits in the status region (req 3: it
 * announces, "then clears visually") before it unmounts. Long enough for a
 * screen reader to have started reading a one-sentence announcement; short
 * enough that it reads as a moment, not a lingering banner.
 */
const COMPLETION_ANNOUNCEMENT_MS = 3000;

/** The status region's completion state: which message it belongs to, and for how long. */
interface Completion {
  messageId: string;
  text: string;
}

export function Chat() {
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
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
  const { messages, sendMessage, regenerate, stop, status } =
    useChat<AskUIMessage>({
      transport,
      onError: (error) => setErrorMessage(askErrorMessage(error)),
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

  React.useEffect(() => {
    if (!completion) return;
    const timer = setTimeout(
      () => setCompletion(null),
      COMPLETION_ANNOUNCEMENT_MS,
    );
    return () => clearTimeout(timer);
  }, [completion]);

  const busy = status === "submitted" || status === "streaming";
  const ask = (question: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setErrorMessage(null);
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
    setErrorMessage(null);
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
      <div className="mx-auto flex w-full max-w-[44rem] flex-1 flex-col justify-center gap-8 px-4 py-8">
        <h1 className="text-center font-serif text-[2rem] font-semibold tracking-tight text-balance">
          ¿Qué trámite le quita el sueño?
        </h1>
        <SeedPrompts onSelect={ask} disabled={busy} />
        {errorMessage && <InlineError message={errorMessage} onRetry={retry} />}
        <ChatInput onSubmit={ask} onStop={() => void stop()} busy={busy} />
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
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-[44rem] gap-0 px-4 py-6">
              {messages.map((message, index) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={index === messages.length - 1}
                  className={
                    message.role === "user"
                      ? "mt-8 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
                      : "mt-6"
                  }
                >
                  {message.role === "user" ? (
                    <Message align="end">
                      <MessageContent>
                        <Bubble align="end" variant="ink">
                          <BubbleContent>{messageText(message)}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
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
              {errorMessage && (
                <MessageScrollerItem scrollAnchor className="mt-6">
                  <InlineError message={errorMessage} onRetry={retry} />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
        {/* The composer sits on the bottom edge, so it clears the home
            indicator itself (#138) — 16px or the device's inset, whichever is
            larger. */}
        <div className="crossfade-ground sticky bottom-0 bg-background pt-2 pb-safe">
          <div className="mx-auto w-full max-w-[44rem] px-safe">
            <ChatInput
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
 * #74 (req 3): "Reintentar" is the one recovery control on any error —
 * outline, verb-first (DESIGN §6), never the filled primary. `role="alert"`
 * on the wrapper (not just the copy) so the button's own accessible name
 * arrives as part of the same announcement.
 */
function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex max-w-[68ch] flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}
