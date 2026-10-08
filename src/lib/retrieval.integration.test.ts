/**
 * The degraded-retrieval fallback against a real database (issue #127).
 *
 * What only a database can answer: that `search_chunks` really does return
 * rows for `query_embedding: null`, and that `retrieve` turns those rows into
 * a usable, labeled result rather than an error. The unit suite pins the
 * decision (what gets sent, what gets counted) against a fake RPC; this pins
 * the RPC's half of the contract, which is where "the lexical-only path is
 * unreachable" (#127's premise) was true until now.
 *
 * No corpus and no embedding provider needed: the suite seeds its own document
 * with a null `embedding`, and the whole point is that the embed never runs.
 * That is what keeps it in the `suites` CI lane rather than the eval lane.
 *
 * Env-gated (#129): skipped locally unless SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set; on CI a missing one fails.
 *
 *   supabase start
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm test:integration
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  asRetrievalClient,
  retrieve,
  rrfScore,
  type RetrievalRpcClient,
} from "./retrieval";
import type { Embedder } from "./ingestion/embedder";
import { EMBEDDING_DIMENSIONS } from "./embedding-dimensions";
import type { Database } from "./database.types";
import { envPrereqs, integrationSuite } from "./test-support/suite-gate";

/** The `reason=` of every degraded-retrieval line logged so far. */
function degradedReasons(): string[] {
  return vi
    .mocked(console.warn)
    .mock.calls.map(([line]) => String(line))
    .filter((line) => line.startsWith("retrieval: degraded to lexical-only"))
    .map((line) => /reason=(\S+)/.exec(line)?.[1] ?? "");
}

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

const DOC_KEY = "__test-degraded-retrieval__";

/**
 * Distinctive enough that the lexical leg can find it in a database holding
 * anything else, and Spanish so the `spanish` text-search config stems it the
 * way it stems the corpus.
 */
const CONTENT =
  "El contribuyente inscrito en el régimen simplificado presenta la " +
  "declaración trimestral del impuesto sobre el valor agregado.";

/**
 * The expansion fixture (#286). The invented word is the whole point: it
 * cannot be in the question a reader types, and it cannot be in any real
 * document either, so a chunk that comes back for it came back because the
 * *expansion's* lexical leg found it — and it wins `search_chunks`'s strict
 * AND branch outright instead of competing with a corpus for a place in the
 * fused pool (#279).
 */
const EXPANSION_TOKEN = "zumbroquio";
const EXPANSION_CONTENT =
  `El ${EXPANSION_TOKEN} tributario se liquida ante la Administración ` +
  "Tributaria dentro del plazo del reglamento.";

/**
 * The step-catalogue fixture (#304), the #286 shape: an invented word no
 * reader types and no document holds, so a chunk that comes back for it came
 * back through the *catalogue's* lexical leg — and each sentence is its own
 * probe, so the token sits in the second sentence, where a concatenated
 * probe's strict AND branch would never have found it alone.
 */
const STEP_TOKEN = "quirlobante";
const STEP_CONTENT =
  `La cuota ${STEP_TOKEN} se cancela ante la sucursal correspondiente ` +
  "dentro del plazo que fije la institución.";

/**
 * The question-word fixture (#509), the same invented-word shape: a chunk
 * that says «cuesta» and the token but not «cuánto», so the reader's
 * «¿Cuánto cuesta…?» reaches it by strict AND only once the question word
 * stops being one of the terms ANDed.
 */
const QUESTION_TOKEN = "quornafel";
const QUESTION_CONTENT = `El ${QUESTION_TOKEN} cuesta lo que fije el reglamento de la institución.`;

/** The outage this whole path exists for: no vector, ever, in any budget. */
function deadEmbedder(): Embedder {
  const down = () => {
    throw new Error("Voyage embeddings: HTTP 503");
  };
  return {
    provider: "dead",
    dimensions: EMBEDDING_DIMENSIONS,
    embed: async () => down(),
    embedQuery: async () => down(),
  };
}

describeDb("retrieval degraded fallback (integration)", () => {
  let db: SupabaseClient<Database>;
  let client: RetrievalRpcClient;
  let documentId: string;

  beforeAll(async () => {
    db = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
    client = asRetrievalClient(db);
    const { data, error } = await db
      .from("documents")
      .upsert(
        {
          doc_key: DOC_KEY,
          title: "Fixture de búsqueda degradada",
          norma: "Ley 0000",
          source: { kind: "unresolved" },
          effective_date: "2026-01-01",
        },
        { onConflict: "doc_key" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    documentId = data.id;
    // `embedding` stays null on purpose: the vector leg has nothing to find
    // here even if someone hands the RPC a vector, so a passing lexical
    // assertion cannot be the vector leg in disguise.
    const inserted = await db.from("chunks").insert([
      {
        document_id: documentId,
        articulo: "ARTÍCULO 1",
        path: ["Fixture"],
        part: 0,
        content: CONTENT,
      },
      {
        document_id: documentId,
        articulo: "ARTÍCULO 2",
        path: ["Fixture"],
        part: 0,
        content: EXPANSION_CONTENT,
      },
      {
        document_id: documentId,
        articulo: "ARTÍCULO 3",
        path: ["Fixture"],
        part: 0,
        content: STEP_CONTENT,
      },
      {
        document_id: documentId,
        articulo: "ARTÍCULO 4",
        path: ["Fixture"],
        part: 0,
        content: QUESTION_CONTENT,
      },
    ]);
    if (inserted.error) throw new Error(inserted.error.message);
  });

  afterAll(async () => {
    await db.from("documents").delete().eq("doc_key", DOC_KEY);
  });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers from the lexical leg alone when the embedding provider is down", async () => {
    const result = await retrieve("régimen simplificado declaración", {
      client,
      embedder: deadEmbedder(),
      expander: null,
    });

    const mine = result.chunks.filter((c) => c.content === CONTENT);
    expect(mine).toHaveLength(1);
    expect(mine[0].effectiveAt).toBe("2026-01-01");
    expect(
      result.citations.find((citation) => citation.docKey === DOC_KEY)
        ?.effectiveAt,
    ).toBe("2026-01-01");
    // Lexical-only, from the database's own side: the fixture ranked in the
    // lexical leg and in no vector leg at all.
    expect(mine[0].lexicalRank).not.toBeNull();
    expect(result.chunks.every((c) => c.vectorRank === null)).toBe(true);
  });

  it("labels the result and counts the degradation", async () => {
    const result = await retrieve("régimen simplificado declaración", {
      client,
      embedder: deadEmbedder(),
      expander: null,
    });

    expect(result.isDegraded).toBe(true);
    // Not declined: a real citation came back, so there is something to say.
    expect(result.isWeak).toBe(false);
    expect(result.citations.some((c) => c.docKey === DOC_KEY)).toBe(true);
    expect(degradedReasons()).toEqual(["error"]);
  });

  it("finds through the expansion's lexical leg what the question misses (#286)", async () => {
    const result = await retrieve("¿y esto cómo se paga?", {
      client,
      embedder: deadEmbedder(),
      // The rewrite the model would produce, minus the model: this is the
      // seam, and the RPC's half of the four-leg contract is what is under
      // test here.
      expander: { expand: async () => `El ${EXPANSION_TOKEN} tributario` },
    });

    const mine = result.chunks.find((c) => c.content === EXPANSION_CONTENT);
    expect(mine).toBeDefined();
    // Found by the expansion alone: the question's own legs never saw it —
    // its lexical leg because the reader used none of these words, its vector
    // leg because the embedder is down.
    expect(mine!.expansionLexicalRank).not.toBeNull();
    expect(mine!.lexicalRank).toBeNull();
    expect(mine!.vectorRank).toBeNull();
    expect(result.expansion).toBe(`El ${EXPANSION_TOKEN} tributario`);
    // The expansion's failed embed is not the reader's degradation: only the
    // question's embed is counted, and it failed exactly once.
    expect(degradedReasons()).toEqual(["error"]);
  });

  it("finds through the catalogue's lexical leg what the question and the expansion miss (#304)", async () => {
    const result = await retrieve("¿y esto cómo se paga?", {
      client,
      embedder: deadEmbedder(),
      expander: null,
      // The probe the classifier would name, minus the classifier: the
      // RPC's half of the six-leg contract is what is under test, and the
      // token sits in the *second* sentence so a leg that searched the
      // sentences as one text could not have found it by strict AND.
      steps: {
        probe: () => ({
          family: "T1-B",
          sentences: [
            "La afiliación se tramita en la sucursal.",
            `La cuota ${STEP_TOKEN} se cancela ante la sucursal correspondiente.`,
          ],
        }),
      },
    });

    const mine = result.chunks.find((c) => c.content === STEP_CONTENT);
    expect(mine).toBeDefined();
    expect(mine!.stepLexicalRank).not.toBeNull();
    expect(mine!.stepVectorRank).toBeNull();
    expect(mine!.lexicalRank).toBeNull();
    expect(mine!.vectorRank).toBeNull();
    expect(result.steps?.family).toBe("T1-B");
    // The catalogue is no witness: a pool it filled alone is still weak on
    // the degraded path, and the sentences' failed embeds are not counted.
    expect(degradedReasons()).toEqual(["error"]);
  });

  it("ANDs the question's subject, not its question word (#509)", async () => {
    const result = await retrieve(`¿Cuánto cuesta el ${QUESTION_TOKEN}?`, {
      client,
      embedder: deadEmbedder(),
      expander: null,
      steps: null,
    });

    const mine = result.chunks.find((c) => c.content === QUESTION_CONTENT);
    expect(mine).toBeDefined();
    expect(mine!.lexicalRank).not.toBeNull();
    // The lexical leg is the only one that ran, so the score is its RRF
    // share alone, at full weight: the strict branch, coverage 1. With
    // «cuánto» ANDed in, no chunk matched all three lexemes, the OR
    // fallback ran, and the share was scaled to two thirds (ADR 0006).
    expect(mine!.score).toBeCloseTo(rrfScore(mine!.lexicalRank!), 12);
  });

  it("still declines a degraded query that matches nothing", async () => {
    const result = await retrieve("xyzzy plugh frobnicate", {
      client,
      embedder: deadEmbedder(),
      expander: null,
    });

    expect(result.isDegraded).toBe(true);
    expect(result.chunks).toEqual([]);
    expect(result.isWeak).toBe(true);
  });
});
