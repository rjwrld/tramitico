import { describe, expect, it } from "vitest";
import type { EvalCase } from "./dataset";
import { parseRewrites, rewriteCase } from "./rewrites";

describe("parseRewrites", () => {
  it("reads the rewrites an answer-set probe recorded, by case id", () => {
    const probe = JSON.stringify({
      configs: [],
      reads: [
        {
          id: "inscripcion-tardia-sancion",
          query: "¿Qué pasa si me inscribí tarde en Hacienda?",
          expansion: "Sanción por omisión de la declaración de inscripción.",
          per: {},
        },
        {
          id: "ho-abs-iva-2027",
          query: "¿Cuál será la tarifa del IVA en 2027?",
          expansion: null,
          per: {},
        },
      ],
    });
    const rewrites = parseRewrites(probe, "live-1.json");
    expect(rewrites.get("inscripcion-tardia-sancion")).toEqual({
      query: "¿Qué pasa si me inscribí tarde en Hacienda?",
      expansion: "Sanción por omisión de la declaración de inscripción.",
    });
    expect(rewrites.get("ho-abs-iva-2027")?.expansion).toBeNull();
  });

  it("refuses a file that recorded no rewrites, naming it", () => {
    // Every probe run before #457 recorded answer sets and nothing else.
    const old = JSON.stringify({
      reads: [{ id: "inscripcion-tardia-sancion", per: {} }],
    });
    expect(() => parseRewrites(old, "plain-1.json")).toThrow(
      /plain-1\.json.*inscripcion-tardia-sancion/,
    );
  });
});

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "inscripcion-tardia-sancion",
    seed: "appendix-a:9",
    question: "Me inscribí un año tarde en Hacienda, ¿qué pasa?",
    expected: [{ docKey: "cnpt", articulo: "Artículo 78" }],
    blocking: false,
    tier: 1,
    heldOut: false,
    ...overrides,
  };
}

describe("rewriteCase", () => {
  it("runs a case live when no rewrites are frozen", async () => {
    // A single-turn case: condensation skips the call, so this is free.
    const rewritten = await rewriteCase(evalCase(), null);
    expect(rewritten).toEqual({
      query: "Me inscribí un año tarde en Hacienda, ¿qué pasa?",
      condensed: null,
      expander: undefined,
    });
  });

  it("replays a frozen case's query and expansion", async () => {
    const frozen = new Map([
      [
        "inscripcion-tardia-sancion",
        {
          query: "Me inscribí un año tarde en Hacienda, ¿qué pasa?",
          expansion: "Sanción por omisión de la declaración de inscripción.",
        },
      ],
    ]);
    const rewritten = await rewriteCase(evalCase(), frozen);
    expect(rewritten.query).toBe(
      "Me inscribí un año tarde en Hacienda, ¿qué pasa?",
    );
    expect(await rewritten.expander?.expand(rewritten.query)).toBe(
      "Sanción por omisión de la declaración de inscripción.",
    );
  });

  it("replays a follow-up's condensation as the query it ran on", async () => {
    const followUp = evalCase({
      id: "ho-ademas-tengo-salario",
      question: "También recibo un salario, ¿cambia algo?",
      history: [{ question: "¿Cuánto es el mínimo exento?", answer: "…" }],
    });
    const frozen = new Map([
      [
        "ho-ademas-tengo-salario",
        {
          query: "¿Cómo se calcula el mínimo exento si además tengo salario?",
          expansion: null,
        },
      ],
    ]);
    const rewritten = await rewriteCase(followUp, frozen);
    expect(rewritten.query).toBe(
      "¿Cómo se calcula el mínimo exento si además tengo salario?",
    );
    expect(rewritten.condensed).toBe(rewritten.query);
    expect(await rewritten.expander?.expand(rewritten.query)).toBeNull();
  });

  it("refuses a case the frozen file does not carry", async () => {
    // A comparison that quietly ran one case live would not be one.
    await expect(rewriteCase(evalCase(), new Map())).rejects.toThrow(
      /inscripcion-tardia-sancion/,
    );
  });
});
