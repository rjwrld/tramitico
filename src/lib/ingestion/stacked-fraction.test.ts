import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { textToParagraphs } from "./extract";
import { readStackedBlock, renderStackedFraction } from "./stacked-fraction";

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
}

const bienes = () => fixture("reglamento-iva-bienes-capital-formula.txt");
const retencion = () =>
  fixture("reglamento-iva-retencion-tarjetas-formulas.txt");

describe("readStackedBlock", () => {
  it("restores the bar of a bare two-line fraction", () => {
    expect(
      readStackedBlock([
        "                                            𝐶𝑎0 ‒ 𝐶𝑎𝑖",
        "                                                 4",
      ]),
    ).toBe("(𝐶𝑎0 ‒ 𝐶𝑎𝑖)/(4)");
  });

  it("splices two fractions back into the expression they sit inside", () => {
    expect(
      readStackedBlock([
        "                                                        𝑇𝑀     1",
        "                   𝑃𝑜𝑟𝑐𝑒𝑛𝑡𝑎𝑗𝑒 𝑑𝑒 𝑟𝑒𝑡𝑒𝑛𝑐𝑖ó𝑛 = 𝐹𝑅 ∗          ∗",
        "                                                        13% 1 + 𝑇𝑀",
      ]),
    ).toBe("𝑃𝑜𝑟𝑐𝑒𝑛𝑡𝑎𝑗𝑒 𝑑𝑒 𝑟𝑒𝑡𝑒𝑛𝑐𝑖ó𝑛 = 𝐹𝑅 ∗ (𝑇𝑀)/(13%) ∗ (1)/(1 + 𝑇𝑀)");
  });

  it("reads a fraction whose expression line stops at the equals sign", () => {
    expect(
      readStackedBlock([
        "                                            Total de impuesto repecutido",
        "             𝑇𝑎𝑟𝑖𝑓𝑎 𝑀𝑒𝑑𝑖𝑎 (𝑇𝑀) =",
        "                                        𝑇𝑜𝑡𝑎𝑙 𝑑𝑒 𝑣𝑒𝑛𝑡𝑎𝑠 𝑠𝑢𝑗𝑒𝑡𝑎𝑠 𝑦 𝑛𝑜 𝑒𝑥𝑒𝑛𝑡𝑎𝑠",
      ]),
    ).toBe(
      "𝑇𝑎𝑟𝑖𝑓𝑎 𝑀𝑒𝑑𝑖𝑎 (𝑇𝑀) = (Total de impuesto repecutido)/(𝑇𝑜𝑡𝑎𝑙 𝑑𝑒 𝑣𝑒𝑛𝑡𝑎𝑠 𝑠𝑢𝑗𝑒𝑡𝑎𝑠 𝑦 𝑛𝑜 𝑒𝑥𝑒𝑛𝑡𝑎𝑠)",
    );
  });
});

describe("readStackedBlock — blocks that only look like a stack", () => {
  it("leaves wrapped prose alone, nested and centred though its lines are", () => {
    expect(
      readStackedBlock([
        "   El adquirente detallará al afiliado en cada liquidación, el monto retenido del impuesto al",
        "   valor agregado, para efecto que el afiliado pueda determinar el monto a aplicar como pago",
      ]),
    ).toBeNull();
  });

  it("leaves a centred title alone — nothing in it was typeset as an equation", () => {
    expect(
      readStackedBlock([
        "     TRAMOS DEL IMPUESTO SOBRE",
        "      LA RENTA PARA EL PERIODO",
        "             FISCAL 2026",
      ]),
    ).toBeNull();
  });

  it("leaves a one-line formula alone: there is no bar to restore", () => {
    expect(
      readStackedBlock(["    “𝐶𝑎0” significa el crédito aplicado."]),
    ).toBeNull();
  });

  it("leaves two left-aligned equations alone: neither is over the other", () => {
    expect(
      readStackedBlock(["        𝐴 = 𝐵 + 𝐶", "        𝐷 = 𝐸 − 𝐹"]),
    ).toBeNull();
  });

  it("leaves a formula that drifts off its own centre alone", () => {
    expect(
      readStackedBlock(["        𝐴 + 𝐵", "                        𝐶"]),
    ).toBeNull();
  });
});

describe("readStackedBlock — stacks it refuses to guess at", () => {
  it("throws when the denominators are fused with no gap to cut at", () => {
    // «13%1+𝑇𝑀» with no space anywhere: nothing on the page says where the
    // first denominator ends, and «(𝑇𝑀)/(13%1+𝑇𝑀)» is silently wrong law.
    expect(() =>
      readStackedBlock([
        "                                                        𝑇𝑀     1",
        "                   𝑃𝑜𝑟𝑐𝑒𝑛𝑡𝑎𝑗𝑒 𝑑𝑒 𝑟𝑒𝑡𝑒𝑛𝑐𝑖ó𝑛 = 𝐹𝑅 ∗          ∗",
        "                                                        13%1+𝑇𝑀",
      ]),
    ).toThrow(/no way to pair them that the page supports/);
  });

  it("throws when two ways of cutting the fused row are equally supported", () => {
    // Both «AAAAAAA | B CCC» and «AAAAAAA B | CCC» leave each numerator half a
    // column off its denominator's centre. Nothing on the page prefers either.
    expect(() =>
      readStackedBlock(["            𝐴𝐴     𝐵𝐵", "         AAAAAAA B CCC"]),
    ).toThrow(/rival readings/);
  });

  it("throws when the parts pair up in count but not on the page", () => {
    expect(() =>
      readStackedBlock([
        "                             𝑇𝑀            1",
        "              𝑅 = 𝐹𝑅 ∗",
        "                             13%     1 + 𝑇𝑀",
      ]),
    ).toThrow(/does not sit over/);
  });

  it("throws when the expression's own ink occupies a fraction's columns", () => {
    expect(() =>
      readStackedBlock([
        "                              𝑇𝑀",
        "              𝑅 = 𝐹𝑅 ∗       13% × 2",
        "                             13%",
      ]),
    ).toThrow(/occupies the same columns/);
  });
});

describe("renderStackedFraction — reglamento-iva-bienes-capital (#176)", () => {
  it("gives the bien-de-capital adjustment its divisor back", () => {
    const paragraphs = textToParagraphs(bienes(), { stackedFraction: true });
    expect(paragraphs).toContain("(𝐶𝑎0 ‒ 𝐶𝑎𝑖)/(4)");
    expect(paragraphs.join(" ")).toMatch(
      /siguiente fórmula: \(𝐶𝑎0 ‒ 𝐶𝑎𝑖\)\/\(4\) Donde:/,
    );
  });

  it("no longer reads the numerator and the divisor as a flat sequence (#203)", () => {
    expect(
      textToParagraphs(bienes(), { stackedFraction: true }).join(" "),
    ).not.toMatch(/𝐶𝑎0 ‒ 𝐶𝑎𝑖 4/);
  });

  it("leaves the prose around the formula exactly as it was", () => {
    const flat = textToParagraphs(bienes());
    const read = textToParagraphs(bienes(), { stackedFraction: true });
    expect(read.filter((p) => !p.includes("𝐶𝑎0 ‒ 𝐶𝑎𝑖"))).toEqual(
      flat.filter((p) => !p.includes("𝐶𝑎0 ‒ 𝐶𝑎𝑖")),
    );
  });
});

describe("renderStackedFraction — reglamento-iva-retencion-tarjetas (#176)", () => {
  const read = () =>
    textToParagraphs(retencion(), { stackedFraction: true }).join(" ");

  it("nests both fractions of the %RT formula and keeps its two operators apart", () => {
    expect(read()).toContain(
      "𝑃𝑜𝑟𝑐𝑒𝑛𝑡𝑎𝑗𝑒 𝑑𝑒 𝑟𝑒𝑡𝑒𝑛𝑐𝑖ó𝑛 = 𝐹𝑅 ∗ (𝑇𝑀)/(13%) ∗ (1)/(1 + 𝑇𝑀)",
    );
    expect(read()).not.toMatch(/∗ ∗/);
    expect(read()).not.toMatch(/𝑇𝑀 1 𝑃𝑜𝑟𝑐𝑒𝑛𝑡𝑎𝑗𝑒/);
  });

  it("reads the tarifa media the %RT formula depends on", () => {
    expect(read()).toContain(
      "𝑇𝑎𝑟𝑖𝑓𝑎 𝑀𝑒𝑑𝑖𝑎 (𝑇𝑀) = (Total de impuesto repecutido)/(𝑇𝑜𝑡𝑎𝑙 𝑑𝑒 𝑣𝑒𝑛𝑡𝑎𝑠 𝑠𝑢𝑗𝑒𝑡𝑎𝑠 𝑦 𝑛𝑜 𝑒𝑥𝑒𝑛𝑡𝑎𝑠)",
    );
  });

  it("leaves the prose between the two formulas untouched", () => {
    expect(read()).toContain(
      "La tarifa media que se obtiene de dividir el impuesto total repercutido por operaciones",
    );
  });
});

describe("renderStackedFraction alongside the other layout passes", () => {
  // extract.ts fixes the order — table, then fractions, then rails — so that a
  // collapsed formula, a single line by the time renderLabelRail sees it, can
  // never be read as a two-column block. No manifest entry carries both flags
  // today; this is what would catch it if one ever did.
  it("survives a labelRail document intact, and leaves the rails alone", () => {
    const rail = fixture("ccss-escala-ivm-rail.txt");
    const both = textToParagraphs(`${bienes()}\n\n${rail}`, {
      labelRail: true,
      stackedFraction: true,
    }).join(" ");
    expect(both).toContain("(𝐶𝑎0 ‒ 𝐶𝑎𝑖)/(4)");
    expect(both).toMatch(
      /CONSIDERANDO: Una vez realizada la presentación pertinente/,
    );
  });
});

describe("renderStackedFraction", () => {
  it("throws when the document carries no stacked formula at all", () => {
    expect(() =>
      renderStackedFraction(["sólo prosa", "", "en una columna"]),
    ).toThrow(/no stacked formula/);
  });

  it("is byte-identical to today's extraction for a document without the flag", () => {
    expect(textToParagraphs(retencion())).toEqual(
      textToParagraphs(retencion(), {}),
    );
    expect(textToParagraphs(retencion()).join(" ")).toMatch(/∗ ∗/);
  });
});
