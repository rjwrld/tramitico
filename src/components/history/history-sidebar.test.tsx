// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistorySidebar, type HistoryItem } from "./history-sidebar";

afterEach(cleanup);

const items: HistoryItem[] = [
  {
    id: "q-2",
    question: "¿Cómo pago la CCSS como independiente?",
    answer: "Debe inscribirse…",
    citations: [],
    created_at: "2026-08-02T10:00:00Z",
  },
  {
    id: "q-1",
    question: "¿Debo facturar electrónicamente?",
    answer: "Sí…",
    citations: [],
    created_at: "2026-08-01T10:00:00Z",
  },
];

const noop = () => {};

describe("HistorySidebar", () => {
  it("shows the empty state when there are no questions", () => {
    render(<HistorySidebar items={[]} onSelect={noop} onDelete={noop} />);
    expect(screen.getByText("Sin preguntas todavía")).toBeTruthy();
  });

  it("lists questions in the order given (newest first from the API)", () => {
    render(<HistorySidebar items={items} onSelect={noop} onDelete={noop} />);
    const listed = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(listed[0]).toContain("CCSS");
    expect(listed[1]).toContain("facturar");
  });

  it("selects an item on click", async () => {
    const onSelect = vi.fn();
    render(
      <HistorySidebar items={items} onSelect={onSelect} onDelete={noop} />,
    );
    await userEvent.click(screen.getByText("¿Debo facturar electrónicamente?"));
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it("requires a confirm step before deleting", async () => {
    const onDelete = vi.fn();
    render(
      <HistorySidebar items={items} onSelect={noop} onDelete={onDelete} />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Eliminar: ¿Debo facturar electrónicamente?",
      }),
    );
    expect(onDelete).not.toHaveBeenCalled();
    expect(
      screen.getByText("¿Eliminar esta pregunta del historial?"),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onDelete).toHaveBeenCalledWith("q-1");
  });

  it("cancel backs out of the confirm step without deleting", async () => {
    const onDelete = vi.fn();
    render(
      <HistorySidebar items={items} onSelect={noop} onDelete={onDelete} />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Eliminar: ¿Debo facturar electrónicamente?",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("¿Eliminar esta pregunta del historial?")).toBe(
      null,
    );
    expect(screen.getByText("¿Debo facturar electrónicamente?")).toBeTruthy();
  });
});
