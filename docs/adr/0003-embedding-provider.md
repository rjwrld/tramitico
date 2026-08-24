# ADR 0003 — Embedding provider: voyage-3, plain retrieval mode

Date: 2026-08-04 · Status: accepted ·
Context: issue [#19](https://github.com/rjwrld/tramitico/issues/19), benchmarked by
[`scripts/bench-embeddings.ts`](../../scripts/bench-embeddings.ts)

## Context

SPEC §5 deferred the embedding model — Voyage `voyage-3` (1024d) vs OpenAI
`text-embedding-3-small` (1536d) — to a Week-2 benchmark on the Appendix-A questions against the
live corpus (675 chunks, 11 docs at benchmark time). Until now the corpus carried keyless stub
embeddings and `chunks.embedding` was a dimension-less `vector` column. The canary is the
vocabulary-gap question from the chunking prototype: _¿Debo cobrar IVA en facturas a clientes
fuera de Costa Rica?_ — the corpus says "exportación de servicios", the user says "clientes
fuera de Costa Rica", so the lexical leg cannot carry it.

## Benchmark

Vector leg only (cosine top-8; the lexical leg is provider-independent and would blur the
comparison). Hit = an acceptable target chunk in the top-8; targets identical across providers;
artículo matches exact. Run: 2026-08-04, pre-chunker-fix corpus.

| Provider                             | hit@8 | Canary target rank |
| ------------------------------------ | :---: | :----------------: |
| stub (hash, 256d)                    | 5/10  |   not in top 50    |
| openai `text-embedding-3-small`      | 9/10  |        #45         |
| voyage `voyage-3`                    | 9/10  |        #11         |
| voyage `voyage-3` + input_type hints | 9/10  |        #16         |

Findings, in the order they mattered:

1. **Voyage and OpenAI tie at 9/10** — every question except the canary hits, usually at rank 1.
2. **On the canary they are not close**: Voyage ranks Reglamento IVA · Art. 11 at #11; OpenAI
   at #45, unreachable for any sane top-k. The vocabulary-gap case is the one the vector leg
   exists for, so it decides the tie.
3. **Voyage's documented `input_type` hints measurably hurt this corpus** — #11 → #16 with hints
   on both sides, #16 with query-side only. Rejected on evidence; the embedder stays symmetric.
4. **The canary "failure" was substantially a chunking artifact.** Ley IVA's markup defeated
   the artículo boundary detector, so `Ley IVA · Artículo 8` (the exportación exemption itself)
   did not exist as a labeled chunk and unlabeled whole-capítulo blobs crowded the top ranks —
   see the [ADR 0002 amendment](0002-chunk-identity.md#amendment-2026-08-04--fragmented-and-inline-headings).
   The provider comparison stands (both providers were scored on the same corpus).

### Canary status on the re-chunked, re-embedded corpus (711 chunks)

Vector leg: `reglamento-iva · Artículo 11` at **#12** and `ley-iva · Artículo 8` at **#13** of
711 — from unreachable to just outside the top-8 cut. The exact phrase "exportación de
servicios" appears nowhere in the corpus (the law says "las exportaciones de bienes, así como
las operaciones…"), which is what makes this the canary.

Hybrid (RRF with the lexical leg) currently ranks the targets _below_ ~#20: the AND→OR tsquery
fallback matches near-everything on a natural-language question ("IVA", "factura", "Costa
Rica"), and those noise hits — corroborated or high-frequency — outscore single-leg vector
targets under RRF. That is a retrieval-fusion problem, not an embedding problem: no provider
choice fixes it (OpenAI sits 4× lower on the same query). The fallback's design is
[#37](https://github.com/rjwrld/tramitico/issues/37)'s ADR; tuning top-k, leg weights, and the
hit-rate assertion against the full eval set is
[#25](https://github.com/rjwrld/tramitico/issues/25)'s charter. The canary acceptance line
therefore transfers to #25 with this data as its baseline.

## Decision

1. **voyage-3, 1024 dimensions, no input_type hints.**
2. `chunks.embedding` is pinned to `vector(1024)` with an HNSW cosine index
   (migration `20260804190000_embedding_vector_1024.sql`); stub vectors were nulled and the
   corpus re-embedded via `pnpm ingest`.
3. `EMBEDDINGS_PROVIDER=voyage` in production. OpenAI and stub paths stay in the embedder — stub
   still powers keyless local dev and CI unit tests.
4. The Voyage embedder handles the keyless tier itself (~3 requests + 10K tokens per minute):
   **token-aware batching** (≈8K estimated tokens per request — a request above the TPM budget
   is rejected forever, not queued), ≥21s proactive gap between requests (bursting provokes
   penalty windows where every retry 429s), 429/5xx retry with Retry-After, and a module-level
   cache for repeated single-query embeds (seeded prompts, tests). A full corpus re-embed takes
   ~25 minutes and quarterly re-crawls stay free; adding a payment method on the Voyage
   dashboard lifts the limits to standard while the 200M free tokens still apply.

Also in Voyage's favor: retrieval-tuned model family, free-tier allowance covers this corpus'
volume many times over, and 1024d keeps the HNSW index a third smaller than 1536d.

## Consequences

- Switching providers later means a migration (column dimension) plus a full re-embed — cheap at
  this corpus size, but a schema event, not a config flip.
- Query embedding at ask-time goes through the same paced embedder; a single-question embed is
  one request and only waits if the corpus is being re-embedded concurrently.
- The benchmark harness (`scripts/bench-embeddings.ts`, `scripts/bench-canary-hybrid.ts`) stays
  in-repo for re-runs when the corpus or provider changes; embeddings cache under the OS temp
  dir so re-scoring is free.
- Issue [#37](https://github.com/rjwrld/tramitico/issues/37) reserved the name "ADR 0003" for
  the tsquery AND→OR fallback write-up; this document takes the number per #19's earlier
  contract, and that write-up landed as [ADR 0005](0005-lexical-and-or-fallback.md) (0004 was
  meanwhile taken by citation rendering).

## Amendment (2026-08-06) — canary resolved by reranking (#25)

The canary acceptance line that transferred to
[#25](https://github.com/rjwrld/tramitico/issues/25) is settled. On the
793-chunk corpus, the full eval set (`eval/dataset.jsonl`, 25 questions) scores
**19/25 fused-only vs 25/25 with Voyage `rerank-2.5-lite`** over a fused pool
of 30; the canary sits at fused #20 and reranks into the answer top-8.
Reranking is therefore **on by default** (`RERANK=off` opts out;
`src/lib/answer/rerank.ts`), and
`src/lib/eval/retrieval-hitrate.eval.test.ts` gates hit-rate at ≥92%
with the canary as a named blocking case — the referee for any future
lexical-leg tuning (ADR 0005). `WEAK_SCORE_THRESHOLD` was re-checked against
the same runs: every legitimate question scores ≥18% above it, value unchanged.
