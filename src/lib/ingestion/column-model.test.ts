import { describe, expect, it } from "vitest";
import { columnsOf, isBlank } from "./column-model";

describe("pdftotext column model", () => {
  it("counts a Unicode code point as one page column", () => {
    expect(columnsOf("A𝑇 B")).toEqual(["A", "𝑇", " ", "B"]);
  });

  it("treats whitespace and columns beyond the end of a line as blank", () => {
    expect([isBlank(" "), isBlank("\t"), isBlank(undefined)]).toEqual([
      true,
      true,
      true,
    ]);
    expect(isBlank("A")).toBe(false);
  });
});
