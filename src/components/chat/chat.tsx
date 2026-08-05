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
import {
  askErrorMessage,
  messageText,
  type AskRequestBody,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { AnswerBlock } from "@/components/chat/answer-block";
import { ChatInput } from "@/components/chat/chat-input";
import { SeedPrompts } from "@/components/chat/seed-prompts";
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

export function Chat() {
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const { messages, sendMessage, status } = useChat<AskUIMessage>({
    transport,
    onError: (error) => setErrorMessage(askErrorMessage(error)),
  });

  const busy = status === "submitted" || status === "streaming";
  const ask = (question: string) => {
    setErrorMessage(null);
    void sendMessage({ text: question });
  };

  if (messages.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[44rem] flex-1 flex-col justify-center gap-8 px-4 py-8">
        <h1 className="text-center font-serif text-[2rem] font-semibold tracking-tight text-balance">
          ¿Qué trámite le quita el sueño?
        </h1>
        <SeedPrompts onSelect={ask} disabled={busy} />
        {errorMessage && <InlineError message={errorMessage} />}
        <ChatInput onSubmit={ask} busy={busy} />
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <div className="mx-auto flex w-full max-w-[44rem] min-h-0 flex-1 flex-col px-4">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-0 py-6">
              {messages.map((message, index) => (
                <MessageScrollerItem
                  key={message.id}
                  scrollAnchor={index === messages.length - 1}
                  className={
                    message.role === "user"
                      ? "mt-8 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0"
                      : "mt-6"
                  }
                >
                  {message.role === "user" ? (
                    <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-foreground px-3 py-2 text-sm text-background dark:bg-secondary dark:text-secondary-foreground">
                      {messageText(message)}
                    </div>
                  ) : (
                    <AnswerBlock message={message} />
                  )}
                </MessageScrollerItem>
              ))}
              {status === "submitted" && (
                <MessageScrollerItem scrollAnchor className="mt-6">
                  <p className="text-sm text-muted-foreground">
                    Consultando los documentos oficiales…
                  </p>
                </MessageScrollerItem>
              )}
              {errorMessage && (
                <MessageScrollerItem scrollAnchor className="mt-6">
                  <InlineError message={errorMessage} />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
        <div className="crossfade-ground sticky bottom-0 bg-background pt-2 pb-4">
          <ChatInput onSubmit={ask} busy={busy} />
        </div>
      </div>
    </MessageScrollerProvider>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <p role="alert" className="max-w-[68ch] text-sm text-muted-foreground">
      {message}
    </p>
  );
}
