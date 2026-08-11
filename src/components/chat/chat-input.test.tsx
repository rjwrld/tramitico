// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "./chat-input";

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

  it("does not submit while busy, even via Enter", async () => {
    const onSubmit = vi.fn();
    render(<ChatInput onSubmit={onSubmit} onStop={vi.fn()} busy />);

    await userEvent.type(textbox(), "¿Cuál código CABYS uso?{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
    // The question is not lost — busy is a moment, not a teardown.
    expect(textbox().value).toBe("¿Cuál código CABYS uso?");
  });
});
