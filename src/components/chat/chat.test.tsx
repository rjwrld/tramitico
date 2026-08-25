// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  CITATIONS_PART_ID,
  HISTORY_SAVE_FAILED_NOTE,
  STATUS_PART_ID,
  UNSAVED_PART_ID,
  type AskStatusStage,
  type AskUIMessage,
} from "@/lib/answer/contract";
import type { Citation } from "@/lib/retrieval";
import { SEED_PROMPTS } from "@/components/chat/seed-prompts";
import {
  PRIVACY_DISCLOSURE,
  PRIVACY_LINK_LABEL,
  PRIVACY_PATH,
} from "@/components/chat/privacy-note";

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

/**
 * `onError` (#74) — the mock captures it the same way, so tests can trigger
 * the inline error surface (and its "Reintentar" control) without a real
 * failing fetch.
 */
type OnError = (error: unknown) => void;
let latestOnError: OnError | undefined;

// #74: `sendMessage`/`stop`/`regenerate` are plain spies so tests can assert
// on calls without a real transport; the double-submit guard under test
// lives in `Chat` itself (`inFlightRef`), not in this mock.
const sendMessageMock = vi.fn();
const stopMock = vi.fn();
const regenerateMock = vi.fn();

/**
 * #139: the toast is sonner's to render — there is one `<Toaster />` for the
 * whole app, mounted in the root layout, and it is not part of this tree. So
 * the module boundary is what this suite asserts on: that a lost history row
 * reaches `toast.error` with the copy the contract defines, and that a saved
 * one reaches nothing at all.
 */
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options?: { onFinish?: OnFinish; onError?: OnError }) => {
    latestOnFinish = options?.onFinish;
    latestOnError = options?.onError;
    return {
      messages: chat.messages,
      sendMessage: sendMessageMock,
      status: chat.status,
      stop: stopMock,
      regenerate: regenerateMock,
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

import { HistoryRefreshProvider } from "@/components/history/history-refresh";

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
  latestOnError = undefined;
  sendMessageMock.mockReset();
  stopMock.mockReset();
  regenerateMock.mockReset();
  toastErrorMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * #136 req. 2: the disclosure has to be readable *before* someone presses
 * "Enviar" for the first time — a privacy note that only appears once the
 * question is already at Anthropic discloses nothing. So the assertion is on
 * the empty state, the view a first-time visitor actually lands on, and on
 * `sendMessage` never having been called at the moment it is read.
 */
describe("Chat pre-submission privacy disclosure (#136)", () => {
  /** The note is one paragraph of prose plus a link, so read the slot. */
  function privacyNote(): HTMLElement {
    const note = document.querySelector<HTMLElement>(
      '[data-slot="privacy-note"]',
    );
    if (!note) throw new Error("no privacy note rendered");
    return note;
  }

  it("renders the disclosure on the empty state, before the first ask", () => {
    render(<Chat />);

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(privacyNote().textContent).toContain(PRIVACY_DISCLOSURE);
  });

  it("links the disclosure to the privacy page", () => {
    render(<Chat />);

    const link = screen.getByRole("link", {
      name: PRIVACY_LINK_LABEL,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(PRIVACY_PATH);
  });

  it("sits with the composer, so it survives the move into the conversation", () => {
    chat.messages = conversation;
    render(<Chat />);

    const note = privacyNote();
    const composer = screen.getByRole("textbox", { name: "Su pregunta" });
    // Same composer block in both views — not a one-off banner on the
    // landing screen that the first question sweeps away.
    expect(note.textContent).toContain(PRIVACY_DISCLOSURE);
    expect(composer.closest("form")?.parentElement?.contains(note)).toBe(true);
  });
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

const citation: Citation = {
  docKey: "reglamento-iva",
  docTitle: "Reglamento de la Ley del IVA",
  norma: "Decreto Ejecutivo 41779",
  articulo: "Artículo 11",
  url: "https://sinalevi.go.cr/x",
};

describe("Chat stop and retry controls (#74)", () => {
  it("shows Detener, not Enviar, while a stream is submitted or streaming", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      statusMessage("a1", "buscando"),
    ];
    chat.status = "streaming";
    render(<Chat />);

    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Detener" }));
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("shows Detener during the pre-start submitted window too", () => {
    chat.messages = [question("q1", "¿Cómo me inscribo en Hacienda?")];
    chat.status = "submitted";
    render(<Chat />);

    expect(screen.getByRole("button", { name: "Detener" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
  });

  it("shows Enviar, not Detener, once the exchange is ready", () => {
    chat.messages = [
      question("q1", "¿Cómo me inscribo en Hacienda?"),
      answer("a1", "Con el formulario D-140."),
    ];
    chat.status = "ready";
    render(<Chat />);

    expect(screen.queryByRole("button", { name: "Detener" })).toBeNull();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
  });

  // req 2 + the #102 guard the parent flagged: stopping must not read as a
  // successful finish, and whatever already streamed in — text, sellos, the
  // disclaimer — must survive the stop untouched.
  it("stopping mid-stream keeps the partial answer, sellos, and disclaimer, and never announces completion", () => {
    const partial: AskUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Con el formul" },
        { type: "data-citations", id: CITATIONS_PART_ID, data: [citation] },
      ],
    };
    chat.messages = [question("q1", "¿Cómo me inscribo en Hacienda?"), partial];
    chat.status = "streaming";
    const { rerender } = render(<Chat />);

    fireEvent.click(screen.getByRole("button", { name: "Detener" }));
    expect(stopMock).toHaveBeenCalledTimes(1);

    // The SDK routes an abort through `onFinish` with `isAbort: true` — the
    // same event chat.tsx's onFinish guard already special-cases for #72.
    act(() =>
      latestOnFinish?.({
        message: partial,
        isError: false,
        isAbort: true,
        isDisconnect: false,
      }),
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Respuesta lista/)).toBeNull();
    expect(screen.getByText(/Con el formul/)).toBeTruthy();
    expect(screen.getByText("Reglamento IVA · Art. 11")).toBeTruthy();
    expect(screen.getByText(/No es asesoría legal ni contable/)).toBeTruthy();

    // Composer re-enables (issue's own scenario: "click Detener → stream
    // stops → composer re-enables"). `status` is the SDK's real signal for
    // this — once it settles to "ready" the slot swaps back from Detener.
    chat.status = "ready";
    rerender(<Chat />);
    expect(screen.queryByRole("button", { name: "Detener" })).toBeNull();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
  });

  it("Reintentar resends the last question via regenerate() and clears the error", () => {
    chat.messages = [question("q1", "¿Cómo me inscribo en Hacienda?")];
    chat.status = "error";
    render(<Chat />);

    expect(latestOnError).toBeDefined();
    act(() => latestOnError?.(new Error("network fell over")));

    const retryButton = screen.getByRole("button", { name: "Reintentar" });
    fireEvent.click(retryButton);

    expect(regenerateMock).toHaveBeenCalledTimes(1);
    // `retry()` clears the error synchronously, same as `ask()` does.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Audit F-49: a rapid double-click must not start two exchanges. Both
  // clicks land before `chat.status` (test-controlled, static here) or
  // `messages` ever change, so only `Chat`'s own synchronous `inFlightRef`
  // guard can be what stops the second one.
  it("guards a rapid double-click so only one ask fires, and recovers once the exchange settles", () => {
    chat.messages = [];
    chat.status = "ready";
    render(<Chat />);

    const seedButton = screen.getByRole("button", { name: SEED_PROMPTS[0] });
    fireEvent.click(seedButton);
    fireEvent.click(seedButton);

    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    // The guard resets in `onFinish`, which fires for every outcome — a
    // further click after the exchange settles must be allowed through.
    act(() =>
      latestOnFinish?.({
        message: { id: "a1", role: "assistant", parts: [] },
        isError: false,
        isAbort: false,
        isDisconnect: false,
      }),
    );

    fireEvent.click(seedButton);
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });

  // req 5's literal scenario: "stop → immediate re-enable of the composer
  // must not allow a second in-flight ask." Models the ordering the
  // requirement is defending against directly — `status` has already
  // flipped to "ready" (Enviar is back) but the aborted exchange's actual
  // settle point, `onFinish`, has not fired yet. `status`-derived `busy`
  // alone would let this click through; only `inFlightRef` can catch it.
  // The first ask has to go through the component's real `ask()` (a seed
  // prompt click) — that is what arms the ref in the first place; setting
  // `chat.messages`/`chat.status` directly, as the other tests in this file
  // do, would never touch it and the test would prove nothing.
  it("does not start a second in-flight ask when Enviar is clicked the instant the composer re-enables after Detener (req 5)", () => {
    chat.messages = [];
    chat.status = "ready";
    const { rerender } = render(<Chat />);

    fireEvent.click(screen.getByRole("button", { name: SEED_PROMPTS[0] }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    // The exchange is now in flight — model the state a real streaming
    // response puts the SDK in.
    chat.messages = [
      question("q1", SEED_PROMPTS[0]),
      statusMessage("a1", "buscando"),
    ];
    chat.status = "streaming";
    rerender(<Chat />);

    fireEvent.click(screen.getByRole("button", { name: "Detener" }));
    expect(stopMock).toHaveBeenCalledTimes(1);

    // The composer re-enables the moment `status` reports "ready" — before
    // (deliberately, in this test) the aborted exchange's own `onFinish`
    // has run.
    chat.status = "ready";
    rerender(<Chat />);
    expect(screen.queryByRole("button", { name: "Detener" })).toBeNull();
    const enviar = screen.getByRole("button", { name: "Enviar" });

    fireEvent.change(screen.getByRole("textbox", { name: "Su pregunta" }), {
      target: { value: "¿Y en la CCSS?" },
    });
    fireEvent.click(enviar);

    // The composer looked ready, but the first exchange's guard was still
    // held (`onFinish` had not fired) — the click must not start a second
    // in-flight ask. `sendMessage` stays at its one call from the seed
    // prompt above.
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    // Once the aborted exchange actually settles, the guard releases and a
    // fresh ask goes through — req 5 guards the in-flight window, it does
    // not permanently lock the composer.
    act(() =>
      latestOnFinish?.({
        message: { id: "a1", role: "assistant", parts: [] },
        isError: false,
        isAbort: true,
        isDisconnect: false,
      }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Su pregunta" }), {
      target: { value: "¿Y en la CCSS?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });
});

describe("Chat message row composition (#105)", () => {
  it("renders each user turn as an end-aligned Message with an ink Bubble", () => {
    chat.messages = conversation;
    render(<Chat />);

    const userRows = document.querySelectorAll<HTMLElement>(
      '[data-slot="message"][data-align="end"]',
    );
    expect(userRows).toHaveLength(2);
    const bubbles = document.querySelectorAll<HTMLElement>(
      '[data-slot="bubble"][data-variant="ink"]',
    );
    expect(bubbles).toHaveLength(2);
    const [first, second] = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-slot="message"][data-align="end"] [data-slot="bubble-content"]',
      ),
    );
    expect(first?.textContent).toBe("¿Cómo me inscribo en Hacienda?");
    expect(second?.textContent).toBe("¿Y en la CCSS?");
  });

  it("renders assistant turns start-aligned with the answer block inside", () => {
    chat.messages = conversation;
    render(<Chat />);

    const assistantRows = document.querySelectorAll<HTMLElement>(
      '[data-slot="message"][data-align="start"]',
    );
    expect(assistantRows).toHaveLength(2);
    for (const row of Array.from(assistantRows)) {
      expect(row.querySelector('[data-slot="answer"]')).not.toBeNull();
      // Answer prose stays card- and bubble-free (DESIGN §6): the Bubble
      // primitive belongs to user turns only.
      expect(row.querySelector('[data-slot="bubble"]')).toBeNull();
    }
  });

  it("lands a submitted question in an end-aligned bubble once the SDK echoes it", () => {
    const { rerender } = render(<Chat />);

    fireEvent.change(screen.getByRole("textbox", { name: "Su pregunta" }), {
      target: { value: "¿Debo facturar electrónicamente?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(sendMessageMock).toHaveBeenCalledWith({
      text: "¿Debo facturar electrónicamente?",
    });

    // The mocked useChat has no transport; reflect the SDK's optimistic echo
    // of the user message, then confirm where the thread puts it.
    chat.messages = [question("q1", "¿Debo facturar electrónicamente?")];
    chat.status = "submitted";
    rerender(<Chat />);

    const bubbleContent = document.querySelector<HTMLElement>(
      '[data-slot="message"][data-align="end"] [data-slot="bubble-content"]',
    );
    expect(bubbleContent?.textContent).toBe("¿Debo facturar electrónicamente?");
  });

  // #138: a persisted answer is what makes the history list stale, so the
  // chat pokes it — through the same context the shell provides — and only
  // for outcomes that actually wrote a row.
  describe("history refresh", () => {
    function renderWithRefresh(refresh: () => void) {
      return render(
        <HistoryRefreshProvider value={refresh}>
          <Chat />
        </HistoryRefreshProvider>,
      );
    }

    it("refreshes the history when an exchange finishes", () => {
      const refresh = vi.fn();
      const finished = answer("a1", "Con el formulario D-140.");
      chat.messages = [
        question("q1", "¿Cómo me inscribo en Hacienda?"),
        finished,
      ];
      chat.status = "ready";
      renderWithRefresh(refresh);

      act(() =>
        latestOnFinish?.({
          message: finished,
          isError: false,
          isAbort: false,
          isDisconnect: false,
        }),
      );

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does not refresh when the exchange failed, aborted or dropped", () => {
      const refresh = vi.fn();
      const partial = answer("a1", "Con el formul");
      chat.messages = [
        question("q1", "¿Cómo me inscribo en Hacienda?"),
        partial,
      ];
      chat.status = "error";
      renderWithRefresh(refresh);

      for (const outcome of [
        { isError: true, isAbort: false, isDisconnect: false },
        { isError: false, isAbort: true, isDisconnect: false },
        { isError: false, isAbort: false, isDisconnect: true },
      ]) {
        act(() => latestOnFinish?.({ message: partial, ...outcome }));
      }

      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
/**
 * #139: an answer can be delivered and still never reach the signed-in
 * caller's history. The route says so with a `data-unsaved` part; this is the
 * client half — a non-blocking toast, and an answer nothing about it disturbs.
 */
describe("Chat history-save toast (#139)", () => {
  /** A finished answer carrying the route's "this was not saved" marker. */
  function unsavedAnswer(id: string, text: string): AskUIMessage {
    return {
      id,
      role: "assistant",
      parts: [
        { type: "text", text },
        { type: "data-citations", id: CITATIONS_PART_ID, data: [] },
        { type: "data-unsaved", id: UNSAVED_PART_ID, data: true },
      ],
    };
  }

  function finish(message: AskUIMessage, refresh = vi.fn()) {
    chat.messages = [question("q1", "¿Cómo me inscribo en Hacienda?"), message];
    chat.status = "ready";
    render(
      <HistoryRefreshProvider value={refresh}>
        <Chat />
      </HistoryRefreshProvider>,
    );
    act(() =>
      latestOnFinish?.({
        message,
        isError: false,
        isAbort: false,
        isDisconnect: false,
      }),
    );
    return refresh;
  }

  it("warns that the exchange was not saved, leaving the answer on screen", () => {
    finish(unsavedAnswer("a1", "Con el formulario D-140."));

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(HISTORY_SAVE_FAILED_NOTE);
    // The acceptance line: nothing about the answer is blocked or replaced.
    expect(screen.getByText("Con el formulario D-140.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says nothing when the exchange was saved", () => {
    finish(answer("a1", "Con el formulario D-140."));

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(screen.getByText("Con el formulario D-140.")).toBeTruthy();
  });

  it("still announces completion — the answer itself is ready either way", () => {
    finish(unsavedAnswer("a1", "Con el formulario D-140."));

    expect(screen.getByRole("status").textContent).toBe(
      "Respuesta lista, 0 fuentes citadas.",
    );
  });

  it("does not refetch the history — there is no row coming", () => {
    const refresh = finish(unsavedAnswer("a1", "Con el formulario D-140."));

    expect(refresh).not.toHaveBeenCalled();
  });
});
