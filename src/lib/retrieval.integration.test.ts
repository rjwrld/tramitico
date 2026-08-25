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
  type RetrievalRpcClient,
} from "./retrieval";
import {
  degradedRetrievals,
  resetDegradedRetrievals,
} from "./retrieval-degraded";
import type { Embedder } from "./ingestion/embedder";
import type { Database } from "./database.types";
import { envPrereqs, integrationSuite } from "./test-support/suite-gate";

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

/** The outage this whole path exists for: no vector, ever, in any budget. */
function deadEmbedder(): Embedder {
  const down = () => {
    throw new Error("Voyage embeddings: HTTP 503");
  };
  return {
    provider: "dead",
    dimensions: 1024,
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
    const inserted = await db.from("chunks").insert({
      document_id: documentId,
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
    resetDegradedRetrievals();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDegradedRetrievals();
  });

  it("answers from the lexical leg alone when the embedding provider is down", async () => {
    const result = await retrieve("régimen simplificado declaración", {
      client,
      embedder: deadEmbedder(),
    });

    const mine = result.chunks.filter((c) => c.docKey === DOC_KEY);
    expect(mine).toHaveLength(1);
    expect(mine[0].content).toBe(CONTENT);
    // Lexical-only, from the database's own side: the fixture ranked in the
    // lexical leg and in no vector leg at all.
    expect(mine[0].lexicalRank).not.toBeNull();
    expect(result.chunks.every((c) => c.vectorRank === null)).toBe(true);
  });

  it("labels the result and counts the degradation", async () => {
    const result = await retrieve("régimen simplificado declaración", {
      client,
      embedder: deadEmbedder(),
    });

    expect(result.isDegraded).toBe(true);
    // Not declined: a real citation came back, so there is something to say.
    expect(result.isWeak).toBe(false);
    expect(result.citations.some((c) => c.docKey === DOC_KEY)).toBe(true);
    expect(degradedRetrievals()).toEqual({ timeout: 0, error: 1 });
  });

  it("still declines a degraded query that matches nothing", async () => {
    const result = await retrieve("xyzzy plugh frobnicate", {
      client,
      embedder: deadEmbedder(),
    });

    expect(result.isDegraded).toBe(true);
    expect(result.chunks).toEqual([]);
    expect(result.isWeak).toBe(true);
  });
});
