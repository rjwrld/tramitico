// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmInline } from "./confirm-inline";

afterEach(cleanup);

const noop = () => {};

describe("ConfirmInline", () => {
  it("shows the prompt and the explicit-verb confirm button", () => {
    render(
      <ConfirmInline
        prompt="¿Eliminar esta pregunta del historial?"
        confirmLabel="Eliminar"
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    expect(
      screen.getByText("¿Eliminar esta pregunta del historial?"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("calls onConfirm on the destructive button", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmInline
        prompt="Esto no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel on the cancel button", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmInline
        prompt="Esto no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both paths while the action is in flight", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmInline
        prompt="Esto no se puede deshacer."
        confirmLabel="Eliminar"
        disabled
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("carries the shared radius token alongside a call-site className (#116)", () => {
    render(
      <ConfirmInline
        className="mt-1"
        prompt="Esto no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    const root = screen.getByText("Esto no se puede deshacer.").parentElement;
    expect(root?.className).toContain("rounded-lg");
    expect(root?.className).toContain("mt-1");
  });

  it("renders as the element the call site asks for", () => {
    render(
      <ul>
        <ConfirmInline
          render={<li />}
          prompt="Esto no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={noop}
          onCancel={noop}
        />
      </ul>,
    );

    expect(screen.getByRole("listitem")).toBeTruthy();
  });
});
