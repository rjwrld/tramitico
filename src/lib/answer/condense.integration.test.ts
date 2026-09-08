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
 * The fixture's vocabulary is invented on purpose (#279). This lane's
 * contract is a migrated, *empty* database, but Orca worktrees share one
 * corpus-carrying stack — and against hundreds of real chunks a fixture
 * written in CCSS vocabulary loses the fused ranking to the documents it is
 * imitating and falls out of the returned set. Every content lexeme of the two queries
 * below appears in CONTENT, and each query carries at least one word
 * (`zorbaluce`, `frunobulax`) that no Spanish document contains — so
 * `search_chunks` takes its strict AND branch and the fixture is the only
 * chunk that can match, on an empty stack and a full one alike. That is also
 * why the questions ask "¿Qué …?" rather than "¿Cómo …?": `qué` is a Spanish
 * stopword and `cómo` is not, so the latter would put a lexeme in the query
 * that CONTENT does not carry and drop the whole thing back onto the
 * corpus-sensitive OR-fallback branch.
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
 * The document the follow-up is about, written in a vocabulary no real
 * document shares: `zorbaluce` (the regime) and `frunobulax` (the entity)
 * are what keep the assertions below independent of what else is ingested.
 * Its wording is the superset of both questions' content words.
 */
const CONTENT =
  "El contribuyente zorbaluce que además es asalariado cotiza ante la " +
  "entidad frunobulax sobre sus ingresos declarados.";

/** The turn before it — this is what makes the follow-up resolvable. */
const HISTORY = [
  {
    question: "¿Qué cotiza un contribuyente zorbaluce?",
    answer: "Cotiza ante la entidad frunobulax sobre sus ingresos declarados.",
  },
];

/**
 * A standalone first turn, in the fixture's own vocabulary — the control for
 * "single-turn behavior is unchanged". Deliberately the same words as the
 * history turn above: both have to be a question the fixture answers, and
 * there is only one such question that stays inside CONTENT's vocabulary.
 */
const FIRST_TURN = HISTORY[0].question;

/**
 * Meaningless on its own — and, unlike the fixture's own words, `caso` is
 * ordinary legal Spanish that real documents do use. That is the point: the
 * raw follow-up must retrieve *something else* on a corpus-carrying stack and
 * still never the fixture.
 */
const FOLLOW_UP = "¿y en ese caso?";

const STANDALONE =
  "¿Qué cotiza ante la entidad frunobulax un contribuyente zorbaluce que " +
  "además es asalariado?";

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

  const retrieved = async (query: string) => {
    const result = await retrieve(query, {
      client,
      embedder: deadEmbedder(),
      // Condensation only (#132). The expansion legs (#286) are a second
      // rewrite on the same seam, and letting them run here would answer the
      // control case — "the raw follow-up finds nothing" — with the
      // expansion's rewrite instead of the condensation's. The step
      // catalogue (#304) is the same kind of second search — a standalone
      // question naming «renta» draws that family's legs over the whole
      // corpus — so it is switched off here too.
      expander: null,
      steps: null,
    });
    return result.chunks;
  };

  const found = async (query: string) =>
    (await retrieved(query)).filter((c) => c.docKey === DOC_KEY);

  it("retrieves the antecedent's document from the condensed question", async () => {
    const { query, condensed } = await condenseQuestion(FOLLOW_UP, HISTORY);

    expect(condensed).toBe(STANDALONE);
    // Unfiltered on purpose: the fixture is not merely *among* the results,
    // it is the whole result. That is the corpus-independence claim this
    // suite makes, so it is the thing asserted — a `docKey` filter here
    // would pass just as happily on the OR-fallback branch that #279 was.
    const chunks = await retrieved(query);
    expect(chunks.map((c) => c.docKey)).toEqual([DOC_KEY]);
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
    expect((await retrieved(query)).map((c) => c.docKey)).toEqual([DOC_KEY]);
  });
});
