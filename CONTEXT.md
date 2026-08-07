# Tramitico — Domain Context

Glossary of terms the codebase and issues use with a precise meaning. One line per term,
linking the spec section or ADR that owns the definition. Created lazily per
[docs/agents/domain.md](docs/agents/domain.md); grow it as terms get resolved.

## Glossary

- **Service client** — the one service-role Supabase client construction in
  `src/lib/supabase/service.ts`; `serviceClient()` throws on missing env (retrieval, rate
  limiting), `tryServiceClient()` returns null for callers documented to degrade (persistence,
  identity). [SPEC §7](SPEC.md#7-auth--rate-limiting), issue #56.
- **Wholesale replacement** — ingestion idempotency strategy: re-ingesting a document deletes
  and reinserts all its chunks rather than upserting by label, atomically via the
  `replace_chunks` RPC (`replaceDocumentChunks` in `src/lib/ingestion/replace.ts`).
  [ADR 0002](docs/adr/0002-chunk-identity.md), issue #59.
- **Judge / majority verdict** — the temperature-0 groundedness judge in CI; a flagged answer
  is re-judged and the majority of verdicts decides.
  [ADR 0007](docs/adr/0007-groundedness-judge-model.md), [SPEC §9](SPEC.md#9-eval--quality-gates).
- **Ask contract** — the `/api/ask` wire shape both the route and the chat UI build against:
  `{ question }` in, AI SDK UI message stream out, errors as `{ error, message }` with
  user-facing Spanish. `src/lib/answer/contract.ts`,
  [SPEC §6](SPEC.md#6-api-surface-route-handlers).
- **Sello snapshot** — a cumulative `data-citations` stream part carrying the deduped citations
  in order of use; the UI renders the latest snapshot as sello chips.
  [ADR 0004](docs/adr/0004-citation-rendering.md).
- **Corroboration** — a chunk surfacing in both retrieval legs (vector and lexical), which
  preserves its fused score under coverage-scaled fallback fusion (`isCorroborated` in
  `src/lib/retrieval.ts`). [ADR 0006](docs/adr/0006-coverage-scaled-fallback-fusion.md).
