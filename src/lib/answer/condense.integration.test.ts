/**
 * Multi-turn against a real database (issue #132): a follow-up that means
 * nothing on its own retrieves the right document once it has been condensed.
 *
 * What only a database can answer. The unit suites pin the decisions — when
 * condensation runs, what it costs, what it does when it fails — against
 * fakes; none of them can show the thing the issue is actually about, which
 * is that the rewrite *changes what comes back out of the corpus*. So this
 * seeds one distinctive document, runs the same follow-up twice — raw, then
 * condensed — and asserts the two retrievals differ.
 *
 * The condenser is stubbed (`getCondenseModel`, the same seam the route tests
 * use): whether a real model writes a good rewrite is an eval-lane question,
 * and this lane has no keys. Retrieval is real, and lexical-only by
 * construction — the fixture's `embedding` stays null and the embedder is
 * dead, so a passing assertion here cannot be the vector leg in disguise.
 *
 * Env-gated (#129): skipped locally unless SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set; on CI a missing one fails.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm test:integration
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./model", () => ({ getCondenseModel: vi.fn() }));

import { condenseQuestion } from "./condense";
import { getCondenseModel } from "./model";
import type { Database } from "../database.types";
import type { Embedder } from "../ingestion/embedder";
import { EMBEDDING_DIMENSIONS } from "../embedding-dimensions";
import {
  asRetrievalClient,
  retrieve,
  type RetrievalRpcClient,
} from "../retrieval";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

const DOC_KEY = "__test-condensed-followup__";

/**
 * The CCSS half of the acceptance case, in the vocabulary a condensed
 * question would carry and the bare follow-up would not.
 */
const CONTENT =
  "El trabajador independiente asegurado por cuenta propia cotiza a la Caja " +
  "Costarricense de Seguro Social sobre sus ingresos netos declarados.";

/** The turn before it — this is what makes the follow-up resolvable. */
const HISTORY = [
  {
    question: "¿Cómo cotizo a la CCSS como trabajador independiente?",
    answer: "Se asegura por cuenta propia y cotiza sobre sus ingresos netos.",
  },
];

/**
 * A standalone first turn, in the fixture's own vocabulary — the control for
 * "single-turn behavior is unchanged". Written out rather than reusing the
 * history turn above, whose "CCSS" abbreviation the fixture's prose spells in
 * full and the lexical leg therefore cannot match.
 */
const FIRST_TURN =
  "¿Cómo cotiza un trabajador independiente asegurado por cuenta propia?";

/** Meaningless on its own: no noun in it belongs to any document. */
const FOLLOW_UP = "¿y si también soy asalariado?";

const STANDALONE =
  "¿Cómo cotiza a la Caja Costarricense de Seguro Social un trabajador " +
  "independiente asegurado por cuenta propia que además es asalariado?";

/** The outage that forces the lexical leg — no vector, in any budget. */
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

describeDb("condensed follow-up retrieval (integration)", () => {
  let db: SupabaseClient<Database>;
  let client: RetrievalRpcClient;

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
          title: "Fixture de seguimiento condensado",
          norma: "Ley 0000",
          source: { kind: "unresolved" },
        },
        { onConflict: "doc_key" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const inserted = await db.from("chunks").insert({
      document_id: data.id,
      articulo: "ARTÍCULO 1",
      path: ["Fixture"],
      part: 0,
      content: CONTENT,
    });
    if (inserted.error) throw new Error(inserted.error.message);
  });

  afterAll(async () => {
    await db.from("documents").delete().eq("doc_key", DOC_KEY);
  });

  beforeEach(() => {
    vi.mocked(getCondenseModel).mockReturnValue(
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text" as const, text: STANDALONE }],
          finishReason: { unified: "stop" as const, raw: "end_turn" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        }),
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const found = async (query: string) => {
    const result = await retrieve(query, {
      client,
      embedder: deadEmbedder(),
    });
    return result.chunks.filter((c) => c.docKey === DOC_KEY);
  };

  it("retrieves the antecedent's document from the condensed question", async () => {
    const { query, condensed } = await condenseQuestion(FOLLOW_UP, HISTORY);

    expect(condensed).toBe(STANDALONE);
    const chunks = await found(query);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(CONTENT);
  });

  it("finds nothing from the raw follow-up — the defect #132 closes", async () => {
    // The control, and the reason the whole mechanism exists: sent as the
    // reader typed it, the follow-up has lost its antecedent and the corpus
    // has no idea what it is about.
    expect(await found(FOLLOW_UP)).toEqual([]);
  });

  it("leaves a first turn's retrieval exactly as it was", async () => {
    const { query, condensed } = await condenseQuestion(FIRST_TURN);

    // No history, no model call, no rewrite — and the same retrieval a
    // single-turn ask has always produced.
    expect(condensed).toBeNull();
    expect(query).toBe(FIRST_TURN);
    expect(await found(query)).toHaveLength(1);
  });
});
