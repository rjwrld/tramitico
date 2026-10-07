// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { CardTitle } from "@/components/ui/card";

afterEach(cleanup);

describe("CardTitle", () => {
  it("is a div by default and the page's heading when asked (#492)", () => {
    render(
      <>
        <CardTitle>Sin rango</CardTitle>
        <CardTitle as="h1">Iniciar sesión</CardTitle>
      </>,
    );
    expect(screen.getByText("Sin rango").tagName).toBe("DIV");
    expect(
      screen.getByRole("heading", { level: 1, name: "Iniciar sesión" }),
    ).toBeTruthy();
  });
});
