/**
 * Integration tests against a real Postgres (local Supabase). Env-gated on
 * SUPABASE_URL so `pnpm test` stays green with no local DB — CI without a
 * database skips this file gracefully.
 *
 * Query wording is deliberately anchored to terms that actually appear in
 * the target chunk's text (websearch_to_tsquery ANDs every term literally;
 * it doesn't stem synonyms), so the lexical leg is deterministic. The
 * vector leg runs on the stub embedder (hash noise, no semantic signal) —
 * a single-leg-only match can never score above 1/(60+1), so any assertion
 * relies on the lexical leg reaching top rank, not on vector luck.
 */
import { describe, expect, it } from "vitest";
import { searchChunks } from "./retrieval";

const SINGLE_LEG_MAX_SCORE = 1 / 61; // best possible RRF score from rank 1 in one leg only

describe.skipIf(!process.env.SUPABASE_URL)("searchChunks (integration)", () => {
  it("ranks Ley 10.363 ARTÍCULO 2 in the top 3 for a CCSS prescripción query", async () => {
    const result = await searchChunks(
      "plazo de prescripción CCSS trabajador independiente",
      5,
    );
    const top3 = result.chunks.slice(0, 3);
    expect(
      top3.some((c) => c.docKey === "ley-10363" && c.articulo === "ARTÍCULO 2"),
    ).toBe(true);
  });

  it("ranks tramos-renta-2026 in the top 3 for a tramos renta query", async () => {
    const result = await searchChunks("tramos renta persona física", 5);
    const top3 = result.chunks.slice(0, 3);
    expect(top3.some((c) => c.docKey === "tramos-renta-2026")).toBe(true);
  });

  it("RRF fusion beats either leg alone on at least one query", async () => {
    const result = await searchChunks(
      "requisitos régimen de tributación simplificada",
      5,
    );
    const [top] = result.chunks;
    // Only reachable by combining a lexical-leg and vector-leg contribution
    // for the same chunk — no single-leg-only match can score this high.
    expect(top.score).toBeGreaterThan(SINGLE_LEG_MAX_SCORE);
    expect(top.docKey).toBe("reglamento-renta");
    expect(top.articulo).toBe("Artículo 84");
  });

  it("exposes the top score as a weak-retrieval signal", async () => {
    const result = await searchChunks("tramos renta persona física", 5);
    expect(result.topScore).toBe(result.chunks[0].score);
  });
});
