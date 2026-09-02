import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLayoutGrid, renderLayoutTable } from "./layout-table";

const IVM_COLUMNS = [
  "Categ.",
  "Nivel de ingreso (colones)",
  "Afiliado",
  "Estado",
  "Art. 78",
  "Conjunta",
];

function fixture(name: string): string[] {
  return readFileSync(path.join(__dirname, "__fixtures__", name), "utf8").split(
    "\n",
  );
}

describe("findLayoutGrid", () => {
  it("finds the ccss-escala-ivm data rows and their six columns", () => {
    const lines = fixture("ccss-escala-ivm-table.txt");
    const grid = findLayoutGrid(lines, 6);
    expect(grid).not.toBeNull();
    expect(grid!.columns).toHaveLength(6);
    expect(lines.slice(grid!.from, grid!.to).map((l) => l.trim()[0])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("returns null when no run of lines has the wanted column count", () => {
    expect(findLayoutGrid(fixture("ccss-escala-ivm-table.txt"), 9)).toBeNull();
  });

  it("excludes a footnote line that would otherwise render as a row", () => {
    const lines = fixture("ccss-escala-ivm-table.txt");
    const grid = findLayoutGrid(lines, 6)!;
    expect(lines.slice(grid.from, grid.to).join("\n")).not.toMatch(/Fuente:/);
  });

  it("ignores label/body two-column prose, whose lines fill one cell", () => {
    const lines = [
      "PROPUESTAS      DE        •    Afiliado: 0,16 p.p.",
      "                          •    Estado (Cuota complementaria): 0,16 p.p.",
      "ACUERDO",
      "                          •    Estado como Tal: 0,18 p.p.",
    ];
    expect(findLayoutGrid(lines, 4)).toBeNull();
  });

  it("keeps columns aligned when a table cell contains an astral glyph", () => {
    expect(
      renderLayoutTable(["header", "", "1𝑇  A  X", "22  B  Y"], {
        columns: ["Primera", "Segunda", "Tercera"],
      }),
    ).toContain("Primera: 1𝑇 | Segunda: A | Tercera: X.");
  });
});

describe("renderLayoutTable", () => {
  const rendered = () =>
    renderLayoutTable(fixture("ccss-escala-ivm-table.txt"), {
      columns: IVM_COLUMNS,
    });

  it("replaces the fused header line with the manifest's column labels", () => {
    const text = rendered().join("\n");
    expect(text).not.toMatch(/Estado Art\. 78/);
    expect(text).toMatch(
      /Columnas de la tabla: Categ\. \| Nivel de ingreso \(colones\) \| Afiliado \| Estado \| Art\. 78 \| Conjunta\./,
    );
  });

  it("labels every cell of every row, so a row survives being re-joined", () => {
    expect(rendered()).toContain(
      "Categ.: 1 | Nivel de ingreso (colones): De 0.87 SM | Afiliado: 4.16 | Estado: 5.45 | Art. 78: 0.30 | Conjunta: 9.91.",
    );
  });

  it("marks an empty cell rather than closing the gap", () => {
    expect(rendered()).toContain(
      "Categ.: 3 | Nivel de ingreso (colones): De 2 SM a menos de 4 SM | Afiliado: 7.53 | Estado: 2.38 | Art. 78: — | Conjunta: 9.91.",
    );
  });

  it("leaves the prose around the table untouched", () => {
    const text = rendered().join("\n");
    expect(text).toMatch(/Fuente: Dirección Actuarial y Económica\./);
    expect(text).toMatch(/la contribución del Estado como tal es de 1\.75%/);
  });

  it("refuses to replace a header block big enough to be prose", () => {
    const lines = fixture("ccss-escala-ivm-table.txt").filter(
      (l, i) => i !== 8, // the blank line between the caption and the header
    );
    expect(() => renderLayoutTable(lines, { columns: IVM_COLUMNS })).toThrow(
      /more than a header/,
    );
  });

  it("throws when the wanted grid is not in the text", () => {
    expect(() =>
      renderLayoutTable(["sólo prosa"], { columns: IVM_COLUMNS }),
    ).toThrow(/6-column/);
  });
});
