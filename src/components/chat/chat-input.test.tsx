// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_QUESTION_LENGTH } from "@/lib/answer/contract";
import {
  ChatInput,
  LENGTH_COUNTER_FROM,
  QUESTION_TOO_LONG_ANNOUNCEMENT,
  QUESTION_TOO_LONG_HINT,
} from "./chat-input";

afterEach(cleanup);

/** No `@testing-library/jest-dom` in this repo — plain DOM reads instead. */
function textbox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: "Su pregunta",
  }) as HTMLTextAreaElement;
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("ChatInput", () => {
  it("submits the trimmed question and clears the box", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} />);

    await userEvent.type(textbox(), "  ¿Cómo me inscribo en Hacienda?  ");
    await userEvent.click(button("Enviar"));

    expect(onSubmit).toHaveBeenCalledWith("¿Cómo me inscribo en Hacienda?");
    expect(textbox().value).toBe("");
  });

  it("submits on Enter and breaks a line on Shift+Enter", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} />);

    await userEvent.type(textbox(), "¿Y en la CCSS?{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox().value).toBe("¿Y en la CCSS?\n");

    await userEvent.type(textbox(), "{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("¿Y en la CCSS?");
  });

  it("disables Enviar for an empty or whitespace-only question", async () => {
    render(<ChatInput onSubmit={vi.fn()} onStop={vi.fn()} />);

    expect(button("Enviar").disabled).toBe(true);

    await userEvent.type(textbox(), "   ");
    expect(button("Enviar").disabled).toBe(true);
  });

  // #74 req 1: outline, verb-first, wired to `stop()`; swaps in for Enviar
  // rather than sitting beside it, so the composer never shows two competing
  // actions at once.
  it("swaps Enviar for Detener while busy, wired to onStop", async () => {
    const onStop = vi.fn();
    render(<ChatInput onSubmit={vi.fn()} onStop={onStop} busy />);

    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    await userEvent.click(button("Detener"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  // DESIGN §9: an icon-only button carries its verb as its accessible name.
  // The arrow and the square draw nothing a screen reader can read, so the
  // name has to come from the label — and the glyphs stay out of it.
  it("names the icon-only actions by their verb", () => {
    const { rerender } = render(
      <ChatInput onSubmit={vi.fn()} onStop={vi.fn()} />,
    );
    const enviar = button("Enviar");
    expect(enviar.getAttribute("aria-label")).toBe("Enviar");
    expect(enviar.textContent).toBe("");
    expect(enviar.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );

    rerender(<ChatInput onSubmit={vi.fn()} onStop={vi.fn()} busy />);
    const detener = button("Detener");
    expect(detener.getAttribute("aria-label")).toBe("Detener");
    expect(detener.textContent).toBe("");
  });

  it("does not submit while busy, even via Enter", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} busy />);

    await userEvent.type(textbox(), "¿Cuál código CABYS uso?{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
    // The question is not lost — busy is a moment, not a teardown.
    expect(textbox().value).toBe("¿Cuál código CABYS uso?");
  });

  // #138: the empty state's composer and the conversation's are two different
  // elements, so the first submit unmounts the one the keyboard user was on.
  // The replacement takes focus rather than dropping it to <body>.
  it("takes focus on mount when asked to", () => {
    render(<ChatInput onSubmit={vi.fn()} onStop={vi.fn()} focusOnMount />);
    expect(document.activeElement).toBe(textbox());
  });

  it("leaves focus alone otherwise", () => {
    render(<ChatInput onSubmit={vi.fn()} onStop={vi.fn()} />);
    expect(document.activeElement).not.toBe(textbox());
  });
});

/**
 * The route's length cap, met in the composer rather than after the send: a
 * counter as the cap nears, and past it a line saying what to do while
 * "Enviar" (and Enter) hold the question. Nothing is truncated.
 */
describe("ChatInput length cap", () => {
  const counter = () =>
    screen.queryByText(`/ ${MAX_QUESTION_LENGTH}`, { exact: false });
  const liveRegion = () =>
    document.querySelector('[aria-live="polite"]') as HTMLElement;

  async function paste(text: string) {
    await userEvent.click(textbox());
    await userEvent.paste(text);
  }

  it("shows no counter on an ordinary question", async () => {
    render(<ChatInput onSubmit={vi.fn()} onStop={vi.fn()} />);
    await paste("¿Cómo me inscribo en Hacienda?");

    expect(counter()).toBeNull();
    expect(textbox().getAttribute("aria-describedby")).toBeNull();
  });

  it("counts as the cap nears, and still sends a question exactly at it", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} />);

    await paste("a".repeat(LENGTH_COUNTER_FROM));
    expect(counter()?.textContent).toBe(
      `${LENGTH_COUNTER_FROM} / ${MAX_QUESTION_LENGTH}`,
    );

    await paste("a".repeat(MAX_QUESTION_LENGTH - LENGTH_COUNTER_FROM));
    const described = textbox().getAttribute("aria-describedby");
    expect(described).not.toBeNull();
    expect(document.getElementById(described!)?.textContent).toBe(
      `${MAX_QUESTION_LENGTH} / ${MAX_QUESTION_LENGTH}`,
    );
    expect(
      screen.queryByText(QUESTION_TOO_LONG_HINT, { exact: false }),
    ).toBeNull();

    await userEvent.click(button("Enviar"));
    expect(onSubmit).toHaveBeenCalledWith("a".repeat(MAX_QUESTION_LENGTH));
  });

  it("past the cap says what to do, holds Enviar and Enter, and cuts nothing", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} />);
    const long = "a".repeat(MAX_QUESTION_LENGTH + 184);

    await paste(long);

    const described = textbox().getAttribute("aria-describedby");
    expect(document.getElementById(described!)?.textContent).toBe(
      `${MAX_QUESTION_LENGTH + 184} / ${MAX_QUESTION_LENGTH} · ${QUESTION_TOO_LONG_HINT}`,
    );
    expect(liveRegion().textContent).toBe(QUESTION_TOO_LONG_ANNOUNCEMENT);
    expect(button("Enviar").disabled).toBe(true);

    await userEvent.type(textbox(), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox().value).toBe(long);
  });

  it("releases Enviar once the question is back under the cap", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} />);

    await paste("a".repeat(MAX_QUESTION_LENGTH + 1));
    expect(button("Enviar").disabled).toBe(true);

    await userEvent.type(textbox(), "{Backspace}");
    expect(button("Enviar").disabled).toBe(false);
    expect(liveRegion().textContent).toBe("");

    await userEvent.type(textbox(), "{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("a".repeat(MAX_QUESTION_LENGTH));
  });

  it("counts the trimmed text, which is what the route measures", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} />);

    await paste(`  ${"a".repeat(MAX_QUESTION_LENGTH)}\n\n  `);

    expect(counter()?.textContent).toBe(
      `${MAX_QUESTION_LENGTH} / ${MAX_QUESTION_LENGTH}`,
    );
    expect(button("Enviar").disabled).toBe(false);
  });
});
