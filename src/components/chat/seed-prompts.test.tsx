// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SEED_PROMPTS,
  SeedPrompts,
  SHOW_LESS_LABEL,
  SHOW_MORE_LABEL,
  VISIBLE_ON_PHONE,
} from "./seed-prompts";

afterEach(cleanup);

/**
 * jsdom applies no stylesheet, so the phone cut (`hidden md:block`) is read
 * off the class list: an item carrying `hidden` is one a phone does not show.
 */
function hiddenOnPhone(): HTMLElement[] {
  return screen
    .getAllByRole("listitem")
    .filter((li) => li.classList.contains("hidden"));
}

describe("SeedPrompts", () => {
  it("renders every seeded question as a button, in SPEC order", () => {
    render(<SeedPrompts onSelect={() => {}} />);

    const list = screen.getByRole("list", { name: "Preguntas frecuentes" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([...SEED_PROMPTS]);
  });

  it("selects a question on click", async () => {
    const onSelect = vi.fn();
    render(<SeedPrompts onSelect={onSelect} />);

    await userEvent.click(
      screen.getByRole("button", { name: SEED_PROMPTS[2] }),
    );

    expect(onSelect).toHaveBeenCalledWith(SEED_PROMPTS[2]);
  });

  it("cuts the list to the first few on a phone until disclosed", async () => {
    render(<SeedPrompts onSelect={() => {}} />);

    expect(hiddenOnPhone()).toHaveLength(
      SEED_PROMPTS.length - VISIBLE_ON_PHONE,
    );
    // Everything before the cut stays visible, in order.
    const items = screen.getAllByRole("listitem");
    for (const li of items.slice(0, VISIBLE_ON_PHONE)) {
      expect(li.classList.contains("hidden")).toBe(false);
    }

    const toggle = screen.getByRole("button", { name: SHOW_MORE_LABEL });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(
      screen.getByRole("list", { name: "Preguntas frecuentes" }).id,
    );

    await userEvent.click(toggle);

    expect(hiddenOnPhone()).toHaveLength(0);
    expect(toggle.textContent).toBe(SHOW_LESS_LABEL);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await userEvent.click(toggle);

    expect(hiddenOnPhone()).toHaveLength(
      SEED_PROMPTS.length - VISIBLE_ON_PHONE,
    );
    expect(toggle.textContent).toBe(SHOW_MORE_LABEL);
  });

  it("the toggle is a phone-only control", () => {
    render(<SeedPrompts onSelect={() => {}} />);

    expect(
      screen.getByRole("button", { name: SHOW_MORE_LABEL }).classList,
    ).toContain("md:hidden");
  });

  it("disables the questions, not the disclosure, while an ask is in flight", () => {
    render(<SeedPrompts onSelect={() => {}} disabled />);

    const list = screen.getByRole("list", { name: "Preguntas frecuentes" });
    for (const button of within(list).getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (
        screen.getByRole("button", {
          name: SHOW_MORE_LABEL,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
