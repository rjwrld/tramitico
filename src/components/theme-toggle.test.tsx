// @vitest-environment jsdom
//
// The crossfade arming is the whole behaviour of this component (issue #215):
// `.theme-crossfade` has to be on <html> *while* next-themes swaps the class
// and gone shortly after, or the 150ms ground transition either never runs or
// leaks into every later paint. Nothing exercised that click path before.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
let resolvedTheme = "light";
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme, setTheme }),
}));

import { ThemeToggle } from "./theme-toggle";

beforeEach(() => {
  setTheme.mockReset();
  resolvedTheme = "light";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.classList.remove("theme-crossfade");
  cleanup();
});

// `fireEvent` rather than `userEvent`: the assertions here are about the
// component's own `setTimeout`, so the clock is fake, and userEvent's pointer
// sequence deadlocks against it.
const click = () =>
  fireEvent.click(screen.getByRole("button", { name: "Cambiar tema" }));

describe("ThemeToggle", () => {
  it("switches light to dark", () => {
    render(<ThemeToggle />);
    click();

    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("switches dark back to light", () => {
    resolvedTheme = "dark";
    render(<ThemeToggle />);
    click();

    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("arms the crossfade for the swap and disarms it after", () => {
    render(<ThemeToggle />);
    click();

    expect(document.documentElement.classList.contains("theme-crossfade")).toBe(
      true,
    );

    // Still armed while the 150ms ground transition is running.
    vi.advanceTimersByTime(150);
    expect(document.documentElement.classList.contains("theme-crossfade")).toBe(
      true,
    );

    vi.advanceTimersByTime(50);
    expect(document.documentElement.classList.contains("theme-crossfade")).toBe(
      false,
    );
  });
});
