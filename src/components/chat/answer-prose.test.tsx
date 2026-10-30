// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AnswerProse, gluePercent } from "@/components/chat/answer-prose";
import type { Citation } from "@/lib/citations";

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

  it("sets a bold-only line as a section lead-in, apart from the prose after it", () => {
    const { container } = render(
      <AnswerProse
        text={
          "**Próximos pasos**\nInscríbase en TRIBU-CR.\n\n**Plazos:**\n- Uno"
        }
      />,
    );

    const leads = container.querySelectorAll('[data-slot="answer-lead"]');
    expect([...leads].map((lead) => lead.textContent)).toEqual([
      "Próximos pasos",
      "Plazos:",
    ]);
    expect(container.textContent).not.toContain("**");
    expect(screen.getByText("Inscríbase en TRIBU-CR.").tagName).toBe("P");
  });

  it("keeps a bold run inside a sentence as inline bold, not a lead-in", () => {
    const { container } = render(
      <AnswerProse text={"La tarifa es **13%** para servicios."} />,
    );

    expect(container.querySelector('[data-slot="answer-lead"]')).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("13%");
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
    const CITATIONS: Citation[] = [
      {
        docKey: "ley-iva",
        docTitle: "Ley del Impuesto sobre el Valor Agregado",
        norma: "Ley 6826",
        articulo: "Artículo 8",
        url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=1",
      },
      {
        docKey: "reglamento-iva",
        docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
        norma: "Decreto Ejecutivo 41779",
        articulo: "Artículo 11",
        url: null,
      },
    ];
    const chips = () => screen.queryAllByRole("button", { name: /^Fuente/ });

    it("renders each marker as a chip named for its source", () => {
      render(
        <AnswerProse
          text="La tarifa general es del 13%[1] y hay exenciones[2]."
          citations={CITATIONS}
        />,
      );

      expect(chips().map((chip) => chip.textContent)).toEqual(["1", "2"]);
      expect(chips().map((chip) => chip.getAttribute("aria-label"))).toEqual([
        "Fuente 1: Ley IVA · Art. 8",
        "Fuente 2: Reglamento IVA · Art. 11",
      ]);
      // Not a link any more: the chip brings the card, it goes nowhere.
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    });

    it("keeps the chip on the word it qualifies — no line break between them", () => {
      render(<AnswerProse text="exenciones[2]." citations={CITATIONS} />);

      // An inline span, not an atomic button: the line cannot break before it.
      const chip = chips()[0];
      expect(chip.tagName).toBe("SPAN");
      expect(chip.previousSibling?.textContent).toBe("exenciones");
    });

    it("keeps the reference in the claim it belongs to", () => {
      render(
        <AnswerProse
          text={["- Inscribirse[1]", "- Facturar[2]"].join("\n")}
          citations={CITATIONS}
        />,
      );

      const items = screen.getAllByRole("listitem");
      expect(items[0].textContent).toBe("Inscribirse1");
      expect(
        within(items[0]).getByRole("button", { name: /^Fuente 1/ }),
      ).toBeTruthy();
      expect(
        within(items[1]).getByRole("button", { name: /^Fuente 2/ }),
      ).toBeTruthy();
    });

    it("cites the same source twice with the same number", () => {
      render(
        <AnswerProse text="Primero[1]. Y otra vez[1]." citations={CITATIONS} />,
      );

      expect(chips().map((chip) => chip.textContent)).toEqual(["1", "1"]);
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
          citations={CITATIONS}
        />,
      );

      expect(screen.getAllByRole("button", { name: /^Fuente 1/ })).toHaveLength(
        1,
      );
      const cell = screen.getByRole("cell", { name: /Primero/ });
      expect(
        within(cell).getByRole("button", { name: /^Fuente 2/ }),
      ).toBeTruthy();
    });

    it("drops a marker with no source and never turns markdown into a link", () => {
      const { container } = render(
        <AnswerProse
          text="Sin respaldo[7] y con enlace [click](https://evil.example)."
          citations={CITATIONS}
        />,
      );

      expect(chips()).toHaveLength(0);
      expect(container.textContent).not.toContain("[7]");
      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(container.textContent).toContain("https://evil.example");
    });

    it("renders markers as nothing when the answer has no sources", () => {
      const { container } = render(<AnswerProse text="Una cosa[1]." />);

      expect(chips()).toHaveLength(0);
      expect(container.textContent).toBe("Una cosa.");
    });
  });

  describe("official links", () => {
    const links = () => screen.queryAllByRole("link");

    it("links an official URL, showing it without scheme or www.", () => {
      render(
        <AnswerProse text="Inscríbase en https://aissfa.ccss.sa.cr/afiliacion o en https://www.ccss.sa.cr/." />,
      );

      expect(links().map((a) => a.getAttribute("href"))).toEqual([
        "https://aissfa.ccss.sa.cr/afiliacion",
        "https://www.ccss.sa.cr/",
      ]);
      expect(links().map((a) => a.textContent)).toEqual([
        "aissfa.ccss.sa.cr/afiliacion",
        "ccss.sa.cr",
      ]);
      for (const a of links()) {
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      }
    });

    it("leaves the sentence's punctuation out of the link", () => {
      const { container } = render(
        <AnswerProse text="Confírmelo en https://www.hacienda.go.cr. Y (https://sinalevi.go.cr/x), listo." />,
      );

      expect(links().map((a) => a.getAttribute("href"))).toEqual([
        "https://www.hacienda.go.cr/",
        "https://sinalevi.go.cr/x",
      ]);
      expect(container.textContent).toBe(
        "Confírmelo en hacienda.go.cr. Y (sinalevi.go.cr/x), listo.",
      );
    });

    it("keeps an official link right before its reference chip", () => {
      render(
        <AnswerProse
          text="Inscríbase en https://aissfa.ccss.sa.cr/afiliacion[1]."
          citations={[
            {
              docKey: "ccss-faq",
              docTitle: "Preguntas frecuentes",
              norma: null,
              articulo: null,
              url: null,
            },
          ]}
        />,
      );

      expect(links()[0].getAttribute("href")).toBe(
        "https://aissfa.ccss.sa.cr/afiliacion",
      );
      expect(screen.getByRole("button", { name: /^Fuente 1/ })).toBeTruthy();
    });

    it("leaves every other URL as text", () => {
      const { container } = render(
        <AnswerProse
          text={[
            "http://www.ccss.sa.cr",
            "https://ccss.sa.cr.evil.example/x",
            "https://www.contadorescr.com/guia",
            "https://ccss.sa.cr@evil.example",
            "javascript:alert(1)",
          ].join(" ")}
        />,
      );

      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(container.textContent).toContain(
        "https://ccss.sa.cr.evil.example/x",
      );
    });

    it("links an official email address and leaves any other as text", () => {
      render(
        <AnswerProse text="Escriba a cobros@ccss.sa.cr o a alguien@gmail.com." />,
      );

      expect(links().map((a) => a.getAttribute("href"))).toEqual([
        "mailto:cobros@ccss.sa.cr",
      ]);
      expect(links()[0].textContent).toBe("cobros@ccss.sa.cr");
    });

    it("fades a link in whole during the reveal (#219)", () => {
      const { container } = render(
        <AnswerProse
          text="Vea https://www.hacienda.go.cr hoy."
          reveal={{ delayFor: (i) => i * 10 }}
        />,
      );

      const tokens = Array.from(
        container.querySelectorAll<HTMLElement>(".animate-word-fade"),
      ).map((token) => token.textContent);
      expect(tokens).toEqual(["Vea ", "hacienda.go.cr", " ", "hoy."]);
    });
  });

  it("caps the measure and sets the answer-prose rhythm (DESIGN §3)", () => {
    const { container } = render(<AnswerProse text="Una respuesta." />);

    const root = container.firstElementChild!;
    expect(root.className).toContain("max-w-[68ch]");
    expect(root.className).toContain("leading-[1.7]");
    expect(root.className).toContain("text-pretty");
  });

  // #492: at phone width «0» ended a line and «%» opened the next.
  it("keeps a spaced percent sign on its number's line", () => {
    expect(gluePercent("tarifa 0 % y 13 %.")).toBe(
      "tarifa 0\u00a0% y 13\u00a0%.",
    );
    // Only a digit's own sign: prose with a free-standing «%» is untouched.
    expect(gluePercent("el % de la base")).toBe("el % de la base");

    const { container } = render(
      <AnswerProse
        text={"| Concepto | Tarifa |\n|---|---|\n| Exportación | 0 % |"}
      />,
    );
    expect(container.querySelector("td:last-child")?.textContent).toBe(
      "0\u00a0%",
    );
  });
});
