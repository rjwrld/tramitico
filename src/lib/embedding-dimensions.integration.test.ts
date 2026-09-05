/**
 * The stub embedder against the real schema (issue #193).
 *
 * The claim {@link EMBEDDING_DIMENSIONS} makes is about Postgres, so only
 * Postgres can check it: pgvector compares fixed dimensions strictly, and a
 * query vector of the wrong width errors *inside* `search_chunks` — but only
 * once there is a row to compare against. That is why the mismatch survived
 * unnoticed for so long: every keyless run of this path was against empty
 * tables, where the comparison never happens.
 *
 * So the suite seeds the one row that makes the comparison real, and asks
 * with the keyless stub. What it asserts is not that the answer is good —
 * a hash vector against a real corpus is noise — but that the database
 * accepts the question at all.
 *
 * Env-gated (#129): skipped locally unless SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set; on CI a missing one fails.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "./embedding-dimensions";
import { createEmbedder } from "./ingestion/embedder";
import {
  asRetrievalClient,
  retrieve,
  type RetrievalRpcClient,
} from "./retrieval";
import type { Database } from "./database.types";
import { envPrereqs, integrationSuite } from "./test-support/suite-gate";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

const DOC_KEY = "__test-embedding-dimensions__";
/**
 * Deliberately carries a lexeme (`quetzalito`) that no corpus document holds.
 * The question below is that word alone, so the RPC's strict AND branch
 * matches this row and nothing else — the fixture ranks first in the lexical
 * leg whether this database is the lane's empty one or a developer's
 * corpus-carrying copy.
 */
const CONTENT =
  "El contribuyente quetzalito declara el impuesto sobre el valor agregado.";

describeDb("stub embeddings against chunks.embedding (integration)", () => {
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
          title: "Fixture de dimensiones",
          norma: "Ley 0000",
          source: { kind: "unresolved" },
        },
        { onConflict: "doc_key" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    documentId = data.id;
    // A real-width embedding — the row the vector leg has to compare against.
    const inserted = await db.from("chunks").insert({
      document_id: documentId,
      articulo: "ARTÍCULO 1",
      path: ["Fixture"],
      part: 0,
      content: CONTENT,
      embedding: JSON.stringify(
        new Array<number>(EMBEDDING_DIMENSIONS).fill(
          1 / Math.sqrt(EMBEDDING_DIMENSIONS),
        ),
      ),
    });
    if (inserted.error) throw new Error(inserted.error.message);
  });

  afterAll(async () => {
    await db.from("documents").delete().eq("doc_key", DOC_KEY);
  });

  it("writes a stub document embedding into chunks.embedding", async () => {
    const [vector] = await createEmbedder("stub").embed([CONTENT]);
    const { data, error } = await db
      .from("chunks")
      .update({ embedding: JSON.stringify(vector) })
      .eq("document_id", documentId)
      .select("id");
    expect(error).toBeNull();
    // The row count matters: an update that matched nothing also reports no
    // error, and would assert the column accepts a stub vector without ever
    // having handed it one.
    expect(data).toHaveLength(1);
  });

  it("survives search_chunks as a query embedding, with rows to compare", async () => {
    const result = await retrieve("quetzalito", {
      client,
      embedder: createEmbedder("stub"),
      // Dimensions only. The expansion legs (#286) would put a paid model
      // call in a suite that runs on the no-secrets CI lane and would embed
      // a second text through the stub for no assertion.
      expander: null,
    });

    // Not degraded: the stub always produces a vector, so the RPC really did
    // run its vector leg rather than the lexical-only contract `retrieve`
    // falls back to when an embed fails. Reaching this line at all is the
    // assertion — before #193 the call raised
    // `different vector dimensions 1024 and 256`.
    expect(result.isDegraded).toBe(false);
    expect(result.chunks.some((c) => c.docKey === DOC_KEY)).toBe(true);
  });
});
