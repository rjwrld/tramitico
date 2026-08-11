// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  CITATIONS_PART_ID,
  STATUS_PART_ID,
  type AskStatusStage,
  type AskUIMessage,
} from "@/lib/answer/contract";

const chat: { messages: AskUIMessage[]; status: string } = {
  messages: [],
  status: "ready",
};

/**
 * `onFinish` (#72) is a real callback `Chat` passes to `useChat` — the mock
 * captures it so tests can fire it directly, the same way the SDK would once
 * a stream's `finish`/`error` resolves, without standing up a real fetch.
 */
type OnFinish = (event: {
  message: AskUIMessage;
  isError: boolean;
  isAbort: boolean;
  isDisconnect: boolean;
}) => void;
let latestOnFinish: OnFinish | undefined;

vi.mock("@ai-sdk/react", () => ({
  useChat: (options?: { onFinish?: OnFinish }) => {
    latestOnFinish = options?.onFinish;
    return {
      messages: chat.messages,
      sendMessage: vi.fn(),
      status: chat.status,
    };
  },
}));

/**
 * The scroller only builds its IntersectionObserver once something subscribes
 * to `useMessageScrollerVisibility`, and nothing in `src/` does yet (#79). The
 * probe stands in for that first consumer so the test can see what the hook
 * would report.
 */
vi.mock("@/components/ui/message-scroller", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/message-scroller")>();
  function VisibilityProbe() {
    const { currentAnchorId, visibleMessageIds } =
      actual.useMessageScrollerVisibility();
    return (
      <span
        data-testid="visibility"
        data-anchor={currentAnchorId ?? ""}
        data-visible={visibleMessageIds.join(" ")}
      />
    );
  }
  return {
    ...actual,
    MessageScrollerProvider: ({
      children,
      ...props
    }: React.ComponentProps<typeof actual.MessageScrollerProvider>) => (
      <actual.MessageScrollerProvider {...props}>
        {children}
        <VisibilityProbe />
      </actual.MessageScrollerProvider>
    ),
  };
});

import { Chat } from "./chat";

type IntersectionCallback = ConstructorParameters<
  typeof IntersectionObserver
>[0];

const observers: StubIntersectionObserver[] = [];

class StubIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: readonly number[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: IntersectionCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Report every observed element as on screen. */
  intersect() {
    this.callback(
      Array.from(this.targets, (target) => ({
        target,
        isIntersecting: true,
      })) as unknown as IntersectionObserverEntry[],
      this,
    );
  }
}

class StubResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Everything any observer is watching, across instances. */
function observedElements() {
  return new Set(observers.flatMap((o) => Array.from(o.targets)));
}

function question(id: string, text: string): AskUIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function answer(id: string, text: string): AskUIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text },
      { type: "data-citations", id: CITATIONS_PART_ID, data: [] },
    ],
  };
}

/** An assistant message mid-flight: a `data-status` snapshot, optionally with prose so far. */
function statusMessage(
  id: string,
  stage: AskStatusStage,
  text = "",
): AskUIMessage {
  const parts: AskUIMessage["parts"] = [
    { type: "data-status", id: STATUS_PART_ID, data: { stage } },
  ];
  if (text !== "") parts.push({ type: "text", text });
  return { id, role: "assistant", parts };
}

const conversation = [
  question("q1", "¿Cómo me inscribo en Hacienda?"),
  answer("a1", "Con el formulario D-140."),
  question("q2", "¿Y en la CCSS?"),
  answer("a2", "Como trabajador independiente."),
];

function items() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-slot="message-scroller-item"]',
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  observers.length = 0;
  chat.messages = [];
  chat.status = "ready";
  latestOnFinish = undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Chat message scroller registration (#79)", () => {
  it("registers every message with the scroller under a unique id", () => {
    chat.messages = conversation;
    render(<Chat />);

    const ids = items().map((el) => el.dataset.messageId);
    expect(ids).toEqual(["q1", "a1", "q2", "a2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("anchors the last message only", () => {
    chat.messages = conversation;
    render(<Chat />);

    expect(items().map((el) => el.dataset.scrollAnchor)).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
  });

  it("hands every message item to the IntersectionObserver", async () => {
    chat.messages = conversation;
    render(<Chat />);

    await waitFor(() => {
      const observed = observedElements();
      expect(observed.size).toBe(conversation.length);
      expect(items().every((el) => observed.has(el))).toBe(true);
    });
  });

  it("reports the visible messages to useMessageScrollerVisibility", async () => {
    chat.messages = conversation;
    render(<Chat />);

    await waitFor(() => expect(observedElements().size).toBe(4));
    act(() => observers.forEach((o) => o.intersect()));

    // The scroller publishes its snapshot on the next animation frame.
    await waitFor(() => {
      const probe = screen.getByTestId("visibility");
      expect(probe.dataset.visible).toBe("q1 a1 q2 a2");
      expect(probe.dataset.anchor).toBe("a2");
    });
  });

  // #72: since #71 the streaming placeholder was a client-side guess keyed on
  // `status === "submitted"`, unregistered on purpose (#79) because it wasn't
  // a real message. The status now lives on the real assistant message (its
  // own `data-status` snapshot), so it needs no such carve-out — it registers
  // like any other message from the moment it exists.
  it("registers the still-streaming assistant message like any other", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      statusMessage("a1", "buscando"),
    ];
    chat.status = "streaming";
    render(<Chat />);

    const active = items().at(-1);
    expect(active?.textContent).toContain(
      "Consultando los documentos oficiales",
    );
    expect(active?.dataset.scrollAnchor).toBe("true");
    expect(active?.dataset.messageId).toBe("a1");
  });

  // #72: narrower now than pre-#71 — only the round trip before the assistant
  // message exists at all, since once it exists its own `data-status`
  // snapshot takes over (the test above). Still needs the #79 carve-out: it
  // isn't a message, so it stays unregistered.
  it("leaves the pre-start placeholder anchored but unregistered", () => {
    chat.messages = [question("q1", "¿Cómo me inscribo en Hacienda?")];
    chat.status = "submitted";
    render(<Chat />);

    const placeholder = items().at(-1);
    expect(placeholder?.textContent).toContain(
      "Consultando los documentos oficiales",
    );
    expect(placeholder?.dataset.scrollAnchor).toBe("true");
    expect(placeholder?.dataset.messageId).toBeUndefined();
  });
});

/** No `@testing-library/jest-dom` in this repo — plain DOM reads instead. */
function ariaBusy(): string | null {
  return (
    document.querySelector('[data-slot="answer"]')?.getAttribute("aria-busy") ??
    null
  );
}

describe("Chat staged ask status (#72)", () => {
  it("shows the buscando label in a role=status region while retrieval runs", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      statusMessage("a1", "buscando"),
    ];
    chat.status = "streaming";
    render(<Chat />);

    expect(screen.getByRole("status").textContent).toBe(
      "Consultando los documentos oficiales…",
    );
  });

  it("swaps to the redactando label once the model starts", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      statusMessage("a1", "redactando"),
    ];
    chat.status = "streaming";
    render(<Chat />);

    expect(screen.getByRole("status").textContent).toBe(
      "Redactando la respuesta…",
    );
  });

  it("marks the streaming answer container aria-busy while a stage is active", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      statusMessage("a1", "buscando"),
    ];
    chat.status = "streaming";
    render(<Chat />);

    expect(ariaBusy()).toBe("true");
  });

  it("hides the indicator the moment the first text delta lands (req 4)", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      statusMessage("a1", "redactando", "Con el formulario"),
    ];
    chat.status = "streaming";
    render(<Chat />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Con el formulario/)).toBeTruthy();
    // Still mid-exchange — the container itself stays busy even though the
    // stage label is gone.
    expect(ariaBusy()).toBe("true");
  });

  it("never shows the redactando label for a weak-retrieval answer (req 5)", () => {
    // The route never writes a "redactando" status for the canned fallback —
    // only "buscando", immediately followed by text.
    chat.messages = [
      question("q1", "¿Qué es el impuesto sobre loterías extranjeras?"),
      statusMessage("a1", "buscando", "No encontré información suficiente."),
    ];
    chat.status = "streaming";
    render(<Chat />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Redactando la respuesta…")).toBeNull();
  });

  it("clears aria-busy once the exchange is done", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      answer("a1", "Con el formulario D-140."),
    ];
    chat.status = "ready";
    render(<Chat />);

    expect(ariaBusy()).toBe("false");
  });

  it("announces a completion summary with the citation count on finish", () => {
    const finished: AskUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Con el formulario D-140." },
        {
          type: "data-citations",
          id: CITATIONS_PART_ID,
          data: [
            {
              docKey: "reglamento-iva",
              docTitle: "Reglamento de la Ley del IVA",
              norma: "Decreto Ejecutivo 41779",
              articulo: "Artículo 11",
              url: "https://sinalevi.go.cr/x",
            },
            {
              docKey: "codigo-tributario",
              docTitle: "Código de Normas y Procedimientos Tributarios",
              norma: "Ley 4755",
              articulo: "Artículo 8",
              url: "https://sinalevi.go.cr/y",
            },
          ],
        },
      ],
    };
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      finished,
    ];
    chat.status = "ready";
    render(<Chat />);

    expect(latestOnFinish).toBeDefined();
    act(() =>
      latestOnFinish?.({
        message: finished,
        isError: false,
        isAbort: false,
        isDisconnect: false,
      }),
    );

    expect(screen.getByRole("status").textContent).toBe(
      "Respuesta lista, 2 fuentes citadas.",
    );
  });

  it("does not announce completion when the stream ended in an error", () => {
    const finished = answer("a1", "Con el formulario D-140.");
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      finished,
    ];
    chat.status = "error";
    render(<Chat />);

    act(() =>
      latestOnFinish?.({
        message: finished,
        isError: true,
        isAbort: false,
        isDisconnect: false,
      }),
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  // The reviewed bug: `isDisconnect` is a distinct branch from `isError` in
  // the SDK's `ChatOnFinishCallback` — a mid-stream network drop reaches
  // `onFinish` with `isDisconnect: true` and `isError: false`, so a guard
  // that only checks `isError`/`isAbort` would still announce "Respuesta
  // lista" over an incomplete answer.
  it("does not announce completion when the connection dropped mid-stream", () => {
    const partial = answer("a1", "Con el formul");
    chat.messages = [question("q1", "¿Cómo me inscribo en Hacienda?"), partial];
    chat.status = "error";
    render(<Chat />);

    act(() =>
      latestOnFinish?.({
        message: partial,
        isError: false,
        isAbort: false,
        isDisconnect: true,
      }),
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears the completion announcement after it has had its moment", () => {
    vi.useFakeTimers();
    try {
      const finished = answer("a1", "Con el formulario D-140.");
      chat.messages = [
        question("q1", "¿Cómo me inscribo en Hacienda?"),
        finished,
      ];
      chat.status = "ready";
      render(<Chat />);

      act(() =>
        latestOnFinish?.({
          message: finished,
          isError: false,
          isAbort: false,
          isDisconnect: false,
        }),
      );
      expect(screen.getByRole("status").textContent).toContain(
        "Respuesta lista",
      );

      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // The reviewed a11y risk: since ADR 0009 the real assistant message's
  // `start` and first "buscando" `data-status` land in the same flush, so
  // the pre-start placeholder unmounts in the same tick the real message's
  // own region mounts with the identical label. If both were announcing
  // live regions, that's two mount-with-content announcements for one
  // submission. `announce={false}` on the placeholder (ask-status.tsx)
  // means only the real message's region is ever counted as `role="status"`.
  it("does not double-announce at the pre-start → real-message handoff", () => {
    chat.messages = [question("q1", "¿Cómo me inscribo en Hacienda?")];
    chat.status = "submitted";
    const { rerender } = render(<Chat />);

    // The placeholder is visible to sighted users but must not be a second
    // announcer — no accessible "status" region exists for it.
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByText("Consultando los documentos oficiales…"),
    ).toBeTruthy();

    // The real message lands (start + buscando in the same flush, ADR 0009).
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      statusMessage("a1", "buscando"),
    ];
    chat.status = "streaming";
    rerender(<Chat />);

    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0].textContent).toBe(
      "Consultando los documentos oficiales…",
    );
  });
});
