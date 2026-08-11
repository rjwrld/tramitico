// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AnswerProse } from "@/components/chat/answer-prose";

afterEach(cleanup);

const TRAMOS = [
  "Los tramos vigentes son:",
  "",
  "| Tramo | Tarifa |",
  "| --- | --- |",
  "| Hasta ¢6.244.000,00 | No sujeta |",
  "| Exceso hasta ¢9.322.000,00 | 10% |",
].join("\n");

describe("AnswerProse", () => {
  it("renders a `- ` run as one list with the prefixes stripped", () => {
    const { container } = render(
      <AnswerProse
        text={[
          "Debe hacer lo siguiente:",
          "",
          "- Inscribirse con el D-140",
          "- Emitir factura electrónica",
          "- Presentar el D-104",
        ].join("\n")}
      />,
    );

    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      [
        "Inscribirse con el D-140",
        "Emitir factura electrónica",
        "Presentar el D-104",
      ],
    );
    expect(container.textContent).not.toContain("- ");
  });

  it("merges bullets separated by a blank line into one list (#95)", () => {
    const { container } = render(
      <AnswerProse
        text={[
          "Debe hacer lo siguiente:",
          "",
          "- Inscribirse con el D-140",
          "",
          "- Emitir factura electrónica",
          "",
          "- Presentar el D-104",
        ].join("\n")}
      />,
    );

    expect(container.querySelectorAll("ul")).toHaveLength(1);
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.textContent)).toEqual([
      "Inscribirse con el D-140",
      "Emitir factura electrónica",
      "Presentar el D-104",
    ]);
  });

  it("keeps bullets separated by a paragraph in two lists (#95)", () => {
    const { container } = render(
      <AnswerProse
        text={[
          "- Uno",
          "",
          "Algo de contexto entre las dos listas.",
          "",
          "- Dos",
        ].join("\n")}
      />,
    );

    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(2);
    expect(lists[0].textContent).toBe("Uno");
    expect(lists[1].textContent).toBe("Dos");
    // Document order preserved: list, paragraph, list.
    expect(
      Array.from(container.querySelectorAll("p, ul")).map((n) => n.tagName),
    ).toEqual(["UL", "P", "UL"]);
  });

  it("renders every prefix of a blank-line-separated bullet stream without throwing (#95)", () => {
    const full = [
      "Intro:",
      "",
      "- Uno",
      "",
      "- Dos",
      "",
      "- Tres",
      "",
      "Cierre.",
    ].join("\n");

    for (let i = 1; i <= full.length; i++) {
      const { unmount } = render(<AnswerProse text={full.slice(0, i)} />);
      unmount();
    }
  });

  it("gives the list a hanging indent and a muted marker (DESIGN §3)", () => {
    const { container } = render(<AnswerProse text={"- Uno\n- Dos"} />);

    const list = container.querySelector("ul")!;
    expect(list.className).toContain("list-disc");
    expect(list.className).toContain("pl-5");
    expect(list.className).not.toContain("list-inside");
    expect(list.className).toContain("marker:text-border");
  });

  it("renders **bold** as <strong> without the asterisks", () => {
    const { container } = render(
      <AnswerProse text="La **renta neta** es la base del cálculo." />,
    );

    const strong = screen.getByText("renta neta");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-medium");
    expect(container.textContent).toBe("La renta neta es la base del cálculo.");
  });

  it("an odd number of ** does not swallow the rest of the paragraph", () => {
    const { container } = render(
      <AnswerProse text="Debe pagar el **impuesto sobre la renta antes del 15 de diciembre." />,
    );

    expect(container.textContent).toBe(
      "Debe pagar el impuesto sobre la renta antes del 15 de diciembre.",
    );
    // Asserting the text alone is vacuous here — a text-node renderer cannot
    // lose it. What must not happen is the unclosed run carrying weight to
    // the end of the block.
    expect(container.querySelectorAll("strong")).toHaveLength(0);
  });

  it("bolds the closed pairs and leaves a trailing unclosed run plain", () => {
    const { container } = render(
      <AnswerProse text="La **renta neta** menos los **gastos deducibles" />,
    );

    expect(
      Array.from(container.querySelectorAll("strong")).map(
        (el) => el.textContent,
      ),
    ).toEqual(["renta neta"]);
    expect(container.textContent).toBe(
      "La renta neta menos los gastos deducibles",
    );
  });

  it("bolds a run as soon as its closing ** streams in", () => {
    const open = render(<AnswerProse text="La **renta neta" />);
    expect(open.container.querySelectorAll("strong")).toHaveLength(0);
    open.unmount();

    const closed = render(<AnswerProse text="La **renta neta**" />);
    expect(closed.container.querySelector("strong")?.textContent).toBe(
      "renta neta",
    );
  });

  it("renders a pipe table with a head, a body and no rule row", () => {
    const { container } = render(<AnswerProse text={TRAMOS} />);

    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Tramo", "Tarifa"]);
    // Header row + two data rows: the `| --- |` rule row is gone.
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(
      Array.from(table.querySelectorAll("tbody td")).map(
        (td) => td.textContent,
      ),
    ).toEqual([
      "Hasta ¢6.244.000,00",
      "No sujeta",
      "Exceso hasta ¢9.322.000,00",
      "10%",
    ]);
    expect(container.textContent).not.toContain("|");
    expect(container.textContent).not.toContain("---");
  });

  it("sets the table body in mono with tabular numerals (DESIGN §3)", () => {
    const { container } = render(<AnswerProse text={TRAMOS} />);

    const body = container.querySelector("tbody")!;
    expect(body.className).toContain("font-mono");
    expect(body.className).toContain("tabular-nums");
  });

  it("does not turn a single |-delimited line into a table", () => {
    const { container } = render(
      <AnswerProse text={"Un ejemplo de fila:\n\n| solo una línea |"} />,
    );

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("| solo una línea |");
  });

  it("keeps a lead-in line that shares the block with the table", () => {
    const { container } = render(
      <AnswerProse
        text={"Los tramos:\n| Tramo | Tarifa |\n| --- | --- |\n| ¢0 | 0% |"}
      />,
    );

    expect(container.textContent).toContain("Los tramos:");
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("keeps document order across paragraph, list, table and paragraph", () => {
    const { container } = render(
      <AnswerProse
        text={[
          "Primero, el contexto.",
          "",
          "- Uno",
          "- Dos",
          "",
          "| Tramo | Tarifa |",
          "| --- | --- |",
          "| ¢0 | 0% |",
          "",
          "Por último, el cierre.",
        ].join("\n")}
      />,
    );

    expect(
      Array.from(container.querySelectorAll("p, ul, table")).map(
        (node) => node.tagName,
      ),
    ).toEqual(["P", "UL", "TABLE", "P"]);
  });

  it("leaves a hyphen mid-sentence alone", () => {
    const { container } = render(
      <AnswerProse text="Guion medio - así se escribe." />,
    );

    expect(container.querySelector("ul")).toBeNull();
    expect(container.textContent).toBe("Guion medio - así se escribe.");
  });

  it("degrades a stray heading to a lead-in line, never literal hashes", () => {
    const { container } = render(
      <AnswerProse text={"## Tramos aplicables\n\nEl primer tramo no paga."} />,
    );

    expect(container.textContent).toContain("Tramos aplicables");
    expect(container.textContent).not.toContain("#");
    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
  });

  it("degrades a heading that shares its block with the list below it", () => {
    const { container } = render(
      <AnswerProse text={"### Requisitos\n- Uno\n- Dos"} />,
    );

    expect(container.textContent).not.toContain("#");
    expect(container.textContent).not.toContain("- ");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders every prefix of a streaming answer without throwing", () => {
    const full = [
      "Los **tramos** vigentes:",
      "",
      "- Primero, **10%**",
      "- Segundo",
      "",
      "| Tramo | Tarifa |",
      "| --- | --- |",
      "| ¢0 | 0% |",
    ].join("\n");

    for (let i = 1; i <= full.length; i++) {
      const { unmount } = render(<AnswerProse text={full.slice(0, i)} />);
      unmount();
    }
  });

  it.each([
    ["a trailing bullet marker", "Debe:\n\n- Uno\n- "],
    ["a half-open bold run", "La **renta"],
    ["a half-written table row", "| Tramo | Tarifa |\n| --- | --- |\n| ¢0 |"],
    ["nothing yet", ""],
  ])("renders %s without throwing", (_label, text) => {
    expect(() => render(<AnswerProse text={text} />)).not.toThrow();
  });

  it("renders echoed HTML and image URLs as inert text", () => {
    const hostile = [
      "<script>alert(1)</script>",
      "",
      "- <img src=x onerror=1>",
      "",
      "| Fuente | URL |",
      "| --- | --- |",
      "| Beacon | https://evil.example/px.png |",
    ].join("\n");

    const { container } = render(<AnswerProse text={hostile} />);

    expect(
      container.querySelectorAll("script, img, a, iframe, style"),
    ).toHaveLength(0);
    // `onerror` may appear inside a text node — what must not exist is an
    // element carrying it (or any other handler) as an attribute.
    expect(
      Array.from(container.querySelectorAll("*")).filter((el) =>
        el.getAttributeNames().some((name) => name.startsWith("on")),
      ),
    ).toHaveLength(0);
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x onerror=1>");
    expect(container.textContent).toContain("https://evil.example/px.png");
  });

  it("caps the measure and sets the answer-prose rhythm (DESIGN §3)", () => {
    const { container } = render(<AnswerProse text="Una respuesta." />);

    const root = container.firstElementChild!;
    expect(root.className).toContain("max-w-[68ch]");
    expect(root.className).toContain("leading-[1.7]");
    expect(root.className).toContain("text-pretty");
  });
});
