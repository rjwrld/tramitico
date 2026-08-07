# Eval dataset (SPEC §9, issues #25/#26)

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

## Groundedness gate (issue #26)

`src/lib/eval/groundedness.integration.test.ts` runs every dataset question
through the full production answer path — retrieval, rerank, then the answer
model (`ANSWER_MODEL`, default Sonnet) with the production system prompt —
and asks an LLM judge at temperature 0: _is this answer supported by the
retrieved chunks?_ A failed item is re-judged twice more and the majority
verdict stands, absorbing judge flakiness at n≈25 without loosening the gate.
**Blocking gate: ≥90% pass** (`GROUNDEDNESS_GATE` in
`src/lib/eval/groundedness.ts`), starting threshold per #14 — ratchet up,
never down.

The judge is pinned (`JUDGE_MODEL`, Sonnet 4.5 — it accepts temperature 0,
which Sonnet 5 rejects; [ADR 0006](../docs/adr/0006-groundedness-judge-model.md))
and does **not** follow `ANSWER_MODEL`, so answer models are always compared
against the same judge. Pure parts (prompt,
verdict parsing, majority rule) are unit-tested in
`src/lib/eval/groundedness.test.ts`.

Env-gated like the hit-rate eval, plus `ANTHROPIC_API_KEY`:

```sh
supabase start && pnpm ingest   # once
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
ANTHROPIC_API_KEY=<key> \
pnpm vitest run src/lib/eval/groundedness.integration.test.ts
```

### Haiku comparison (SPEC §5)

The Week 3 cost/quality comparison is the same command with
`ANSWER_MODEL=claude-haiku-4-5` — same dataset, same judge, same gate. The
per-case table and pass rate print with each run; record both models' numbers
here once measured:

| Answer model                | Groundedness | Notes                        |
| --------------------------- | ------------ | ---------------------------- |
| `claude-sonnet-5` (default) | _pending_    |                              |
| `claude-haiku-4-5`          | _pending_    | ~5× cheaper per output token |
