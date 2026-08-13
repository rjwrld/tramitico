// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    throw new Error("browser client should not be created in these tests");
  },
}));

import { useHistoryRefresh } from "./history-refresh";
import { HistoryShell } from "./history-shell";
import type { HistoryItem } from "./history-sidebar";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HistoryShell", () => {
  it("signed out: renders children only and never calls /api/history", () => {
    render(
      <HistoryShell signedIn={false}>
        <p>contenido principal</p>
      </HistoryShell>,
    );
    expect(screen.getByText("contenido principal")).toBeTruthy();
    expect(screen.queryByText("Historial")).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("collapse toggle unmounts and remounts the sidebar", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ questions: [] }),
    });
    render(
      <HistoryShell signedIn>
        <p>contenido principal</p>
      </HistoryShell>,
    );
    expect(await screen.findByText("Historial")).toBeTruthy();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(
      screen.getByRole("button", { name: "Ocultar historial" }),
    );
    expect(screen.queryByText("Historial")).toBe(null);

    await userEvent.click(
      screen.getByRole("button", { name: "Mostrar historial" }),
    );
    expect(screen.getByText("Historial")).toBeTruthy();
  });

  it("signed in: fetches history and shows the sidebar", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        questions: [
          {
            id: "q-1",
            question: "¿Debo facturar electrónicamente?",
            answer: "Sí…",
            citations: [],
            created_at: "2026-08-01T10:00:00Z",
          },
        ],
      }),
    });

    render(
      <HistoryShell signedIn>
        <p>contenido principal</p>
      </HistoryShell>,
    );

    expect(screen.getByText("Historial")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/history");
    expect(
      await screen.findByText("¿Debo facturar electrónicamente?"),
    ).toBeTruthy();
  });

  // Deletes go through the API route since issue #123 — the browser client has
  // no privileges on `questions`, and the module mock above would throw if
  // this path still reached for one.
  async function renderWithOneItem() {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        questions: [
          {
            id: "q-1",
            question: "¿Debo facturar electrónicamente?",
            answer: "Sí…",
            citations: [],
            created_at: "2026-08-01T10:00:00Z",
          },
        ],
      }),
    });
    render(
      <HistoryShell signedIn>
        <p>contenido principal</p>
      </HistoryShell>,
    );
    await screen.findByText("¿Debo facturar electrónicamente?");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(
      screen.getByRole("button", {
        name: "Eliminar: ¿Debo facturar electrónicamente?",
      }),
    );
    return userEvent;
  }

  it("deleting calls DELETE /api/history/:id and drops the row", async () => {
    const userEvent = await renderWithOneItem();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(fetchMock).toHaveBeenLastCalledWith("/api/history/q-1", {
      method: "DELETE",
    });
    expect(screen.queryByText("¿Debo facturar electrónicamente?")).toBe(null);
  });

  it("restores the row when the delete request fails", async () => {
    const userEvent = await renderWithOneItem();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(
      await screen.findByText("¿Debo facturar electrónicamente?"),
    ).toBeTruthy();
  });

  // Mobile (#138). jsdom applies no Tailwind, so both the sheet trigger and
  // the desktop collapse toggle are in the tree here; on a real phone the
  // `md:` classes leave exactly one of them rendered.
  describe("mobile sheet", () => {
    function historyResponse(questions: HistoryItem[]) {
      return { ok: true, json: async () => ({ questions }) };
    }

    const item = {
      id: "q-1",
      question: "¿Debo facturar electrónicamente?",
      answer: "Sí…",
      citations: [],
      created_at: "2026-08-01T10:00:00Z",
    };

    it("opens the history in a labelled dialog and closes it on select", async () => {
      fetchMock.mockResolvedValue(historyResponse([item]));
      render(
        <HistoryShell signedIn>
          <p>contenido principal</p>
        </HistoryShell>,
      );
      await screen.findAllByText("¿Debo facturar electrónicamente?");

      const { default: userEvent } =
        await import("@testing-library/user-event");
      await userEvent.click(
        screen.getByRole("button", { name: "Abrir historial" }),
      );

      const dialog = await screen.findByRole("dialog", {
        name: "Historial de preguntas",
      });
      expect(
        within(dialog).getByRole("button", { name: "Cerrar historial" }),
      ).toBeTruthy();

      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /^¿Debo facturar electrónicamente\?/,
        }),
      );

      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Historial de preguntas" }),
        ).toBe(null),
      );
      // The chosen question replaced the children — that is the whole point of
      // picking one on a phone.
      expect(
        screen.getByRole("heading", {
          name: "¿Debo facturar electrónicamente?",
        }),
      ).toBeTruthy();
    });

    it("closes on Escape", async () => {
      fetchMock.mockResolvedValue(historyResponse([]));
      render(
        <HistoryShell signedIn>
          <p>contenido principal</p>
        </HistoryShell>,
      );
      const { default: userEvent } =
        await import("@testing-library/user-event");
      await userEvent.click(
        screen.getByRole("button", { name: "Abrir historial" }),
      );
      await screen.findByRole("dialog", { name: "Historial de preguntas" });

      await userEvent.keyboard("{Escape}");

      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Historial de preguntas" }),
        ).toBe(null),
      );
    });
  });

  // Refresh after a persisted answer (#138). The consumer stands in for the
  // chat, which calls the same context hook from `useChat`'s `onFinish`.
  describe("refresh after a new answer", () => {
    function Asker() {
      const refresh = useHistoryRefresh();
      return (
        <button type="button" onClick={refresh}>
          terminar respuesta
        </button>
      );
    }

    const older = {
      id: "q-1",
      question: "¿Debo facturar electrónicamente?",
      answer: "Sí…",
      citations: [],
      created_at: "2026-08-01T10:00:00Z",
    };
    const newer = {
      id: "q-2",
      question: "¿Cuándo vence el D-101?",
      answer: "En…",
      citations: [],
      created_at: "2026-08-02T10:00:00Z",
    };

    function respondWith(...batches: (typeof older)[][]) {
      for (const questions of batches) {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ questions }),
        });
      }
    }

    async function renderAndFinish() {
      render(
        <HistoryShell signedIn>
          <Asker />
        </HistoryShell>,
      );
      await screen.findAllByText("¿Debo facturar electrónicamente?");
      const { default: userEvent } =
        await import("@testing-library/user-event");
      await userEvent.click(
        screen.getByRole("button", { name: "terminar respuesta" }),
      );
    }

    it("shows the new question without a reload", async () => {
      respondWith([older], [newer, older]);
      await renderAndFinish();

      expect(
        (await screen.findAllByText("¿Cuándo vence el D-101?")).length,
      ).toBeGreaterThan(0);
    });

    // /api/ask persists from the model stream's `onFinish`, which is not
    // ordered against the last byte the browser reads — so the first refetch
    // can legitimately come back without the row.
    it("retries when the first refetch has not caught the new row yet", async () => {
      vi.useFakeTimers();
      try {
        respondWith([older], [older], [newer, older]);
        render(
          <HistoryShell signedIn>
            <Asker />
          </HistoryShell>,
        );
        await vi.waitFor(() =>
          expect(
            screen.getAllByText("¿Debo facturar electrónicamente?").length,
          ).toBeGreaterThan(0),
        );
        screen
          .getByRole("button", { name: "terminar respuesta" })
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));

        await vi.advanceTimersByTimeAsync(1000);
        await vi.waitFor(() =>
          expect(
            screen.getAllByText("¿Cuándo vence el D-101?").length,
          ).toBeGreaterThan(0),
        );
        expect(fetchMock).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives up quietly after three attempts", async () => {
      vi.useFakeTimers();
      try {
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ questions: [older] }),
        });
        render(
          <HistoryShell signedIn>
            <Asker />
          </HistoryShell>,
        );
        await vi.waitFor(() =>
          expect(
            screen.getAllByText("¿Debo facturar electrónicamente?").length,
          ).toBeGreaterThan(0),
        );
        screen
          .getByRole("button", { name: "terminar respuesta" })
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));

        await vi.advanceTimersByTimeAsync(10_000);
        // The initial load plus three refresh attempts, then it stops.
        expect(fetchMock).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
