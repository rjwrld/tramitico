// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, buttonVariants } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("fires onClick and respects disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Enviar</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Enviar
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("confirms a destructive action", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="destructive" onClick={onClick}>
        Eliminar
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // Issue #160. `tokens.test.ts` proves the token *pair* meets AA; this proves
  // the variant is actually wired to that pair. An alpha utility here
  // (`bg-destructive/20`) would pass the token check and still ship the bug,
  // because the ground would be computed from the text colour at paint time.
  it("grounds the destructive variant in --destructive-bg, never an alpha of the text", () => {
    render(<Button variant="destructive">Eliminar</Button>);
    const cls = screen.getByRole("button", { name: "Eliminar" }).className;

    expect(cls).toContain("bg-destructive-bg");
    expect(cls).toContain("hover:bg-destructive-bg-hover");
    expect(cls).toContain("text-destructive");
    expect(cls).not.toMatch(/(?:^|:)bg-destructive\//);
  });

  // A `<Link>` styled with `buttonVariants` used to carry both the base
  // `border-transparent` and the outline's `border-border`; the transparent
  // one won on stylesheet order, so "Iniciar sesión" had no hairline in light.
  it("resolves the outline border for callers outside <Button>", () => {
    const cls = buttonVariants({ variant: "outline" }).split(" ");

    expect(cls).toContain("border-border");
    expect(cls).not.toContain("border-transparent");
  });

  // Half-opacity sello red reads as pink — an error tint. Disabled, the one
  // filled primary goes to the muted ground at full opacity instead.
  it("greys the disabled primary instead of fading its red", () => {
    render(<Button disabled>Enviar</Button>);
    const cls = screen
      .getByRole("button", { name: "Enviar" })
      .className.split(" ");

    expect(cls).toContain("disabled:bg-muted");
    expect(cls).toContain("disabled:text-muted-foreground");
    expect(cls).toContain("disabled:opacity-100");
    expect(cls).not.toContain("disabled:opacity-50");
  });
});
