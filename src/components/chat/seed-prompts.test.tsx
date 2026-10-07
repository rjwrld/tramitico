// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SEED_PILLS,
  SEED_PROMPTS,
  SeedPrompts,
  SHOW_LESS_LABEL,
  SHOW_MORE_LABEL,
  VISIBLE_SEEDS,
} from "./seed-prompts";

afterEach(cleanup);

/** The pills a reader can reach: hidden ones leave the accessibility tree. */
function pills(): HTMLButtonElement[] {
  return within(
    screen.getByRole("list", { name: "Preguntas frecuentes" }),
  ).getAllByRole("button") as HTMLButtonElement[];
}

describe("SEED_PROMPTS (#264)", () => {
  it("carries one seed per Tier 1 family", () => {
    expect(SEED_PROMPTS).toHaveLength(9);
    expect(new Set(SEED_PROMPTS).size).toBe(9);
  });

  it("names nothing retired, unlanded or mixed — the #264 acceptance list", () => {
    for (const seed of SEED_PROMPTS) {
      expect(seed).not.toContain("D-140");
      expect(seed).not.toContain("v4.4 / TRIBU-CR");
      expect(seed).not.toContain("deducción automática del 25");
    }
  });
});

describe("SEED_PILLS", () => {
  it("shows every seed exactly once", () => {
    expect(SEED_PILLS.map((pill) => pill.question).sort()).toEqual(
      [...SEED_PROMPTS].sort(),
    );
  });

  it("gives each a short question as its label", () => {
    for (const { label, question } of SEED_PILLS) {
      expect(label.length).toBeLessThanOrEqual(45);
      expect(label.length).toBeLessThanOrEqual(question.length);
      expect(label).toContain("?");
    }
  });

  it("alternates the institutions before the disclosure, so the grid reads Hacienda left, CCSS right", () => {
    const first = SEED_PILLS.slice(0, VISIBLE_SEEDS).map((p) => p.institution);
    expect(first).toEqual(["Hacienda", "CCSS", "Hacienda", "CCSS"]);
  });
});

describe("SeedPrompts", () => {
  it("renders the first pills with their institution tag and short label", () => {
    render(<SeedPrompts onSelect={() => {}} />);

    const shown = pills();
    expect(shown).toHaveLength(VISIBLE_SEEDS);
    shown.forEach((button, i) => {
      const { institution, label, question } = SEED_PILLS[i];
      expect(button.textContent).toBe(`${institution} ${label}`);
      // WCAG 2.5.3: the accessible name is what the pill shows (no
      // aria-label swapping in the hidden full question).
      expect(button.hasAttribute("aria-label")).toBe(false);
      expect(question).not.toBe(label);
    });
  });

  it("sends the full question, not the label, on click", async () => {
    const onSelect = vi.fn();
    render(<SeedPrompts onSelect={onSelect} />);
    const pill = SEED_PILLS[2];

    await userEvent.click(
      screen.getByRole("button", { name: (name) => name.includes(pill.label) }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(pill.question);
    expect(onSelect).not.toHaveBeenCalledWith(pill.label);
  });

  it("discloses the rest in place on every screen size", async () => {
    const onSelect = vi.fn();
    render(<SeedPrompts onSelect={onSelect} />);

    const toggle = screen.getByRole("button", { name: SHOW_MORE_LABEL });
    expect(SHOW_MORE_LABEL).toBe(
      `Ver más preguntas (${SEED_PILLS.length - VISIBLE_SEEDS})`,
    );
    // No breakpoint hides the toggle: the cut is the same everywhere.
    expect(toggle.className).not.toMatch(/(^|\s)(sm|md|lg):hidden/);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(
      screen.getByRole("list", { name: "Preguntas frecuentes" }).id,
    );

    await userEvent.click(toggle);

    expect(pills()).toHaveLength(SEED_PILLS.length);
    expect(toggle.textContent).toBe(SHOW_LESS_LABEL);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // A disclosed pill works like the first four.
    const last = SEED_PILLS[SEED_PILLS.length - 1];
    await userEvent.click(
      screen.getByRole("button", { name: (name) => name.includes(last.label) }),
    );
    expect(onSelect).toHaveBeenCalledWith(last.question);

    await userEvent.click(toggle);

    expect(pills()).toHaveLength(VISIBLE_SEEDS);
    expect(toggle.textContent).toBe(SHOW_MORE_LABEL);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("disables the questions, not the disclosure, while an ask is in flight", async () => {
    const onSelect = vi.fn();
    render(<SeedPrompts onSelect={onSelect} disabled />);

    for (const button of pills()) {
      expect(button.disabled).toBe(true);
    }
    const toggle = screen.getByRole("button", {
      name: SHOW_MORE_LABEL,
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);

    await userEvent.click(toggle);
    expect(pills()).toHaveLength(SEED_PILLS.length);
    for (const button of pills()) {
      expect(button.disabled).toBe(true);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});
