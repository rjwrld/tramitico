import { describe, expect, it } from "vitest";

import {
  classifyRouting,
  DECLINE_OPENING,
  declineAnswer,
  GENERAL_ROUTING,
  MTSS_FACT,
  normaliseQuestion,
  ROUTING,
  ROUTING_CATEGORIES,
  routingEntriesFor,
  routingEntry,
  SCOPE_PHRASE,
} from "./routing";

describe("ROUTING table (#264)", () => {
  it("has exactly one entry per category, in category order", () => {
    expect(ROUTING.map((entry) => entry.category)).toEqual([
      ...ROUTING_CATEGORIES,
    ]);
  });

  it("carries a well-formed https front door and a name for every entry", () => {
    for (const entry of ROUTING) {
      const url = new URL(entry.url);
      expect(url.protocol).toBe("https:");
      // Front doors only: a deep path is a bet on somebody else's site map.
      expect(url.pathname).toBe("/");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(entry.institution.trim()).not.toBe("");
    }
  });

  it("names the two in-scope institutions as the general fallback", () => {
    expect(GENERAL_ROUTING.map((entry) => entry.category)).toEqual([
      "hacienda",
      "ccss",
    ]);
    expect(routingEntry("hacienda").url).toBe("https://www.hacienda.go.cr");
    expect(routingEntry("ccss").url).toBe("https://www.ccss.sa.cr");
  });

  it("resolves a routed category to one entry, and general to both", () => {
    expect(routingEntriesFor("municipal")).toEqual([routingEntry("municipal")]);
    expect(routingEntriesFor("general")).toBe(GENERAL_ROUTING);
  });
});

describe("normaliseQuestion", () => {
  it("lower-cases, strips diacritics and collapses whitespace", () => {
    expect(normaliseQuestion("  ¿Necesito   PATENTE   en Escazú? ")).toBe(
      "¿necesito patente en escazu?",
    );
  });
});

describe("classifyRouting", () => {
  it("defaults to general when nothing names an institution", () => {
    expect(classifyRouting("¿Qué es zxqvlodrix?")).toBe("general");
    expect(classifyRouting("")).toBe("general");
  });

  it.each([
    ["¿Necesito patente municipal para trabajar desde mi casa?", "municipal"],
    ["¿Cuánto pago de bienes inmuebles en Escazú?", "municipal"],
    [
      "¿Tengo que pagar riesgos del trabajo al INS siendo independiente?",
      "ins",
    ],
    ["¿Cuánto cuesta la póliza del INS?", "ins"],
    [
      "¿Me conviene sacar cédula jurídica y abrir una sociedad?",
      "registro-nacional",
    ],
    ["¿Cómo registro una marca?", "registro-nacional"],
    ["¿Tengo que colegiarme para facturar como ingeniero?", "colegios"],
    ["¿Tengo que estar colegiado en el CPIC?", "colegios"],
    ["¿Qué banco me da un préstamo siendo freelancer?", "bancos"],
    ["¿Cómo me registro como PYME en el MEIC?", "meic"],
    ["¿Puedo trabajar como nómada digital con visa de turista?", "migracion"],
    ["¿Necesito DIMEX para inscribirme?", "migracion"],
    ["¿Tengo aguinaldo como freelancer?", "mtss"],
    ["¿Me toca cesantía si me despiden?", "mtss"],
  ])("routes %s to %s", (question, category) => {
    expect(classifyRouting(question)).toBe(category);
  });

  it("lets an out-of-scope institution outrank Hacienda vocabulary", () => {
    // On the decline path already: a reader who names the patente and
    // Hacienda in one breath is better sent to the municipalidad.
    expect(
      classifyRouting(
        "¿La patente municipal la pago en Hacienda con el IVA y la renta?",
      ),
    ).toBe("municipal");
  });

  it("picks the out-of-scope institution with the most hits", () => {
    expect(
      classifyRouting(
        "¿La municipalidad de mi cantón me pide la póliza del INS para la patente?",
      ),
    ).toBe("municipal");
  });

  it("splits Hacienda from the CCSS by count when nothing else matched", () => {
    expect(classifyRouting("¿Cómo pago mis cuotas de la Caja?")).toBe("ccss");
    expect(classifyRouting("¿Qué es el D-104 en TRIBU-CR?")).toBe("hacienda");
  });

  it("treats a Hacienda/CCSS tie as general", () => {
    expect(classifyRouting("¿Hacienda y la Caja comparten datos?")).toBe(
      "general",
    );
  });

  it("matches whole words, diacritics folded", () => {
    // «ins» inside «inscribirme» is not the INS; «póliza» with an accent
    // still is one.
    expect(classifyRouting("¿Cómo inscribirme?")).toBe("general");
    expect(classifyRouting("¿Qué PÓLIZA ocupo?")).toBe("ins");
  });

  it("keeps Tier 1 vocabulary out of the out-of-scope lists", () => {
    // «extranjero» is T1-A/T1-D territory, not migración.
    expect(
      classifyRouting("¿Debo cobrar IVA a clientes en el extranjero?"),
    ).toBe("hacienda");
    // «residencia fiscal» is not a migratory status.
    expect(classifyRouting("¿Qué es la residencia fiscal para renta?")).toBe(
      "hacienda",
    );
  });
});

describe("declineAnswer", () => {
  it("opens every variant with the same first sentence", () => {
    for (const category of [...ROUTING_CATEGORIES, "general"] as const) {
      expect(declineAnswer(category).startsWith(DECLINE_OPENING)).toBe(true);
    }
  });

  it("lists both in-scope institutions for general — the pre-#264 decline", () => {
    const text = declineAnswer("general");
    expect(text).toContain("las fuentes oficiales");
    expect(text).toContain(
      "- Ministerio de Hacienda: https://www.hacienda.go.cr",
    );
    expect(text).toContain("- CCSS: https://www.ccss.sa.cr");
    // In scope: nothing about the question being outside it.
    expect(text).not.toContain("fuera de lo que cubro");
  });

  it("names one in-scope institution when the question picked one", () => {
    const text = declineAnswer("ccss");
    expect(text).toContain("la fuente oficial");
    expect(text).toContain("- CCSS: https://www.ccss.sa.cr");
    expect(text).not.toContain("hacienda.go.cr");
    expect(text).not.toContain("fuera de lo que cubro");
  });

  it("says an out-of-scope question is out of scope, names the scope, and links the institution", () => {
    const text = declineAnswer("municipal");
    expect(text).toContain("la municipalidad de su cantón");
    expect(text).toContain("fuera de lo que cubro");
    expect(text).toContain(SCOPE_PHRASE);
    expect(text).toContain(
      "- la municipalidad de su cantón: https://www.ifam.go.cr",
    );
    expect(text).not.toContain("hacienda.go.cr");
    expect(text).not.toContain("ccss.sa.cr");
  });

  it("states rule 5's fact on the MTSS decline, and only there", () => {
    const text = declineAnswer("mtss");
    expect(text).toContain(MTSS_FACT);
    expect(text).toContain(
      "- Ministerio de Trabajo y Seguridad Social (MTSS): https://www.mtss.go.cr",
    );
    // The fact precedes the link: what the law says, then where to go.
    expect(text.indexOf(MTSS_FACT)).toBeLessThan(
      text.indexOf("https://www.mtss.go.cr"),
    );
    for (const other of ROUTING_CATEGORIES.filter((c) => c !== "mtss")) {
      expect(declineAnswer(other)).not.toContain("Código de Trabajo");
    }
  });

  it("carries no apology and no markdown link syntax (DESIGN §9, ADR 0008)", () => {
    for (const category of [...ROUTING_CATEGORIES, "general"] as const) {
      const text = declineAnswer(category);
      expect(text).not.toMatch(/lo sentimos|disculp/i);
      expect(text).not.toMatch(/\]\(/);
    }
  });
});
