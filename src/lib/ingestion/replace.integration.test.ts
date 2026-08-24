/**
 * `replace_chunks` against a real database (issue #59) — the atomicity claim
 * ADR 0002 hangs ingestion idempotency on, asserted.
 *
 * Env-gated: skipped locally unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are set; on CI a missing one fails the integration job rather than
 * skipping (#129). To run it locally:
 *
 *   supabase start
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm test
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { replaceDocumentChunks } from "./replace";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

const DOC_KEY = "__test-replace-chunks__";
/** chunks.embedding is vector(1024) (migration 20260804190000). */
const DIMS = 1024;

const vec = (seed: number) => new Array<number>(DIMS).fill(seed);
const chunk = (label: string, part = 0) => ({
  articulo: label,
  path: ["Test"],
  part,
  content: `Contenido ${label}.`,
});

describeDb("replace_chunks (integration)", () => {
  let db: SupabaseClient;
  let documentId: string;

  async function chunkLabels(): Promise<string[]> {
    const { data, error } = await db
      .from("chunks")
      .select("articulo")
      .eq("document_id", documentId)
      .order("articulo");
    if (error) throw new Error(error.message);
    return (data as { articulo: string | null }[]).map((c) => c.articulo ?? "");
  }

  beforeAll(async () => {
    db = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
    const { data, error } = await db
      .from("documents")
      .upsert(
        {
          doc_key: DOC_KEY,
          title: "Replace-chunks integration fixture",
          source: { kind: "unresolved" },
        },
        { onConflict: "doc_key" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    documentId = (data as { id: string }).id;
  });

  afterAll(async () => {
    // Chunks cascade with the document.
    await db.from("documents").delete().eq("doc_key", DOC_KEY);
  });

  it("replacing twice leaves exactly the last set, no duplicates", async () => {
    const first = [
      chunk("Artículo 1"),
      chunk("Artículo 2"),
      chunk("Artículo 3"),
    ];
    await replaceDocumentChunks(
      db,
      documentId,
      first,
      first.map((_, i) => vec(i + 1)),
    );

    const second = [chunk("Artículo 10"), chunk("Artículo 20")];
    const inserted = await replaceDocumentChunks(
      db,
      documentId,
      second,
      second.map((_, i) => vec(i + 1)),
    );

    expect(inserted).toBe(2);
    expect(await chunkLabels()).toEqual(["Artículo 10", "Artículo 20"]);
  });

  it("a failing insert leaves the prior chunks intact — the delete rolls back", async () => {
    const prior = [chunk("Artículo 10"), chunk("Artículo 20")];
    await replaceDocumentChunks(
      db,
      documentId,
      prior,
      prior.map((_, i) => vec(i + 1)),
    );

    // Wrong-dimension embedding: the vector cast fails mid-insert, after the
    // function's delete has already run inside the same transaction.
    await expect(
      replaceDocumentChunks(
        db,
        documentId,
        [chunk("Artículo 30"), chunk("Artículo 40")],
        [vec(1), [0.1, 0.2]],
      ),
    ).rejects.toThrow(new RegExp(documentId));

    expect(await chunkLabels()).toEqual(["Artículo 10", "Artículo 20"]);
  });
});
