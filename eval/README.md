# Eval dataset (SPEC §9, issue #25)

`dataset.jsonl` holds the 25±5 hand-written eval questions — Appendix A's ten
pain questions plus corpus-derived ones — each with the source docs/artículos a
correct retrieval must surface. One JSON object per line:

```json
{
  "id": "iva-clientes-fuera-cr",
  "seed": "appendix-a:2",
  "question": "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?",
  "expected": [
    { "docKey": "reglamento-iva", "articulo": "Artículo 11" },
    {
      "docKey": "ley-9635",
      "articulo": "Artículo 8",
      "pathIncludes": "TÍTULO I"
    }
  ],
  "blocking": true,
  "notes": "…"
}
```

- `expected` — any one target matching any answer-top-k chunk counts as a hit.
  Targets must be _correct sources for the question_, verified against the
  ingested corpus; never add a target just because retrieval returns it.
- `articulo` — exact label as chunked (case-insensitive); omit it to accept any
  chunk of the document (single-artículo docs like `cabys-dev`).
- `pathIncludes` — exact heading-path element, for artículo labels that repeat
  across Títulos of one norma (ley-9635 has three distinct "Artículo 15"s).
- `blocking` — the case fails the eval on its own, regardless of hit-rate.
  The canary from ADR 0003 is the one blocking case.
- `seed` — provenance: `appendix-a:<n>` (SPEC Appendix A) or `corpus`.

The assertion lives in `src/lib/eval/retrieval-hitrate.integration.test.ts`
(loader/matcher in `src/lib/eval/dataset.ts`). It runs each question through
the production retrieval path — fused pool of 30, Voyage rerank, top-8 — and
gates on hit-rate, the blocking canary, and the weak-retrieval threshold. It is
env-gated: skipped without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and real
embeddings; CI runs it once those secrets exist (see `.github/workflows/ci.yml`).

Run locally:

```sh
supabase start && pnpm ingest   # once
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
pnpm vitest run src/lib/eval/retrieval-hitrate.integration.test.ts
```

`RERANK=off` measures the fused-only baseline; the per-case table (pool rank,
top score) prints with the run.
