import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { textToParagraphs } from "./extract";
import { renderWrappedRow } from "./wrapped-row";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

const brackets = () =>
  fixture("reglamento-iva-retencion-tarjetas-brackets.txt");

const row = (left: string, right: string) => `    ${left.padEnd(74)}${right}`;

describe("renderWrappedRow", () => {
  it("re-joins a row whose left cell wrapped below its own rate", () => {
    const lines = [
      row("90% o menos del 100% de ventas locales, exentas o no", "1%"),
      "",
      "              sujetas",
      "",
      row("75% o menos del 90% de ventas locales, exentas o no sujetas", "2%"),
    ];
    const out = renderWrappedRow(lines);
    expect(out).toEqual([
      row("90% o menos del 100% de ventas locales, exentas o no sujetas", "1%"),
      "",
      row("75% o menos del 90% de ventas locales, exentas o no sujetas", "2%"),
    ]);
  });

  it("leaves a fragment that starts left of the cell alone: that is a new paragraph", () => {
    const lines = [
      row("90% o menos del 100% de ventas locales, exentas o no", "1%"),
      "",
      "   sujetas",
    ];
    expect(() => renderWrappedRow(lines)).toThrow(/no wrapped row/);
  });

  it("leaves a fragment that reaches into the right column alone", () => {
    const lines = [
      row("90% o menos del 100% de ventas locales, exentas o no", "1%"),
      "",
      `              ${"sujetas".padEnd(62)}x`,
    ];
    expect(() => renderWrappedRow(lines)).toThrow(/no wrapped row/);
  });

  it("does not read a two-column fragment as a continuation", () => {
    const lines = [
      row("90% o menos del 100% de ventas locales, exentas o no", "1%"),
      "",
      row("sujetas", "2%"),
    ];
    expect(() => renderWrappedRow(lines)).toThrow(/no wrapped row/);
  });

  it("needs exactly one blank line between the row and its continuation", () => {
    const lines = [
      row("90% o menos del 100% de ventas locales, exentas o no", "1%"),
      "",
      "",
      "              sujetas",
    ];
    expect(() => renderWrappedRow(lines)).toThrow(/no wrapped row/);
  });

  it("throws when the document has no wrapped row (#179's rule)", () => {
    expect(() =>
      renderWrappedRow(["   Prose on one line.", "", "   Prose on the next."]),
    ).toThrow(/no wrapped row/);
  });
});

describe("textToParagraphs with wrappedRow (#242)", () => {
  it("keeps the 1% bracket's condition together and its rate after it", () => {
    const before = textToParagraphs(brackets()).join(" ");
    expect(before).toContain("exentas o no 1% sujetas");

    const after = textToParagraphs(brackets(), { wrappedRow: true });
    const joined = after.join(" ");
    expect(joined).toContain(
      "90% o menos del 100% de ventas locales, exentas o no sujetas 1%",
    );
    expect(joined).not.toContain("1% sujetas");
  });

  it("reads the other four brackets exactly as before", () => {
    const before = textToParagraphs(brackets());
    const after = textToParagraphs(brackets(), { wrappedRow: true });
    const others = (ps: string[]) =>
      ps.filter((p) => !/90% o menos|^sujetas$/.test(p));
    expect(others(after)).toEqual(others(before));
    expect(after).toHaveLength(before.length - 1);
  });
});
