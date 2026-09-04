/**
 * Manifest retirement against a real database (#256).
 *
 * A document is the aggregate root for its retrievable chunks. Deleting it
 * must therefore remove every chunk in the same statement via the FK cascade;
 * a half-retired document would remain reachable by retrieval.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../embedding-dimensions";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { persistDocument } from "./replace";
import { retireDocuments } from "./retire";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);
const DOC_KEY = "__test-retire-document__";

describeDb("retireDocuments (integration)", () => {
  let db: SupabaseClient;
  let documentId: string | undefined;

  beforeAll(() => {
    db = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    await db.from("documents").delete().eq("doc_key", DOC_KEY);
  });

  it("deletes the document and all of its chunks atomically", async () => {
    await persistDocument(
      db,
      {
        doc_key: DOC_KEY,
        title: "Retirement integration fixture",
        norma: null,
        source: { kind: "unresolved" },
        effective_date: null,
      },
      {
        fetched_at: new Date().toISOString(),
        embedding_provider: "stub",
        embedding_dim: EMBEDDING_DIMENSIONS,
      },
      [
        {
          articulo: "Artículo 1",
          path: ["Test"],
          part: 0,
          content: "Chunk que debe desaparecer con su documento.",
        },
      ],
      [new Array<number>(EMBEDDING_DIMENSIONS).fill(0.01)],
    );

    const { data, error } = await db
      .from("documents")
      .select("id")
      .eq("doc_key", DOC_KEY)
      .single();
    if (error) throw new Error(error.message);
    documentId = (data as { id: string }).id;

    await retireDocuments(db, [DOC_KEY]);

    const [document, chunks] = await Promise.all([
      db.from("documents").select("id").eq("id", documentId),
      db.from("chunks").select("id").eq("document_id", documentId),
    ]);
    if (document.error) throw new Error(document.error.message);
    if (chunks.error) throw new Error(chunks.error.message);
    expect(document.data).toEqual([]);
    expect(chunks.data).toEqual([]);
  });
});
