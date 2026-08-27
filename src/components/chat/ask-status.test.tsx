// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

  // #219 (DESIGN §8 as amended): the wait is the opening of motion moment 2 —
  // seal-ring, label shine, and a 150ms crossfade between stage labels. The
  // ring and shine are CSS classes whose reduced-motion fallbacks live in
  // globals.css; what the component owns is the markup and the timed swap.
  describe("wait treatment (#219)", () => {
    it("shows the verificando label", () => {
      render(<AskStatus state={{ kind: "stage", stage: "verificando" }} />);
      expect(screen.getByRole("status").textContent).toBe("Verificando citas…");
    });

    it("renders the seal-ring on a stage, outside the accessibility tree", () => {
      render(<AskStatus state={{ kind: "stage", stage: "redactando" }} />);
      const ring = screen.getByRole("status").querySelector(".seal-ring");
      expect(ring).not.toBeNull();
      expect(ring!.getAttribute("aria-hidden")).toBe("true");
      expect(ring!.querySelectorAll("i")).toHaveLength(8);
    });

    it("keeps the completion summary ring-free and shine-free", () => {
      render(
        <AskStatus state={{ kind: "complete", text: "Respuesta lista." }} />,
      );
      const region = screen.getByRole("status");
      expect(region.querySelector(".seal-ring")).toBeNull();
      expect(region.className).not.toContain("status-shimmer");
    });

    it("crossfades a stage change: old label holds 150ms, then the new one lands", () => {
      vi.useFakeTimers();
      try {
        const { rerender } = render(
          <AskStatus state={{ kind: "stage", stage: "redactando" }} />,
        );
        rerender(<AskStatus state={{ kind: "stage", stage: "verificando" }} />);

        // Mid-fade: still the old text, faded out.
        const region = screen.getByRole("status");
        expect(region.textContent).toBe("Redactando la respuesta…");
        expect(region.className).toContain("opacity-0");

        act(() => vi.advanceTimersByTime(150));
        expect(screen.getByRole("status").textContent).toBe(
          "Verificando citas…",
        );
        expect(screen.getByRole("status").className).not.toContain("opacity-0");
      } finally {
        vi.useRealTimers();
      }
    });

    it("appears and disappears instantly — the crossfade is only for swaps", () => {
      const { rerender } = render(
        <AskStatus state={{ kind: "stage", stage: "buscando" }} />,
      );
      rerender(<AskStatus state={null} />);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("does not restart the swap timer when unrelated re-renders rebuild the state object", () => {
      vi.useFakeTimers();
      try {
        const { rerender } = render(
          <AskStatus state={{ kind: "stage", stage: "redactando" }} />,
        );
        rerender(<AskStatus state={{ kind: "stage", stage: "verificando" }} />);
        // Parent re-renders mid-swap with a fresh (but equal) object each
        // time — the pending 150ms timer must survive them.
        act(() => vi.advanceTimersByTime(100));
        rerender(<AskStatus state={{ kind: "stage", stage: "verificando" }} />);
        act(() => vi.advanceTimersByTime(50));
        expect(screen.getByRole("status").textContent).toBe(
          "Verificando citas…",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("swaps instantly under prefers-reduced-motion", () => {
      const matchMedia = vi.fn().mockReturnValue({ matches: true });
      vi.stubGlobal("matchMedia", matchMedia);
      try {
        const { rerender } = render(
          <AskStatus state={{ kind: "stage", stage: "redactando" }} />,
        );
        rerender(<AskStatus state={{ kind: "stage", stage: "verificando" }} />);
        expect(screen.getByRole("status").textContent).toBe(
          "Verificando citas…",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
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
