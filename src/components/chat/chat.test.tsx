// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { CITATIONS_PART_ID, type AskUIMessage } from "@/lib/answer/contract";

const chat: { messages: AskUIMessage[]; status: string } = {
  messages: [],
  status: "ready",
};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chat.messages,
    sendMessage: vi.fn(),
    status: chat.status,
  }),
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

  it("leaves the submitted placeholder anchored but unregistered", () => {
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
