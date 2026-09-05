import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../embedding-dimensions";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { ingestDocument } from "./ingest-document";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

const DOC_KEY = "__test-effective-date-ingest__";

describeDb("ingestDocument effective date (integration)", () => {
  let db: SupabaseClient;

  beforeAll(() => {
    db = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    await db.from("documents").delete().eq("doc_key", DOC_KEY);
  });

  it("populates documents.effective_date from the manifest-shaped input", async () => {
    await ingestDocument(
      {
        client: db,
        embedder: {
          provider: "stub",
          dimensions: EMBEDDING_DIMENSIONS,
          embed: async (texts) =>
            texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.1)),
        },
        now: () => "2026-09-04T12:00:00.000Z",
      },
      {
        doc_key: DOC_KEY,
        title: "Effective-date integration fixture",
        norma: null,
        source: { kind: "unresolved" },
        effective_date: "2026-01-01",
      },
      ["Artículo 1. La regla está vigente."],
    );

    const { data, error } = await db
      .from("documents")
      .select("effective_date")
      .eq("doc_key", DOC_KEY)
      .single();
    if (error) throw new Error(error.message);

    expect((data as { effective_date: string }).effective_date).toBe(
      "2026-01-01",
    );
  });
});
