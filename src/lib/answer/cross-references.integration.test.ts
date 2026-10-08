/**
 * The cross-reference lookup against a real database (#508): what the unit
 * suite's fake cannot show is that the PostgREST read — `chunks` joined to
 * `documents`, a loose `ilike` per label, part 0 only — returns the chunk a
 * reference names, whatever spelling the chunker gave its label — case,
 * accent, «quáter», «8º» — and nothing from another document.
 *
 * The fixture documents carry doc_keys no real document has, so the assertions
 * hold on CI's empty stack and on the corpus-carrying stack worktrees share
 * alike: the lookup is filtered by doc_key before anything else.
 *
 * Env-gated (#129): skipped locally unless SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set; on CI a missing one fails.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../database.types";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { articuloLookup } from "./cross-references";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

const LAW = "__test-cross-reference-law__";
const OTHER = "__test-cross-reference-other__";

describeDb("cross-reference lookup (integration)", () => {
  let db: SupabaseClient<Database>;

  beforeAll(async () => {
    db = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
    for (const [docKey, chunks] of [
      [
        LAW,
        [
          { articulo: "Artículo 10", part: 0, content: "Tarifa del impuesto." },
          { articulo: "ARTICULO 12", part: 0, content: "Primera parte." },
          { articulo: "ARTICULO 12", part: 1, content: "Segunda parte." },
          { articulo: "Artículo 11 bis", part: 0, content: "Tarifa reducida." },
          { articulo: "Artículo 100", part: 0, content: "No es el 10." },
          { articulo: "Artículo 28 quáter", part: 0, content: "Con tilde." },
          { articulo: "Artículo 8º", part: 0, content: "Con ordinal." },
        ],
      ],
      [OTHER, [{ articulo: "Artículo 10", part: 0, content: "Otra ley." }]],
    ] as const) {
      const { data, error } = await db
        .from("documents")
        .upsert(
          {
            doc_key: docKey,
            title: `Fixture ${docKey}`,
            norma: "Ley 0000",
            source: { kind: "unresolved" },
            fetched_at: "2026-10-07T00:00:00Z",
          },
          { onConflict: "doc_key" },
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const inserted = await db.from("chunks").insert(
        chunks.map((chunk) => ({
          document_id: data.id,
          path: ["Fixture"],
          ...chunk,
        })),
      );
      if (inserted.error) throw new Error(inserted.error.message);
    }
  });

  afterAll(async () => {
    await db.from("documents").delete().in("doc_key", [LAW, OTHER]);
  });

  it("returns the first part of each named artículo of the named document", async () => {
    const found = await articuloLookup(db)([
      { docKey: LAW, articulo: "10" },
      { docKey: LAW, articulo: "12" },
      { docKey: LAW, articulo: "11 BIS" },
    ]);
    expect(
      found
        .map((chunk) => `${chunk.docKey}·${chunk.articulo}#${chunk.part}`)
        .sort(),
    ).toEqual(
      [
        `${LAW}·ARTICULO 12#0`,
        `${LAW}·Artículo 10#0`,
        `${LAW}·Artículo 11 bis#0`,
      ].sort(),
    );
    const art10 = found.find((chunk) => chunk.articulo === "Artículo 10")!;
    expect(art10).toMatchObject({
      docTitle: `Fixture ${LAW}`,
      norma: "Ley 0000",
      content: "Tarifa del impuesto.",
      source: { kind: "unresolved" },
      fetchedAt: expect.stringMatching(/^2026-10-07/),
      score: 0,
      vectorRank: null,
      lexicalRank: null,
    });
  });

  it("matches a suffix with its accent and a number with its ordinal sign", async () => {
    const found = await articuloLookup(db)([
      { docKey: LAW, articulo: "28 QUATER" },
      { docKey: LAW, articulo: "8" },
    ]);
    expect(found.map((chunk) => chunk.articulo).sort()).toEqual([
      "Artículo 28 quáter",
      "Artículo 8º",
    ]);
  });

  it("returns nothing for an artículo the document does not hold", async () => {
    expect(await articuloLookup(db)([{ docKey: LAW, articulo: "9" }])).toEqual(
      [],
    );
  });
});
