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

  describe("inline references (#133)", () => {
    const REFERENCES = { count: 2, anchorPrefix: "a1" };

    it("renders each marker as a superscript named for its source", () => {
      render(
        <AnswerProse
          text="La tarifa general es del 13%[1] y hay exenciones[2]."
          references={REFERENCES}
        />,
      );

      const links = screen.getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(["1", "2"]);
      expect(screen.getByRole("link", { name: "fuente 1" })).toHaveProperty(
        "hash",
        "#a1-fuente-1",
      );
      expect(screen.getByRole("link", { name: "fuente 2" })).toHaveProperty(
        "hash",
        "#a1-fuente-2",
      );
      // The digits are references, not prose.
      expect(links.every((link) => link.closest("sup") !== null)).toBe(true);
    });

    it("keeps the reference in the claim it belongs to", () => {
      render(
        <AnswerProse
          text={["- Inscribirse[1]", "- Facturar[2]"].join("\n")}
          references={REFERENCES}
        />,
      );

      const items = screen.getAllByRole("listitem");
      expect(items[0].textContent).toBe("Inscribirse1");
      expect(
        within(items[0]).getByRole("link", { name: "fuente 1" }),
      ).toBeTruthy();
      expect(
        within(items[1]).getByRole("link", { name: "fuente 2" }),
      ).toBeTruthy();
    });

    it("cites the same source twice with the same number", () => {
      render(
        <AnswerProse
          text="Primero[1]. Y otra vez[1]."
          references={REFERENCES}
        />,
      );

      const links = screen.getAllByRole("link", { name: "fuente 1" });
      expect(links).toHaveLength(2);
      expect(new Set(links.map((link) => link.getAttribute("href")))).toEqual(
        new Set(["#a1-fuente-1"]),
      );
    });

    it("renders inside bold and table cells too", () => {
      render(
        <AnswerProse
          text={[
            "Lo **importante[1]** es esto.",
            "",
            "| Tramo | Tarifa |",
            "| --- | --- |",
            "| Primero[2] | 10% |",
          ].join("\n")}
          references={REFERENCES}
        />,
      );

      expect(screen.getAllByRole("link", { name: "fuente 1" })).toHaveLength(1);
      const cell = screen.getByRole("cell", { name: /Primero/ });
      expect(within(cell).getByRole("link", { name: "fuente 2" })).toBeTruthy();
    });

    it("drops a marker with no source and never invents a link", () => {
      const { container } = render(
        <AnswerProse
          text="Sin respaldo[7] y con enlace [click](https://evil.example)."
          references={REFERENCES}
        />,
      );

      expect(screen.queryByRole("link", { name: "fuente 7" })).toBeNull();
      expect(container.textContent).not.toContain("[7]");
      // The only anchors this renders are same-page fragments it built.
      expect(
        Array.from(container.querySelectorAll("a")).every((a) =>
          a.getAttribute("href")?.startsWith("#a1-fuente-"),
        ),
      ).toBe(true);
      expect(container.textContent).toContain("https://evil.example");
    });

    it("renders markers as inert text when the answer has no sources", () => {
      const { container } = render(<AnswerProse text="Una cosa[1]." />);

      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(container.textContent).toBe("Una cosa.");
    });
  });

  it("caps the measure and sets the answer-prose rhythm (DESIGN §3)", () => {
    const { container } = render(<AnswerProse text="Una respuesta." />);

    const root = container.firstElementChild!;
    expect(root.className).toContain("max-w-[68ch]");
    expect(root.className).toContain("leading-[1.7]");
    expect(root.className).toContain("text-pretty");
  });
});
