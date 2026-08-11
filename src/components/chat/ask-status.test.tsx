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

  // #72 review: chat.tsx's pre-start placeholder sets announce={false} so it
  // never fires its own mount-with-content announcement — only the real
  // per-message region (mounted moments later with the identical label)
  // should be heard, once, per submission.
  it("stays visible but drops out of the accessibility tree when announce is false", () => {
    const state: AskStatusState = { kind: "stage", stage: "buscando" };
    render(<AskStatus state={state} announce={false} />);

    expect(screen.queryByRole("status")).toBeNull();
    const node = screen.getByText("Consultando los documentos oficiales…");
    expect(node.getAttribute("role")).toBeNull();
    expect(node.getAttribute("aria-live")).toBeNull();
    expect(node.getAttribute("aria-hidden")).toBe("true");
  });

  // DESIGN §8 names exactly three sanctioned motion moments, none of which
  // is this indicator; its own crossfade allowance is only ≤150ms and only
  // "at most". A mount/unmount text swap is instant instead, which stays
  // inside that budget and needs no CSS transition — so there is nothing for
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
