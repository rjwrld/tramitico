import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRailBlock, renderLabelRail } from "./label-rail";
import { renderLayoutTable } from "./layout-table";

function fixture(name: string): string[] {
  return readFileSync(path.join(__dirname, "__fixtures__", name), "utf8").split(
    "\n",
  );
}

const ficha = () => fixture("ccss-escala-ivm-rail.txt");
const tramos = () => fixture("tramos-renta-2026-brackets.txt");

describe("readRailBlock", () => {
  it("lifts a left-hand label out of the sentence it interrupts", () => {
    expect(
      readRailBlock([
        "                      expuesto en el oficio de referencia PE-DAE-1179-2025, en relación con la",
        "CONSIDERANDO          aplicación del artículo 33° y el transitorio XI del Reglamento del Seguro de",
        "                      Invalidez, Vejez y Muerte, la Junta Directiva ACUERDA:",
      ]),
    ).toBe(
      "CONSIDERANDO: expuesto en el oficio de referencia PE-DAE-1179-2025, en relación con la aplicación del artículo 33° y el transitorio XI del Reglamento del Seguro de Invalidez, Vejez y Muerte, la Junta Directiva ACUERDA:",
    );
  });

  it("joins a label that wraps across the lines of its own cell", () => {
    expect(
      readRailBlock([
        "Responsable de la",
        "                     M.Sc. Carolina Gonzalez Gaitán, directora.",
        "presentación",
      ]),
    ).toBe(
      "Responsable de la presentación: M.Sc. Carolina Gonzalez Gaitán, directora.",
    );
  });

  it("reads a narrow right-hand column as the cell it trails", () => {
    expect(
      readRailBlock([
        " Sobre el exceso de ¢918.000,00 (novecientos",
        " dieciocho mil colones) mensuales y hasta                                      10%",
        " ¢1.347.000,00 (un millón trescientos cuarenta y siete",
        " mil colones) mensuales",
      ]),
    ).toBe(
      "Sobre el exceso de ¢918.000,00 (novecientos dieciocho mil colones) mensuales y hasta ¢1.347.000,00 (un millón trescientos cuarenta y siete mil colones) mensuales: 10%",
    );
  });

  it("does not repeat a colon the label already carries", () => {
    expect(
      readRailBlock([
        "Crédito por:                    ¢20.520 veinte mil",
        "                        quinientos veinte colones anuales",
      ]),
    ).toBe("Crédito por: ¢20.520 veinte mil quinientos veinte colones anuales");
  });

  it("leaves single-column prose alone", () => {
    expect(
      readRailBlock([
        "                      ACUERDO SEGUNDO: Encargar a la Gerencia Financiera para que aplique la",
        "                      distribución del incremento de 0.5 p.p. en el porcentaje de contribución.",
      ]),
    ).toBeNull();
  });

  it("leaves a one-line row alone — its two cells already read in order", () => {
    expect(
      readRailBlock([
        "Legal            Artículo 33 y transitorio XI del Reglamento del Seguro de IVM.",
      ]),
    ).toBeNull();
  });

  it("leaves a data grid alone: no column of it is a column of short labels", () => {
    expect(
      readRailBlock([
        "   1     De 0.87 SM                                  4.16       5.45       0.30        9.91",
        "   2     Más de 0.87 SM a menos de 2 SM              5.65       4.26                   9.91",
      ]),
    ).toBeNull();
  });
});

describe("renderLabelRail — ccss-escala-ivm's ficha técnica", () => {
  const rendered = () => renderLabelRail(ficha()).join("\n");

  it("no longer drops a label into the middle of a sentence (#199)", () => {
    const text = rendered();
    expect(text).not.toMatch(/con la CONSIDERANDO aplicación/);
    expect(text).not.toMatch(/y al Técnica acatamiento/);
    expect(text).not.toMatch(/Reglamento del Seguro de Tema IVM/);
    expect(text).toMatch(
      /CONSIDERANDO: Una vez realizada la presentación pertinente/,
    );
  });

  it("keeps the three Estado bullets of one list together and in order", () => {
    expect(rendered()).toMatch(
      /PROPUESTAS DE ACUERDO: • Afiliado: 0,16 p\.p\. • Estado \(Cuota complementaria\): 0,16 p\.p\. • Estado como Tal: 0,18 p\.p\./,
    );
  });

  it("leaves the prose blocks between the rail cells untouched", () => {
    const text = rendered();
    expect(text).toMatch(
      /ACUERDO PRIMERO: Para el cumplimiento de lo establecido en el artículo 33 del/,
    );
    expect(text).toMatch(/^3\. Viabilidad$/m);
  });

  it("folds a heading pdftotext left inside the rail's block into the label", () => {
    // Known residue, disclosed in the manifest note: «2. Sinopsis» is a
    // section heading, not part of the «Responsable de la presentación» cell,
    // but pdftotext leaves no blank line between them so they share a block.
    // Pinned rather than fixed — the alternative reading splits the field name
    // in half — and it breaks no sentence and no list.
    expect(rendered()).toMatch(
      /Responsable de la presentación 2\. Sinopsis: M\.Sc\. Carolina Gonzalez Gaitán/,
    );
  });

  it("throws when the document carries no rail at all", () => {
    expect(() => renderLabelRail(["sólo prosa", "en una columna"])).toThrow(
      /no two-column block/,
    );
  });
});

describe("renderLabelRail — tramos-renta-2026's bracket table", () => {
  const rendered = () => renderLabelRail(tramos()).join("\n");

  it("no longer splices a rate into the middle of its own bracket", () => {
    const text = rendered();
    expect(text).not.toMatch(/mensuales y 15% hasta/);
    expect(text).toMatch(
      /Sobre el exceso de ¢1\.347\.000,00 \(un millón trescientos cuarenta y siete mil colones\) mensuales y hasta ¢2\.364\.000,00 \(dos millones trescientos sesenta y cuatro mil colones\) mensuales: 15%/,
    );
  });

  it("reads the exempt bracket as one condition and one verdict", () => {
    expect(rendered()).toMatch(
      /Las rentas de hasta ¢918\.000,00 \(novecientos dieciocho mil colones\) mensuales: No están sujetas al impuesto/,
    );
  });
});

describe("renderLabelRail after renderLayoutTable", () => {
  it("leaves #179's rendered rows exactly as the table put them", () => {
    const table = renderLayoutTable(fixture("ccss-escala-ivm-table.txt"), {
      columns: [
        "Categ.",
        "Nivel de ingreso (colones)",
        "Afiliado",
        "Estado",
        "Art. 78",
        "Conjunta",
      ],
    });
    const row =
      "Categ.: 1 | Nivel de ingreso (colones): De 0.87 SM | Afiliado: 4.16 | Estado: 5.45 | Art. 78: 0.30 | Conjunta: 9.91.";
    expect(table).toContain(row);
    expect(renderLabelRail([...ficha(), ...table])).toContain(row);
  });
});

describe("readRailBlock — blocks that only look like a rail", () => {
  it("leaves a stacked block alone: it already joins in reading order", () => {
    expect(
      readRailBlock([
        "                                                          Página 1 de 3",
        "                    CAJA COSTARRICENSE DE SEGURO SOCIAL",
        "                              Presidencia Ejecutiva",
      ]),
    ).toBeNull();
  });

  it("does not read the bullets of an indented list as a label column", () => {
    expect(
      readRailBlock([
        "  •   Como parte del proceso de cambio hacia el nuevo sistema tributario,",
        "      varias plataformas y herramientas, entre ellas ATV y TRAVI serán",
        "      desactivadas a partir del 18 de julio.",
      ]),
    ).toBeNull();
  });
});
