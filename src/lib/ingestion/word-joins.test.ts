import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToParagraphs } from "./extract";
import {
  type JoinEvidence,
  longWords,
  repairWordJoins,
  splitJoinedWord,
  suspiciousJoins,
  type WordRepair,
  wordJoinNotice,
  wordRepairNotice,
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

/** `phrase` spaced `n` times, as running text. */
const times = (phrase: string, n: number) =>
  Array.from({ length: n }, () => `el texto ${phrase} sigue.`).join(" ");

/** Repair `body` as Spanish text Word checked, and as text it never checked. */
function repairedIn(body: string, joined: string) {
  return {
    checked: repairWordJoins(`<p>${body}</p><p>${joined}</p>`).html,
    unchecked: repairWordJoins(
      `<p>${body}</p><p><span lang=EN-US>${joined}</span></p>`,
    ).html,
  };
}

describe("reglamento-iva's joined words (#520 fixture)", () => {
  const repairs: WordRepair[] = [];
  const text = htmlToParagraphs(fixture, repairs).join(" ");

  it("are in the payload itself, inside Word's spellcheck flags", () => {
    expect(fixture).toMatch(/<span\s+class=SpellE>dederechos<\/span>/);
    expect(fixture).toMatch(/<span\s+class=SpellE>losdestinados<\/span>/);
    // Spanish tagged as English: Word never checked it, so nothing is flagged.
    expect(fixture).toMatch(/<span lang=EN-US>3\) Donaciones/);
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
    ]) {
      expect(text).not.toContain(joined);
    }
  });

  it("separates an inciso letter from its first word", () => {
    expect(text).toContain("f. Los bienes que se acojan");
    expect(text).toContain("g. La reimportación");
  });

  it("leaves a join alone when this much of the document cannot vouch for it", () => {
    // The full ficha writes «del Título», «de previo» and «que requiera» often
    // enough to split these; ten paragraphs of it do not.
    expect(text).toContain("vigencia delTítulo I");
    expect(text).toContain("deprevio a la entrada");
    expect(text).toContain("período querequiera la donación");
  });

  it("logs every repair, by what Word said about the token", () => {
    const log = repairs.map((r) => `${r.proofing} ${r.from}→${r.to}`);
    expect(log).toContain("flagged dederechos→de derechos");
    expect(log).toContain("flagged losdestinados→los destinados");
    expect(log).toContain("unchecked debienes→de bienes");
    expect(repairs).toContainEqual({
      kind: "spaced",
      from: "g.La",
      to: "g. La",
      proofing: "flagged",
    });
  });

  it("shows up in the report count until repaired", () => {
    const before = suspiciousJoins([
      "local debienes exonerados; venta de bienes y compra de bienes",
    ]);
    expect(before).toEqual(["debienes"]);
    // Two spaced «del Título» fall short of the repair's bar for text Word
    // never checked, and clear the report's: the near miss is named, not lost.
    expect(suspiciousJoins(htmlToParagraphs(fixture))).toEqual(["deltítulo"]);
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
    comunes: 1,
    y: 30,
    cobrar: 2,
    se: 20,
    por: 30,
    qué: 1,
    dominio: 2,
    pleno: 3,
    mas: 9,
    para: 9,
    universitaria: 2,
    socio: 2,
    laboral: 4,
    radio: 2,
    difusión: 2,
    zona: 2,
    franca: 2,
    codigo: 1,
    actividad: 5,
    autoridad: 3,
  });

  it("splits a flagged token into two words the document uses", () => {
    expect(splitJoinedWord("dederechos", words, "flagged")).toBe("de derechos");
    expect(splitJoinedWord("laexportación", words, "flagged")).toBe(
      "la exportación",
    );
    expect(splitJoinedWord("añossiguientes", words, "flagged")).toBe(
      "años siguientes",
    );
    expect(splitJoinedWord("comunesy", words, "flagged")).toBe("comunes y");
    expect(splitJoinedWord("laAutoridad", words, "flagged")).toBe(
      "la Autoridad",
    );
  });

  it("never splits a flagged token the document has no halves for", () => {
    expect(splitJoinedWord("desalmacenar", words, "flagged")).toBeNull();
    expect(splitJoinedWord("paletizaje", words, "flagged")).toBeNull();
  });

  it("keeps an enclitic pronoun on its verb and an interrogative in its word", () => {
    expect(splitJoinedWord("cobrarse", words, "flagged")).toBeNull();
    expect(splitJoinedWord("porqué", words, "flagged")).toBeNull();
  });

  it("splits two content words only when both halves are long", () => {
    expect(splitJoinedWord("dominiopleno", words, "flagged")).toBe(
      "dominio pleno",
    );
    expect(splitJoinedWord("plenomas", words, "flagged")).toBeNull();
  });

  it("never splits a word built on a prefix", () => {
    for (const word of ["parauniversitaria", "sociolaboral", "radiodifusión"]) {
      expect(splitJoinedWord(word, words, "flagged")).toBeNull();
    }
  });

  it("never splits an identifier or a proper name where its case changes", () => {
    expect(splitJoinedWord("CodigoActividad", words, "flagged")).toBeNull();
    expect(splitJoinedWord("ZonaFranca", words, "flagged")).toBeNull();
  });

  it("splits a flagged token off a function word on two spaced uses", () => {
    const phrase = evidence(
      { bienes: 9, bajo: 3 },
      { "de bienes": 2, "de los": 30 },
      { debienes: 1, debajo: 1, delos: 1 },
    );
    expect(splitJoinedWord("debienes", phrase, "flagged")).toBe("de bienes");
    expect(splitJoinedWord("delos", phrase, "flagged")).toBe("de los");
    // Nobody writes «de bajo»: «debajo» is a word.
    expect(splitJoinedWord("debajo", phrase, "flagged")).toBeNull();
  });

  it("asks three spaced uses, outnumbering the token three to one, of a token Word did not flag", () => {
    const twice = evidence({}, { "de bienes": 2 }, { debienes: 1 });
    expect(splitJoinedWord("debienes", twice, "unchecked")).toBeNull();
    const thrice = evidence({}, { "de bienes": 3 }, { debienes: 1 });
    expect(splitJoinedWord("debienes", thrice, "unchecked")).toBe("de bienes");
    const outnumbered = evidence({}, { "de mora": 5 }, { demora: 2 });
    expect(splitJoinedWord("demora", outnumbered, "unchecked")).toBeNull();
  });

  it("splits a frequent token when its phrase outnumbers it", () => {
    const phrase = evidence({}, { "de los": 42 }, { delos: 3 });
    expect(splitJoinedWord("delos", phrase, "unchecked")).toBe("de los");
  });

  it("splits a function word off the end on the same evidence", () => {
    const phrase = evidence(
      {},
      { "plazo de": 7, "cobrar se": 7 },
      { plazode: 1, cobrarse: 1 },
    );
    expect(splitJoinedWord("plazode", phrase, "unchecked")).toBe("plazo de");
    expect(splitJoinedWord("cobrarse", phrase, "unchecked")).toBeNull();
  });

  it("never splits the words that read as two function words", () => {
    const phrase = evidence(
      {},
      { "que de": 9, "por que": 9, "se de": 9 },
      { quede: 1, porque: 1, sede: 1 },
    );
    for (const word of ["quede", "porque", "sede"]) {
      expect(splitJoinedWord(word, phrase, "unchecked")).toBeNull();
    }
  });

  it("splits only two function words in text Word checked and accepted", () => {
    const phrase = evidence(
      {},
      { "de los": 9, "de bienes": 9 },
      { delos: 1, debienes: 1 },
    );
    expect(splitJoinedWord("delos", phrase, "checked")).toBe("de los");
    expect(splitJoinedWord("debienes", phrase, "checked")).toBeNull();
  });

  it("reads a word in capitals as one Word never checked", () => {
    const phrase = evidence({}, { "del trabajo": 4 }, { deltrabajo: 1 });
    expect(splitJoinedWord("DELTRABAJO", phrase, "checked")).toBe(
      "DEL TRABAJO",
    );
  });
});

describe("repairWordJoins on words that only look joined (#524 review)", () => {
  // Each phrase written spaced three times, the most the review's synthetic
  // text did, beside the word itself once.
  const cases: [string, string][] = [
    ["de mora", "demora"],
    ["su puesto", "supuesto"],
    ["en torno", "entorno"],
    ["sin número", "sinnúmero"],
    ["con sumo", "consumo"],
    ["su cesión", "sucesión"],
    ["al rededor", "alrededor"],
    ["que hacer", "quehacer"],
    ["por venir", "porvenir"],
    ["aplicar en", "aplicaren"],
    ["se de", "sede"],
  ];

  it.each(cases)(
    "keeps «%s» apart from «%s» in text Word checked",
    (phrase, word) => {
      const { checked } = repairedIn(times(phrase, 3), `la ${word} ocurre`);
      expect(checked).toContain(`la ${word} ocurre`);
    },
  );

  it.each(cases)(
    "keeps «%s» apart from «%s» in unchecked text Word accepted elsewhere",
    (phrase, word) => {
      const { unchecked } = repairedIn(
        `${times(phrase, 3)} la ${word} también.`,
        `la ${word} ocurre`,
      );
      expect(unchecked).toContain(`la ${word} ocurre`);
    },
  );

  it.each(cases)(
    "keeps «%s» apart from «%s» in unchecked text on two spaced uses",
    (phrase, word) => {
      const { unchecked } = repairedIn(times(phrase, 2), `la ${word} ocurre`);
      expect(unchecked).toContain(`la ${word} ocurre`);
    },
  );

  it("never reads inside an email address or a URL", () => {
    const html =
      `<p>${times("info consultas", 4)}</p>` +
      "<p><span class=SpellE>infoconsultas@ccss.sa.cr</span> o " +
      "<span lang=EN-US>www.hacienda.go.cr/infoconsultas</span></p>";
    const { html: out, repairs } = repairWordJoins(html);
    expect(out).toContain("infoconsultas@ccss.sa.cr");
    expect(out).toContain("www.hacienda.go.cr/infoconsultas");
    expect(repairs).toEqual([]);
  });
});

describe("repairWordJoins", () => {
  it("returns markup with nothing to repair byte for byte", () => {
    const html =
      "<p class=MsoNormal><span lang=ES>Los bienes de capital, <b>en</b> uso.</span></p>";
    expect(repairWordJoins(html)).toEqual({ html, repairs: [] });
  });

  it("spaces punctuation inside a flag, not a time format or an entity", () => {
    const html =
      "<span class=GramE>gratuito,incluida</span> <span class=GramE>MM:SS</span> " +
      "<span class=SpellE>informaciones.Las</span> <span class=GramE>el&nbsp;título</span>";
    expect(repairWordJoins(html).html).toBe(
      "<span class=GramE>gratuito, incluida</span> <span class=GramE>MM:SS</span> " +
        "<span class=SpellE>informaciones. Las</span> <span class=GramE>el&nbsp;título</span>",
    );
  });

  it("reads a flag through nested spans", () => {
    const html =
      "<p>los derechos de la ley</p><p><span class=SpellE><span style='x'>dederechos</span></span></p>";
    expect(repairWordJoins(html).html).toContain(
      "<span style='x'>de derechos</span>",
    );
  });

  it("reads a word across an entity, and escapes what it writes back", () => {
    const html =
      "<p>del T&iacute;tulo I, del T&iacute;tulo II y del T&iacute;tulo III</p>" +
      "<p><span lang=EN-US>vigencia delT&iacute;tulo &amp; otros</span></p>";
    const { html: repaired } = repairWordJoins(html);
    expect(repaired).toContain("vigencia del Título &amp; otros");
    expect(htmlToParagraphs(repaired)).toContain("vigencia del Título & otros");
  });

  it("counts a phrase that crosses a span boundary", () => {
    const html =
      "<p>venta <span lang=ES>de</span> bienes; compra de <b>bienes</b>; uso de bienes</p>" +
      "<p><span lang=EN-US>local debienes exonerados</span></p>";
    expect(repairWordJoins(html).html).toContain("local de bienes exonerados");
  });
});

describe("longWords", () => {
  it("lists distinct words of 19 letters or more, accents counted once", () => {
    expect(
      longWords([
        "empresasconsolidadoras y agroindustrialización; administración",
        "empresasconsolidadoras",
      ]),
    ).toEqual(["agroindustrialización", "empresasconsolidadoras"]);
  });
});

describe("wordRepairNotice", () => {
  it("counts the repairs and lists unflagged splits on lines of their own", () => {
    const repairs: WordRepair[] = [
      {
        kind: "split",
        from: "dederechos",
        to: "de derechos",
        proofing: "flagged",
      },
      {
        kind: "split",
        from: "debienes",
        to: "de bienes",
        proofing: "unchecked",
      },
      { kind: "split", from: "delos", to: "de los", proofing: "checked" },
      { kind: "split", from: "delos", to: "de los", proofing: "checked" },
      { kind: "spaced", from: "g.La", to: "g. La", proofing: "flagged" },
    ];
    expect(wordRepairNotice("reglamento-iva", repairs)).toEqual({
      level: "info",
      message: [
        "reglamento-iva: repaired 4 joined words and 1 unspaced punctuation mark in the payload (#520)",
        "    Word flagged (1): dederechos→de derechos",
        "    Word never checked (1): debienes→de bienes",
        "    Word checked and accepted (2): delos→de los",
        "    punctuation: g.La→g. La",
      ].join("\n"),
    });
  });

  it("reports a payload with nothing to repair in one line", () => {
    expect(wordRepairNotice("ley-10363", []).message).toBe(
      "ley-10363: repaired 0 joined words and 0 unspaced punctuation marks in the payload (#520)",
    );
  });
});

describe("wordJoinNotice", () => {
  it("reports zeros quietly", () => {
    expect(wordJoinNotice("ley-iva", ["de bienes y de bienes"])).toEqual({
      level: "info",
      message:
        "ley-iva: 0 suspicious word joins, 0 words of 19+ letters (#520)",
    });
  });

  it("lists long words without warning", () => {
    const notice = wordJoinNotice("ley-iva", ["la agroindustrialización"]);
    expect(notice.level).toBe("info");
    expect(notice.message.split("\n")).toEqual([
      "ley-iva: 0 suspicious word joins, 1 word of 19+ letters (#520)",
      "    long: agroindustrialización",
    ]);
  });

  it("warns with the count and the joins it found", () => {
    const notice = wordJoinNotice("reglamento-iva", [
      "venta de bienes,",
      "compra de bienes; de los",
      "contratos de los socios; debienes y delos",
    ]);
    expect(notice.level).toBe("warn");
    const [head, joins] = notice.message.split("\n");
    expect(head).toBe(
      "reglamento-iva: 2 suspicious word joins, 0 words of 19+ letters (#520)",
    );
    expect(joins).toMatch(/: debienes, delos$/);
  });

  it("caps the samples it names", () => {
    const words = Array.from(
      { length: 14 },
      (_, i) => `palabra${"x".repeat(i)}`,
    );
    const text = words.flatMap((w) => [`de ${w}`, `de ${w}`, `de${w}`]);
    const [head, joins] = wordJoinNotice("doc", [text.join(" ")]).message.split(
      "\n",
    );
    expect(head).toMatch(/^doc: 14 suspicious word joins/);
    expect(joins).toMatch(/, … 2 more$/);
  });
});
