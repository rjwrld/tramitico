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
  // Stands in for the chat, which calls the same context hook from
  // `useChat`'s `onFinish`.
  function Refresher() {
    const refresh = useHistoryRefresh();
    return (
      <button type="button" onClick={refresh}>
        terminar respuesta
      </button>
    );
  }

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

  /**
   * The fold is a transition (DESIGN §8, panel transitions), so the sidebar
   * stays mounted while closed. What unmounting used to guarantee — nothing
   * inside it is reachable or announced — now rests on `inert` and
   * `aria-hidden`, which is what this asserts.
   */
  it("collapse toggle folds the sidebar inert and unfolds it", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ questions: [] }),
    });
    render(
      <HistoryShell signedIn>
        <p>contenido principal</p>
      </HistoryShell>,
    );
    const nav = await screen.findByRole("navigation", { name: "Historial" });
    const aside = nav.closest("aside");
    if (!aside) throw new Error("sidebar has no aside");
    expect(aside.hasAttribute("inert")).toBe(false);

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(
      screen.getByRole("button", { name: "Ocultar historial" }),
    );
    expect(aside.hasAttribute("inert")).toBe(true);
    expect(aside.getAttribute("aria-hidden")).toBe("true");
    // Out of the accessibility tree, not just visually folded.
    expect(screen.queryByRole("navigation", { name: "Historial" })).toBe(null);

    await userEvent.click(
      screen.getByRole("button", { name: "Mostrar historial" }),
    );
    expect(aside.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("navigation", { name: "Historial" })).toBeTruthy();
  });

  it("folding with focus inside the sidebar hands focus to the toggle", async () => {
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
    const nav = await screen.findByRole("navigation", { name: "Historial" });
    within(nav).getAllByRole("button")[0].focus();
    expect(nav.contains(document.activeElement)).toBe(true);

    const toggle = screen.getByRole("button", { name: "Ocultar historial" });
    // Fire the handler without the click moving focus first — this is the
    // Safari path, where a clicked button does not take focus.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(toggle);

    expect(document.activeElement).toBe(toggle);
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

  // Two writers, one list (#213). A delete that is still in flight must not
  // let a snapshot of the pre-delete list — its own, or one a concurrent
  // refresh fetched from the server — put a removed row back on screen.
  describe("concurrent deletes and refreshes", () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    const rowA = {
      id: "q-a",
      question: "¿Debo facturar electrónicamente?",
      answer: "Sí…",
      citations: [],
      created_at: "2026-08-02T10:00:00Z",
    };
    const rowB = {
      id: "q-b",
      question: "¿Cuándo vence el D-101?",
      answer: "En…",
      citations: [],
      created_at: "2026-08-01T10:00:00Z",
    };

    function historyResponse(questions: HistoryItem[]) {
      return { ok: true, json: async () => ({ questions }) };
    }

    async function confirmDelete(
      userEvent: { click: (element: Element) => Promise<void> },
      question: string,
    ) {
      await userEvent.click(
        screen.getByRole("button", { name: `Eliminar: ${question}` }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    }

    it("a failed delete restores only its own row, not the list it started with", async () => {
      const slowA = deferred<{ ok: boolean; status: number }>();
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method !== "DELETE") {
          return Promise.resolve(historyResponse([rowA, rowB]));
        }
        if (url === "/api/history/q-a") return slowA.promise;
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      });

      render(
        <HistoryShell signedIn>
          <p>contenido principal</p>
        </HistoryShell>,
      );
      await screen.findByText(rowA.question);
      const { default: userEvent } =
        await import("@testing-library/user-event");

      await confirmDelete(userEvent, rowA.question);
      await confirmDelete(userEvent, rowB.question);
      expect(screen.queryByText(rowA.question)).toBe(null);
      expect(screen.queryByText(rowB.question)).toBe(null);

      slowA.resolve({ ok: false, status: 500 });

      expect(await screen.findByText(rowA.question)).toBeTruthy();
      expect(
        screen.queryByText(rowB.question),
        "the row whose delete succeeded came back",
      ).toBe(null);
    });

    it("a refresh that overlaps a delete does not bring the row back", async () => {
      const newest = {
        id: "q-c",
        question: "¿Qué es el IVA?",
        answer: "El…",
        citations: [],
        created_at: "2026-08-03T10:00:00Z",
      };
      const slowA = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
      let loaded = false;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return slowA.promise;
        // The refresh reads the server *before* the DELETE commits, so it
        // still carries the row being deleted.
        const questions = loaded ? [newest, rowA, rowB] : [rowA, rowB];
        loaded = true;
        return Promise.resolve(historyResponse(questions));
      });

      render(
        <HistoryShell signedIn>
          <Refresher />
        </HistoryShell>,
      );
      await screen.findByText(rowA.question);
      const { default: userEvent } =
        await import("@testing-library/user-event");

      await confirmDelete(userEvent, rowA.question);
      expect(screen.queryByText(rowA.question)).toBe(null);

      await userEvent.click(
        screen.getByRole("button", { name: "terminar respuesta" }),
      );
      expect(await screen.findByText(newest.question)).toBeTruthy();
      expect(
        screen.queryByText(rowA.question),
        "the refresh resurrected the row being deleted",
      ).toBe(null);

      slowA.resolve({ ok: true, json: async () => ({ ok: true }) });
      await waitFor(() => expect(screen.queryByText(rowA.question)).toBe(null));
      expect(screen.getByText(rowB.question)).toBeTruthy();
    });

    // The other ordering: the read is the slow one. It left before the delete
    // did, so it carries pre-delete state and must not win, however long it
    // takes to come back.
    it("a refresh that started before the delete does not bring the row back", async () => {
      const staleRead = deferred<{
        ok: boolean;
        json: () => Promise<unknown>;
      }>();
      let reads = 0;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true }),
          });
        }
        reads += 1;
        // The first read is the initial load; the second is the refresh, and
        // it hangs until the delete has already come back successful.
        return reads === 1
          ? Promise.resolve(historyResponse([rowA, rowB]))
          : staleRead.promise;
      });

      render(
        <HistoryShell signedIn>
          <Refresher />
        </HistoryShell>,
      );
      await screen.findByText(rowA.question);
      const { default: userEvent } =
        await import("@testing-library/user-event");

      await userEvent.click(
        screen.getByRole("button", { name: "terminar respuesta" }),
      );
      await confirmDelete(userEvent, rowA.question);
      expect(screen.queryByText(rowA.question)).toBe(null);

      staleRead.resolve(historyResponse([rowA, rowB]));
      await waitFor(() => expect(screen.getByText(rowB.question)).toBeTruthy());
      expect(
        screen.queryByText(rowA.question),
        "a read that predates the delete resurrected the row",
      ).toBe(null);
    });
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

    /**
     * #172: the ground scrolls one level in, not as the document. jsdom lays
     * nothing out, so the observable here is structural — the restored answer
     * sits inside a scroll region, and the sheet trigger sits outside it. That
     * is precisely what keeps the trigger reachable from a scrolled answer:
     * when it scrolled away with the document, reaching it meant returning to
     * the top, and the reader's place was gone. The offsets themselves are
     * asserted in a real browser (e2e/history-mobile.local.spec.ts).
     */
    it("puts the restored answer in a scroll region the trigger is outside of", async () => {
      fetchMock.mockResolvedValue(historyResponse([item]));
      const { container } = render(
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
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /^¿Debo facturar electrónicamente\?/,
        }),
      );
      const article = await waitFor(() => {
        const found = container.querySelector("article");
        expect(found).not.toBe(null);
        return found!;
      });

      const scroller = article.closest(".overflow-y-auto");
      expect(scroller, "the restored answer has no scroll region").not.toBe(
        null,
      );
      // Every ancestor between the scroller and the `h-dvh` shell must refuse
      // to grow past it, or the overflow escapes to the document again.
      expect(scroller!.parentElement!.className).toContain("min-h-0");
      expect(
        scroller!.contains(
          screen.getByRole("button", { name: "Abrir historial" }),
        ),
        "the sheet trigger scrolls with the ground",
      ).toBe(false);
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
