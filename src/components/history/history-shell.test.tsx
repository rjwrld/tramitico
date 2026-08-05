// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    throw new Error("browser client should not be created in these tests");
  },
}));

import { HistoryShell } from "./history-shell";

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
});
