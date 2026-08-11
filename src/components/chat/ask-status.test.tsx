// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  AskStatus,
  completionAnnouncement,
  type AskStatusState,
} from "@/components/chat/ask-status";

afterEach(cleanup);

describe("AskStatus", () => {
  it("renders nothing when there is no state", () => {
    const { container } = render(<AskStatus state={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the buscando label in a role=status region (req 1, 2)", () => {
    const state: AskStatusState = { kind: "stage", stage: "buscando" };
    render(<AskStatus state={state} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Consultando los documentos oficiales…",
    );
  });

  it("shows the redactando label", () => {
    const state: AskStatusState = { kind: "stage", stage: "redactando" };
    render(<AskStatus state={state} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Redactando la respuesta…",
    );
  });

  it("shows a completion summary with no spinner", () => {
    const state: AskStatusState = {
      kind: "complete",
      text: completionAnnouncement(2),
    };
    render(<AskStatus state={state} />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("Respuesta lista, 2 fuentes citadas.");
    expect(region.querySelector('[data-slot="spinner"]')).toBeNull();
  });

  it("does not let the Spinner's own status role/label leak through (only one region, no English)", () => {
    const state: AskStatusState = { kind: "stage", stage: "buscando" };
    render(<AskStatus state={state} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByLabelText("Loading")).toBeNull();
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("has explicit aria-live=polite alongside its implicit role=status", () => {
    const state: AskStatusState = { kind: "stage", stage: "buscando" };
    render(<AskStatus state={state} />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  // DESIGN §8 permits "at most" a ≤150ms crossfade on label change; a
  // mount/unmount text swap is instant instead, which is within that budget
  // and needs no CSS transition — so there is nothing for
  // `prefers-reduced-motion` to disable, and no transition classes to assert.
});

describe("completionAnnouncement", () => {
  it("pluralizes for zero and for many, singular only at exactly one", () => {
    expect(completionAnnouncement(0)).toBe(
      "Respuesta lista, 0 fuentes citadas.",
    );
    expect(completionAnnouncement(1)).toBe("Respuesta lista, 1 fuente citada.");
    expect(completionAnnouncement(3)).toBe(
      "Respuesta lista, 3 fuentes citadas.",
    );
  });
});
