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
import { persistDocument, replaceDocumentChunks } from "./replace";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { EMBEDDING_DIMENSIONS } from "../embedding-dimensions";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

const DOC_KEY = "__test-replace-chunks__";
const vec = (seed: number) =>
  new Array<number>(EMBEDDING_DIMENSIONS).fill(seed);
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

  async function freshness() {
    const { data, error } = await db
      .from("documents")
      .select("fetched_at, embedding_provider, embedding_dim")
      .eq("id", documentId)
      .single();
    if (error) throw new Error(error.message);
    const row = data as {
      fetched_at: string | null;
      embedding_provider: string | null;
      embedding_dim: number | null;
    };
    return {
      ...row,
      fetched_at: row.fetched_at && new Date(row.fetched_at).toISOString(),
    };
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

  /**
   * `fetched_at` is a claim about the chunks that are actually in the table
   * (`search_chunks` returns it so the UI can date a citation), so it must be
   * written after them, never before (#206). Ingestion used to upsert the row
   * — freshness stamp and all — and only then replace the chunks: a failure in
   * between left the previous run's chunks dated by this run's clock.
   */
  it("leaves fetched_at untouched when replace_chunks fails", async () => {
    const identity = {
      doc_key: DOC_KEY,
      title: "Replace-chunks integration fixture",
      norma: null,
      source: { kind: "unresolved" },
      effective_date: null,
    };
    const prior = [chunk("Artículo 10"), chunk("Artículo 20")];
    const priorStamp = {
      fetched_at: "2020-01-01T00:00:00.000Z",
      embedding_provider: "stub",
      embedding_dim: EMBEDDING_DIMENSIONS,
    };
    await persistDocument(
      db,
      identity,
      priorStamp,
      prior,
      prior.map((_, i) => vec(i + 1)),
    );
    expect(await freshness()).toEqual(priorStamp);

    // Wrong-dimension embedding again: replace_chunks rejects, and everything
    // after it — the stamp — must not have run.
    await expect(
      persistDocument(
        db,
        identity,
        {
          fetched_at: new Date().toISOString(),
          embedding_provider: "voyage",
          embedding_dim: EMBEDDING_DIMENSIONS,
        },
        [chunk("Artículo 30")],
        [[0.1, 0.2]],
      ),
    ).rejects.toThrow(/replace_chunks failed/);

    expect(await freshness()).toEqual(priorStamp);
    expect(await chunkLabels()).toEqual(["Artículo 10", "Artículo 20"]);
  });

  it("stamps fetched_at once the chunks are in place", async () => {
    const stamp = {
      fetched_at: "2021-02-03T04:05:06.000Z",
      embedding_provider: "stub",
      embedding_dim: EMBEDDING_DIMENSIONS,
    };
    const chunks = [chunk("Artículo 99")];
    const inserted = await persistDocument(
      db,
      {
        doc_key: DOC_KEY,
        title: "Replace-chunks integration fixture",
        norma: null,
        source: { kind: "unresolved" },
        effective_date: null,
      },
      stamp,
      chunks,
      [vec(1)],
    );

    expect(inserted).toBe(1);
    expect(await freshness()).toEqual(stamp);
    expect(await chunkLabels()).toEqual(["Artículo 99"]);
  });
});
