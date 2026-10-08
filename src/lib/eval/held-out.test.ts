/**
 * The held-out set's composition contract (#261 part B, #254 Part A §A5 /
 * Part B §B8).
 *
 * `dataset.test.ts` checks that a case *parses*; this file checks that the
 * set as a whole is the one the coverage contract promises. The distinction
 * matters because every individual case here could be valid while the set
 * quietly lost a family, or measured T1-D three times in three phrasings and
 * T1-G never — and the promise "the nine Tier 1 families are covered" would
 * still read as kept. A coverage claim nobody counts is a coverage claim
 * nobody has.
 *
 * The numbers come from §B8: nine families × three variants, twelve Tier 2
 * cases, nine abstention cases. Only the Tier 1 grid is pinned exactly; Tier 2
 * and abstention are floors, and the asymmetry is deliberate. A tenth Tier 2
 * topic or abstention case only widens what is measured, but a second
 * `coloquial` variant of one family would make "every Tier 1 case is
 * individually blocking" mean something different for that family than for
 * the other eight — so that grid is the one number that may not drift.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { figureMentions } from "./adequacy";
import { CORPUS_INDEX_PATH, parseCorpusIndex } from "./corpus-index";
import {
  abstentionCases,
  DATASET_PATH,
  type EvalCase,
  FAMILIES,
  heldOutCases,
  MAX_REQUIRED_CLAIMS,
  parseDataset,
  VARIANTS,
} from "./dataset";

const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
const heldOut = heldOutCases(cases);
const tier1 = heldOut.filter((c) => c.tier === 1);
const tier2 = heldOut.filter((c) => c.tier === 2);
const abstain = abstentionCases(heldOut);

describe("the held-out set (#261 part B)", () => {
  it("holds at least the 45 cases the acceptance asks for", () => {
    expect(heldOut.length).toBeGreaterThanOrEqual(45);
    expect(tier1.length + tier2.length + abstain.length).toBe(heldOut.length);
  });

  it("covers every Tier 1 family in all three variants, exactly once", () => {
    const grid = tier1.map((c) => `${c.family}/${c.variant}`).sort();
    const expected = FAMILIES.flatMap((family) =>
      VARIANTS.map((variant) => `${family}/${variant}`),
    ).sort();
    expect(grid).toEqual(expected);
  });

  it("carries at least the twelve Tier 2 and nine abstention cases", () => {
    expect(tier2.length).toBeGreaterThanOrEqual(12);
    expect(abstain.length).toBeGreaterThanOrEqual(9);
  });
});

/**
 * The seven cases #258/#259/#260 had already put in the dataset before this
 * issue promoted them into the set. Flagging a case `heldOut` cannot undo the
 * exposure it already had — the retrieval suite has been running them — so
 * they are *members* of the held-out set but not *first exposures* of it, and
 * #267 has to report the two groups separately or its held-out number will
 * claim more than it measured.
 *
 * `seed` is what tells them apart: a case written for this set carries
 * `held-out:<family>`, a promoted one keeps the provenance of the issue that
 * wrote it. Pinning the list here means the distinction survives someone
 * later editing a seed without knowing what it was load-bearing for.
 */
const PROMOTED = [
  "ccss-cese-actividad",
  "ccss-obligacion-ingreso-bajo",
  "ccss-pedir-prescripcion-cuotas",
  "ccss-ventana-prescripcion-24-meses",
  "desinscripcion-dejar-actividad",
  "inscripcion-tardia-sancion",
  "multa-iva-no-declarado",
];

describe("first exposure vs. promoted membership (#261 part B)", () => {
  const promoted = heldOut
    .filter((c) => !c.seed.startsWith("held-out:"))
    .map((c) => c.id)
    .sort();

  it("keeps the promoted cases identifiable by their original seed", () => {
    expect(promoted).toEqual(PROMOTED);
  });

  it("leaves the rest genuinely unseen before this set", () => {
    // 48 members, 7 of them promoted: 41 questions no eval run has scored.
    expect(heldOut.length - promoted.length).toBeGreaterThanOrEqual(41);
  });
});

describe("every held-out Tier 1 case carries what makes it checkable", () => {
  it("is blocking, with a family and at most five required claims", () => {
    for (const c of tier1) {
      expect(c.blocking, c.id).toBe(true);
      expect(c.family, c.id).toBeDefined();
      expect(c.requiredClaims, c.id).toBeDefined();
      expect(c.requiredClaims!.length, c.id).toBeGreaterThan(0);
      expect(c.requiredClaims!.length, c.id).toBeLessThanOrEqual(
        MAX_REQUIRED_CLAIMS,
      );
    }
  });

  it("names the sources whose figures it depends on (§B8 freshness)", () => {
    for (const c of tier1) {
      expect(c.freshness, c.id).toBeDefined();
      expect(c.freshness!.length, c.id).toBeGreaterThan(0);
    }
  });

  it("owes the reader next steps on every family (§B4)", () => {
    for (const c of tier1) {
      expect(c.requiredSteps, c.id).toBeDefined();
      expect(c.requiredSteps!.length, c.id).toBeGreaterThan(0);
    }
  });

  it("checks the figures and dates deterministically, not by judge (req. 3)", () => {
    // The six §B8 figures the contract names by hand. Each must reach the
    // deterministic lane — a `literal` claim — somewhere in the set, because
    // a number a judge reads is a number nobody checked.
    const literals = tier1.flatMap((c) =>
      (c.requiredClaims ?? []).flatMap((claim) => claim.literal ?? []),
    );
    for (const figure of [
      "13 %",
      "6.244.000",
      "373.092,30",
      "cuatro años",
      "diez años",
      "día 15",
      "dos meses y quince días",
    ]) {
      expect(literals, `no deterministic check for ${figure}`).toContain(
        figure,
      );
    }
  });

  it("spells a literal the way an answer would print it", () => {
    for (const c of tier1) {
      for (const claim of c.requiredClaims ?? []) {
        for (const variant of claim.literal ?? []) {
          // A leading/trailing space or an empty string would match every
          // answer or none; both are silent passes.
          expect(variant, c.id).toBe(variant.trim());
          expect(variant.length, c.id).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("the held-out abstention block", () => {
  it("declares what obliges the decline and where to send the reader", () => {
    for (const c of abstain) {
      expect(c.abstainIf, c.id).toBeTruthy();
      expect(c.routeTo, c.id).toBeTruthy();
      expect(c.expected, c.id).toEqual([]);
    }
  });

  it("seeds no figure in the question itself", () => {
    // `figureMentions` counts every colón amount and percentage in the answer
    // as invented. A question that hands the model a figure invites it to
    // echo one back, which would fail the case for the wrong reason — so the
    // check runs the *same* detector over the question, rather than a second
    // regex that could drift away from it.
    for (const c of abstain) {
      expect(figureMentions(c.question), c.id).toEqual([]);
    }
  });
});

describe("the held-out set is answerable by the committed corpus", () => {
  const index = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));

  it("names only docKeys the freshness contract can point at", () => {
    const indexed = new Set(index.entries.map((entry) => entry.docKey));
    const unknown = heldOut
      .flatMap((c) => (c.freshness ?? []).map((docKey) => `${c.id}: ${docKey}`))
      .filter((row) => !indexed.has(row.split(": ")[1]));
    expect(unknown).toEqual([]);
  });

  it("gives every non-abstention held-out case a retrieval target", () => {
    for (const c of [...tier1, ...tier2]) {
      expect(c.expected.length, c.id).toBeGreaterThan(0);
    }
  });
});

/**
 * A held-out question is one nothing was tuned against (#536). A keyword
 * table, a classifier tie, a fixture or a docstring example written with that
 * exact wording in front of it makes the held-out number measure less than it
 * claims. Code and tests use made-up wordings of the same shape instead; this
 * fails any `.ts`/`.tsx` file under `src/`, `scripts/` or `e2e/` that quotes a
 * held-out question or one of its follow-up turns (#543), case, accents,
 * `¿?¡!`, spacing, `"…" + "…"` splits and comment line breaks aside.
 *
 * A quote of one clause counts: `steps.ts` quoted the first clause of
 * `inscripcion-tardia-sancion`, wrapped across a docstring, and not its
 * second (#543). A clause is what punctuation bounds, and it counts from
 * `MIN_CLAUSE_WORDS` words: shorter ones («¿qué me pasa?») are how anyone
 * writes, not a wording someone copied.
 */
const QUOTE_ROOTS = ["src", "scripts", "e2e"];
const MIN_CLAUSE_WORDS = 4;

// Its own folding, not routing's `normaliseQuestion`: what counts as a quote
// must not move when the classifier's normalisation does. A string split by
// `"…" + "…"` is joined first, so a wrapped quote still reads as one.
const quotable = (text: string) =>
  text
    .replace(/["'`]\s*\+\s*["'`]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A comment's line break reads as a space, so a quote wrapped across
// `/** … * …` or `// …` lines still reads as one.
const uncommented = (text: string) =>
  text.replace(/\n[ \t]*(?:\*(?!\/)|\/\/)/g, "\n");

interface Wording {
  /** The case id, plus `#history[n]` for a follow-up turn. */
  id: string;
  /** The whole wording, then each clause of `MIN_CLAUSE_WORDS` or more. */
  texts: string[];
}

function wording(id: string, question: string): Wording {
  const clauses = question
    .split(/[,.;:¿?¡!«»()]+/)
    .map(quotable)
    .filter((clause) => clause.split(" ").length >= MIN_CLAUSE_WORDS);
  return { id, texts: [...new Set([quotable(question), ...clauses])] };
}

/** Every wording a held-out case asks the pipeline: its turns, then itself. */
function heldOutWordings(
  set: readonly Pick<EvalCase, "id" | "question" | "history">[],
): Wording[] {
  return set.flatMap((c) => [
    wording(c.id, c.question),
    ...(c.history ?? []).map((turn, i) =>
      wording(`${c.id}#history[${i}]`, turn.question),
    ),
  ]);
}

/** Every `.ts`/`.tsx` file under `QUOTE_ROOTS`, relative to `base`. */
function sourceFiles(base: string): string[] {
  return QUOTE_ROOTS.flatMap((root) =>
    readdirSync(path.join(base, root), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => path.join(root, file)),
  );
}

interface Quote {
  /** `<file> quotes <wording id>`: what the allowlist names. */
  key: string;
  /** The folded text that matched, so a failure says what to reword. */
  clause: string;
}

/** One per wording quoted in a file under `base`. */
function heldOutQuotes(base: string, wordings: readonly Wording[]): Quote[] {
  return sourceFiles(base).flatMap((file) => {
    const text = quotable(
      uncommented(readFileSync(path.join(base, file), "utf8")),
    );
    return wordings.flatMap((w) => {
      const clause = w.texts.find((t) => text.includes(t));
      return clause === undefined
        ? []
        : [{ key: `${file} quotes ${w.id}`, clause }];
    });
  });
}

const keys = (quotes: readonly Quote[]) => quotes.map((q) => q.key).sort();

/**
 * Quotes that must stay verbatim, each with its reason. A stale entry fails
 * too, so the list cannot outlive the text it excuses.
 *
 * `SEED_PROMPTS` are the product's Appendix A pills: a click sends the string
 * verbatim, and `e2e/`, the chat tests and the latency probe key on it. The
 * cases quoting them measure exactly what a pill sends, either as the
 * promoted Appendix A seeds or as a follow-up that opens on a pill, so the
 * wording is the product's, not one tuned against the set.
 */
const ALLOWED_QUOTES = [
  "src/components/chat/seed-prompts.tsx quotes ccss-cese-actividad#history[0]",
  "src/components/chat/seed-prompts.tsx quotes ccss-obligacion-ingreso-bajo",
  "src/components/chat/seed-prompts.tsx quotes desinscripcion-dejar-actividad",
  "src/components/chat/seed-prompts.tsx quotes ho-donde-me-afilio-caja#history[0]",
  "src/components/chat/seed-prompts.tsx quotes inscripcion-tardia-sancion",
];

describe("no file quotes a held-out question (#536, #543)", () => {
  const wordings = heldOutWordings(heldOut);
  const files = sourceFiles(process.cwd());

  it("reads the files and the wordings", () => {
    // Vacuity guard: an empty glob or set would pass the check below. 315
    // files on 2026-10-08; the floor leaves room to delete, not to lose a root.
    expect(files.length).toBeGreaterThan(250);
    for (const file of [
      path.join("src", "lib", "retrieval.test.ts"),
      path.join("src", "lib", "answer", "steps.ts"),
      path.join("scripts", "answer-replay.ts"),
      path.join("e2e", "chat-flow.spec.ts"),
    ]) {
      expect(files).toContain(file);
    }
    expect(wordings.filter((w) => w.id.includes("#history["))).not.toEqual([]);
    expect(wordings.every((w) => w.texts[0].length >= 10)).toBe(true);
  });

  it("finds none of them outside the allowlist, and no stale entry", () => {
    const quoted = heldOutQuotes(process.cwd(), wordings);
    const unallowed = quoted
      .filter((q) => !ALLOWED_QUOTES.includes(q.key))
      .map((q) => `${q.key}: «${q.clause}»`);
    expect(unallowed).toEqual([]);
    const stale = ALLOWED_QUOTES.filter(
      (entry) => !keys(quoted).includes(entry),
    );
    expect(stale).toEqual([]);
  });
});

describe("the quote guard, on a planted tree (#543)", () => {
  // Made-up wordings: a real held-out one would fail the guard above.
  const planted = {
    id: "planted",
    question: "Pagué el marchamo con monedas de oro, ¿me lo aceptan?",
    history: [
      {
        question: "¿Qué pasa si el perro se come la factura?",
        answer: "…",
      },
    ],
  };
  const wordings = heldOutWordings([planted]);

  const bases: string[] = [];
  afterAll(() => {
    for (const base of bases) rmSync(base, { recursive: true, force: true });
  });

  function plant(files: Record<string, string>): string {
    const base = mkdtempSync(path.join(tmpdir(), "held-out-"));
    bases.push(base);
    for (const root of QUOTE_ROOTS) mkdirSync(path.join(base, root));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
      writeFileSync(path.join(base, file), text);
    }
    return base;
  }

  it("reads a follow-up turn as a wording of its own", () => {
    expect(wordings.map((w) => w.id)).toEqual([
      "planted",
      "planted#history[0]",
    ]);
  });

  it("fails a quote in a non-test file's comment", () => {
    const base = plant({
      [path.join("src", "lib", "plain.ts")]:
        "/** «Pagué el marchamo con monedas de oro, ¿me lo aceptan?» */\n",
    });
    expect(keys(heldOutQuotes(base, wordings))).toEqual([
      `${path.join("src", "lib", "plain.ts")} quotes planted`,
    ]);
  });

  it("fails a quoted follow-up turn, split by `+` across lines", () => {
    const base = plant({
      [path.join("scripts", "probe.ts")]:
        'const q = "Que pasa si el perro " +\n  "se come la FACTURA";\n',
    });
    expect(keys(heldOutQuotes(base, wordings))).toEqual([
      `${path.join("scripts", "probe.ts")} quotes planted#history[0]`,
    ]);
  });

  it("fails a quote under e2e/, in a .tsx file too", () => {
    const base = plant({
      [path.join("e2e", "flow.spec.ts")]:
        'await ask("pague el marchamo con monedas de oro, me lo aceptan");\n',
      [path.join("e2e", "fixture.tsx")]:
        "<p>Pagué el marchamo con monedas de oro, ¿me lo aceptan?</p>\n",
      [path.join("e2e", "notes.md")]:
        "Pagué el marchamo con monedas de oro, ¿me lo aceptan?\n",
    });
    expect(keys(heldOutQuotes(base, wordings))).toEqual([
      `${path.join("e2e", "fixture.tsx")} quotes planted`,
      `${path.join("e2e", "flow.spec.ts")} quotes planted`,
    ]);
  });

  it("fails one clause of a wording, wrapped across docstring lines", () => {
    const base = plant({
      [path.join("src", "lib", "wrapped.ts")]:
        "/**\n * A reader writes «Pagué el marchamo\n * con monedas de oro» and…\n */\n",
      [path.join("src", "lib", "line.ts")]:
        "// A reader writes «pagué el\n// marchamo con monedas de oro».\n",
    });
    const quoted = heldOutQuotes(base, wordings);
    expect(keys(quoted)).toEqual([
      `${path.join("src", "lib", "line.ts")} quotes planted`,
      `${path.join("src", "lib", "wrapped.ts")} quotes planted`,
    ]);
    // The failure names the clause that matched, not just the case.
    expect(quoted.map((q) => q.clause)).toEqual([
      "pague el marchamo con monedas de oro",
      "pague el marchamo con monedas de oro",
    ]);
  });

  it(`passes a clause under ${MIN_CLAUSE_WORDS} words`, () => {
    const base = plant({
      [path.join("src", "lib", "short.ts")]: "// «¿Me lo aceptan?»\n",
    });
    expect(keys(heldOutQuotes(base, wordings))).toEqual([]);
  });
});
