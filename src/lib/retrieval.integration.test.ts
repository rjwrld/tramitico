/**
 * Hybrid retrieval against a real, ingested database (issue #20).
 *
 * Env-gated: skipped wholesale unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are set, which is why CI stays green without a database. To run it locally:
 *
 *   supabase start && pnpm ingest
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm test
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// Real-provider query embeds pace themselves against Voyage's 3-requests/min
// keyless tier (ADR 0003) — repeats hit the embedder's query cache, but each
// distinct question can legitimately wait out a rate-limit window.
vi.setConfig({ testTimeout: 120_000 });
import type { Database } from "./database.types";
import { createEmbedder } from "./ingestion/embedder";
import {
  DEFAULT_MATCH_COUNT,
  LEG_LIMIT,
  asRetrievalClient,
  citationUrl,
  fuseRrf,
  isCorroborated,
  retrieve,
  rrfScore,
  type DocumentSource,
  type RetrievalRpcClient,
  type SearchChunksRow,
} from "./retrieval";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const hasDb = Boolean(url && serviceRoleKey);
const embedder = createEmbedder();

function serviceClient(): RetrievalRpcClient {
  return asRetrievalClient(
    createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    }),
  );
}

async function searchChunks(
  queryText: string,
  queryEmbedding: string | null,
  matchCount = DEFAULT_MATCH_COUNT,
): Promise<SearchChunksRow[]> {
  const { data, error } = await serviceClient().rpc("search_chunks", {
    query_text: queryText,
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function embed(query: string): Promise<string> {
  const [vector] = await embedder.embed([query]);
  return JSON.stringify(vector);
}

const PRESCRIPCION = "prescripción retroactivo CCSS";
const TRAMOS = "tramos renta persona física";

describe.skipIf(!hasDb)("search_chunks against the ingested corpus", () => {
  it("puts Ley 10.363 ARTÍCULO 2 in the top 3 for the prescripción question", async () => {
    const rows = await searchChunks(PRESCRIPCION, await embed(PRESCRIPCION));
    const top3 = rows.slice(0, 3);
    expect(
      top3.some(
        (r) =>
          r.doc_key === "ley-10363" &&
          /ART[ÍI]CULO 2\b/i.test(r.articulo ?? ""),
      ),
    ).toBe(true);
  });

  it("puts the tramos decree in the top 3 for the renta question", async () => {
    const rows = await searchChunks(TRAMOS, await embed(TRAMOS));
    expect(rows.slice(0, 3).map((r) => r.doc_key)).toContain(
      "tramos-renta-2026",
    );
  });

  it("returns exactly the columns #21 and #25 build against", async () => {
    const [row] = await searchChunks(TRAMOS, await embed(TRAMOS), 1);
    expect(Object.keys(row).sort()).toEqual([
      "articulo",
      "chunk_id",
      "content",
      "doc_key",
      "doc_title",
      "fetched_at",
      "lexical_rank",
      "norma",
      "part",
      "path",
      "score",
      "source",
      "vector_rank",
    ]);
    expect(Array.isArray(row.path)).toBe(true);
    expect(typeof row.part).toBe("number");
    expect(typeof row.score).toBe("number");
    // The chip's "consultado el …" caption (#135): every ingested document is
    // stamped, so the column comes back as a timestamp, not null.
    expect(new Date(row.fetched_at!).getTime()).not.toBeNaN();
  });

  it("honours match_count", async () => {
    const rows = await searchChunks(PRESCRIPCION, await embed(PRESCRIPCION), 3);
    expect(rows).toHaveLength(3);
  });

  it("scores rows exactly as the RRF reference implementation does", async () => {
    const embedding = await embed(PRESCRIPCION);
    const vectorLeg = await searchChunks("", embedding, LEG_LIMIT);
    const lexicalLeg = await searchChunks(PRESCRIPCION, null, LEG_LIMIT);
    // A lexical-only row's score is coverage * rrfScore(rank), so dividing
    // recovers the coverage weight the SQL applied (1 on the strict branch).
    const expected = new Map(
      fuseRrf([
        vectorLeg.map((r) => r.chunk_id),
        lexicalLeg.map((r) => ({
          id: r.chunk_id,
          weight: r.score / rrfScore(r.lexical_rank!),
        })),
      ]).map((f) => [f.id, f.score]),
    );

    const fused = await searchChunks(PRESCRIPCION, embedding);
    expect(fused.length).toBeGreaterThan(0);
    for (const row of fused) {
      expect(row.score).toBeCloseTo(expected.get(row.chunk_id) ?? -1, 12);
    }
    const scores = fused.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("keeps working as a lexical-only search when there is no embedding", async () => {
    const rows = await searchChunks(PRESCRIPCION, null, 3);
    expect(rows[0].doc_key).toBe("ley-10363");
  });

  // A "fusion ranks the target no worse than either leg alone" test lived
  // here until #51. It was only ever a heuristic of unscaled RRF — fusion
  // deliberately lets a corroborated rival outscore a single-leg leader, and
  // coverage scaling made the cleaned lexical leg competitive with the fusion
  // — and comparing separate searchChunks calls made it flake on Voyage
  // embedding jitter (identical code passed and failed on consecutive runs).
  // The user-facing guarantee (target in the fused top 3) is the first test
  // above; the test below asserts what RRF does promise, from one call so no
  // jitter can split the legs.
  it("never fuses a corroborated chunk below a vector-only chunk with a worse vector rank", async () => {
    const rows = await searchChunks(
      PRESCRIPCION,
      await embed(PRESCRIPCION),
      LEG_LIMIT * 2,
    );
    const corroborated = rows.filter(
      (r) => r.vector_rank !== null && r.lexical_rank !== null,
    );
    const vectorOnly = rows.filter(
      (r) => r.vector_rank !== null && r.lexical_rank === null,
    );
    // Non-vacuous: the prescripción pool contains both kinds.
    expect(corroborated.length).toBeGreaterThan(0);
    expect(vectorOnly.length).toBeGreaterThan(0);

    // Both-legs agreement always beats one leg's weaker opinion: the
    // corroborated chunk's vector contribution alone already exceeds the
    // vector-only chunk's whole score, and coverage is strictly positive.
    // (Nothing comparable holds against lexical-only chunks or between two
    // corroborated ones — coverage scaling makes lexical contributions
    // non-monotone in lexical rank; that is by design, not asserted.)
    for (const a of corroborated) {
      for (const b of vectorOnly) {
        if (b.vector_rank! > a.vector_rank!) {
          expect(a.score).toBeGreaterThan(b.score);
        }
      }
    }

    // The returned per-leg ranks decompose the score: the vector part is a
    // floor, and with coverage ≤ 1 the unscaled sum is a ceiling.
    for (const r of rows) {
      const vec = r.vector_rank === null ? 0 : rrfScore(r.vector_rank);
      const lex = r.lexical_rank === null ? 0 : rrfScore(r.lexical_rank);
      expect(r.score).toBeGreaterThanOrEqual(vec - 1e-12);
      expect(r.score).toBeLessThanOrEqual(vec + lex + 1e-12);
    }
  });

  // 8 distinct queries = 8 real embeds, each pacing against the 3/min tier.
  it(
    "survives whatever a user types into the ask box",
    { timeout: 420_000 },
    async () => {
      // #21 hands raw user text to query_text, so tsquery syntax must never
      // escape into the query the lexical leg builds.
      const hostile = [
        "it's a test",
        "O'Reilly & sons | !x",
        '"quoted phrase" -excluded',
        "\\ backslash \\\\ double",
        "<>&|!():*",
        "🙂 emoji prescripción",
        "''''",
        "   ",
      ];
      for (const query of hostile) {
        await expect(
          searchChunks(query, await embed(query || "x"), 3),
        ).resolves.toBeInstanceOf(Array);
      }
    },
  );

  it("finds nothing for a question the corpus does not cover", async () => {
    const rows = await searchChunks(
      "zzzq wqxrt",
      await embed("zzzq wqxrt"),
      LEG_LIMIT,
    );
    // Only the vector leg can answer, so nothing is corroborated.
    expect(
      rows.some((r) => r.vector_rank !== null && r.lexical_rank !== null),
    ).toBe(false);
  });
});

describe.skipIf(!hasDb)("retrieve", () => {
  it("returns typed chunks and citations that link to the official source", async () => {
    const result = await retrieve(PRESCRIPCION);
    expect(result.query).toBe(PRESCRIPCION);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks.length).toBeLessThanOrEqual(DEFAULT_MATCH_COUNT);

    const cited = result.citations.find((c) => c.docKey === "ley-10363");
    expect(cited).toBeDefined();
    expect(cited!.norma).toBe("Ley 10363");
    expect(cited!.url).toMatch(
      /^https:\/\/sinalevi\.go\.cr\/ResultadosNormativa\/Informacion\?param1=99349/,
    );
    // Freshness reaches the chip through the citation itself (#135).
    expect(new Date(cited!.fetchedAt!).getTime()).not.toBeNaN();
    // One citation per artículo — parts of the same artículo collapse.
    expect(
      new Set(result.citations.map((c) => `${c.docKey} ${c.articulo}`)).size,
    ).toBe(result.citations.length);
  });

  it("derives a citation url for every ingested document", async () => {
    const admin = createClient<Database>(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
    const { data, error } = await admin
      .from("documents")
      .select("doc_key, source");
    if (error) throw new Error(error.message);
    for (const doc of data ?? []) {
      // documents.source is jsonb, so the generated type is free-form Json.
      expect(citationUrl(doc.source as DocumentSource), doc.doc_key).toMatch(
        /^https?:\/\//,
      );
    }
  });

  it("reports the top score and the weak-retrieval flag", async () => {
    const result = await retrieve(PRESCRIPCION);
    expect(result.topScore).toBe(result.chunks[0].score);
    expect(result.isWeak).toBe(!result.chunks.some(isCorroborated));

    const nonsense = await retrieve("zzzq wqxrt");
    expect(nonsense.isWeak).toBe(true);
  });
});

describe.skipIf(!hasDb || !anonKey)("grants", () => {
  it("refuses to run search_chunks for anon", async () => {
    const anon = asRetrievalClient(
      createClient<Database>(url!, anonKey!, {
        auth: { persistSession: false },
      }),
    );
    const { error } = await anon.rpc("search_chunks", {
      query_text: PRESCRIPCION,
      query_embedding: null,
      match_count: 1,
    });
    expect(error?.message ?? "").toMatch(
      /permission denied|not find the func/i,
    );
  });
});
