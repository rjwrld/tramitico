import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToParagraphs } from "./extract";
import {
  type JoinEvidence,
  repairWordJoins,
  splitJoinedWord,
  suspiciousJoins,
  wordJoinNotice,
} from "./word-joins";

const fixture = readFileSync(
  path.resolve(__dirname, "__fixtures__/reglamento-iva-word-joins.html"),
  "utf8",
);

/** Evidence built by hand: `words` doubles as the token counts. */
function evidence(
  words: Record<string, number>,
  pairs: Record<string, number> = {},
  tokens: Record<string, number> = {},
): JoinEvidence {
  return {
    words: new Map(Object.entries(words)),
    pairs: new Map(Object.entries(pairs)),
    tokens: new Map(Object.entries({ ...words, ...tokens })),
  };
}

describe("reglamento-iva's joined words (#520 fixture)", () => {
  const text = htmlToParagraphs(fixture).join(" ");

  it("are in the payload itself, inside Word's spellcheck flags", () => {
    expect(fixture).toMatch(/<span\s+class=SpellE>dederechos<\/span>/);
    expect(fixture).toMatch(/<span\s+class=SpellE>losdestinados<\/span>/);
    // Spanish tagged as English: Word never checked it, so nothing is flagged.
    expect(fixture).toMatch(/local debienes/);
  });

  it("extract split at the seam the same document vouches for", () => {
    for (const repaired of [
      "estén destinados a la exportación",
      "tales los destinados",
      "régimen devolutivo de derechos",
      "los tres años siguientes",
      "estado de la exportación",
      "mercado local de bienes exonerados",
      "vigencia del Título I",
    ]) {
      expect(text).toContain(repaired);
    }
    for (const joined of [
      "esténdestinados",
      "losdestinados",
      "dederechos",
      "añossiguientes",
      "laexportación",
      "debienes",
      "delTítulo",
    ]) {
      expect(text).not.toContain(joined);
    }
  });

  it("separates an inciso letter from its first word", () => {
    expect(text).toContain("f. Los bienes que se acojan");
    expect(text).toContain("g. La reimportación");
  });

  it("leaves a join alone when this much of the document cannot vouch for it", () => {
    // The full ficha writes «de previo» and «que requiera» often enough to
    // split these; ten paragraphs of it do not.
    expect(text).toContain("deprevio a la entrada");
    expect(text).toContain("período querequiera la donación");
  });

  it("shows up in the report count until repaired", () => {
    const before = suspiciousJoins([
      "local debienes exonerados; venta de bienes y compra de bienes",
    ]);
    expect(before).toEqual(["debienes"]);
    expect(suspiciousJoins(htmlToParagraphs(fixture))).toEqual([]);
  });
});

describe("splitJoinedWord", () => {
  const words = evidence({
    de: 50,
    derechos: 3,
    la: 40,
    exportación: 4,
    años: 5,
    siguientes: 6,
    zona: 2,
    franca: 2,
    comunes: 1,
    y: 30,
    cobrar: 2,
    se: 20,
    por: 30,
    qué: 1,
    dominio: 2,
    pleno: 3,
    mas: 9,
  });

  it("splits a flagged token into two words the document uses", () => {
    expect(splitJoinedWord("dederechos", words, true)).toBe("de derechos");
    expect(splitJoinedWord("laexportación", words, true)).toBe(
      "la exportación",
    );
    expect(splitJoinedWord("añossiguientes", words, true)).toBe(
      "años siguientes",
    );
    expect(splitJoinedWord("ZonaFranca", words, true)).toBe("Zona Franca");
    expect(splitJoinedWord("comunesy", words, true)).toBe("comunes y");
  });

  it("never splits a flagged token the document has no halves for", () => {
    expect(splitJoinedWord("desalmacenar", words, true)).toBeNull();
    expect(splitJoinedWord("paletizaje", words, true)).toBeNull();
  });

  it("keeps an enclitic pronoun on its verb and an interrogative in its word", () => {
    expect(splitJoinedWord("cobrarse", words, true)).toBeNull();
    expect(splitJoinedWord("porqué", words, true)).toBeNull();
  });

  it("splits two content words only when both halves are long", () => {
    expect(splitJoinedWord("dominiopleno", words, true)).toBe("dominio pleno");
    expect(splitJoinedWord("plenomas", words, true)).toBeNull();
  });

  it("splits an unflagged token only on the document's own phrase", () => {
    const phrase = evidence(
      { bienes: 9, bajo: 3 },
      { "de bienes": 12, "de los": 30 },
      { debienes: 1, debajo: 1, delos: 1 },
    );
    expect(splitJoinedWord("debienes", phrase, false)).toBe("de bienes");
    expect(splitJoinedWord("delos", phrase, false)).toBe("de los");
    // Nobody writes «de bajo»: «debajo» is a word.
    expect(splitJoinedWord("debajo", phrase, false)).toBeNull();
  });

  it("needs the phrase twice, a remainder over three letters, and a rare token", () => {
    const phrase = evidence(
      {},
      { "de bienes": 1, "que dan": 5, "de más": 4 },
      { debienes: 1, quedan: 1, demás: 9 },
    );
    expect(splitJoinedWord("debienes", phrase, false)).toBeNull();
    expect(splitJoinedWord("quedan", phrase, false)).toBeNull();
    expect(splitJoinedWord("demás", phrase, false)).toBeNull();
  });

  it("never splits the words that read as two function words", () => {
    const phrase = evidence(
      {},
      { "que de": 9, "por que": 9 },
      { quede: 1, porque: 1 },
    );
    expect(splitJoinedWord("quede", phrase, false)).toBeNull();
    expect(splitJoinedWord("porque", phrase, false)).toBeNull();
  });
});

describe("repairWordJoins", () => {
  it("returns markup with nothing to repair byte for byte", () => {
    const html =
      "<p class=MsoNormal><span lang=ES>Los bienes de capital, <b>en</b> uso.</span></p>";
    expect(repairWordJoins(html)).toBe(html);
  });

  it("spaces punctuation inside a flag, not a time format or an entity", () => {
    const html =
      "<span class=GramE>gratuito,incluida</span> <span class=GramE>MM:SS</span> " +
      "<span class=SpellE>informaciones.Las</span> <span class=GramE>el&nbsp;título</span>";
    expect(repairWordJoins(html)).toBe(
      "<span class=GramE>gratuito, incluida</span> <span class=GramE>MM:SS</span> " +
        "<span class=SpellE>informaciones. Las</span> <span class=GramE>el&nbsp;título</span>",
    );
  });

  it("reads a flag through nested spans", () => {
    const html =
      "<p>los derechos de la ley</p><p><span class=SpellE><span style='x'>dederechos</span></span></p>";
    expect(repairWordJoins(html)).toContain(
      "<span style='x'>de derechos</span>",
    );
  });

  it("counts a phrase that crosses a span boundary", () => {
    const html =
      "<p>venta <span lang=ES>de</span> bienes; compra de <b>bienes</b></p>" +
      "<p><span lang=EN-US>local debienes exonerados</span></p>";
    expect(repairWordJoins(html)).toContain("local de bienes exonerados");
  });
});

describe("wordJoinNotice", () => {
  it("reports zero quietly", () => {
    expect(wordJoinNotice("ley-iva", ["de bienes y de bienes"])).toEqual({
      level: "info",
      message: "ley-iva: 0 suspicious word joins",
    });
  });

  it("warns with the count and the joins it found", () => {
    const notice = wordJoinNotice("reglamento-iva", [
      "venta de bienes,",
      "compra de bienes; de los",
      "contratos de los socios; debienes y delos",
    ]);
    expect(notice.level).toBe("warn");
    expect(notice.message).toMatch(
      /^reglamento-iva: 2 suspicious word joins .*#520\): debienes, delos$/,
    );
  });

  it("caps the samples it names", () => {
    const words = Array.from(
      { length: 14 },
      (_, i) => `palabra${"x".repeat(i)}`,
    );
    const text = words.flatMap((w) => [`de ${w}`, `de ${w}`, `de${w}`]);
    const notice = wordJoinNotice("doc", [text.join(" ")]);
    expect(notice.message).toMatch(/^doc: 14 suspicious word joins/);
    expect(notice.message).toMatch(/, … 2 more$/);
  });
});
