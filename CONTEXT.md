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
  is re-judged and the majority of verdicts decides. Owned by `judgeAnswer()` in
  `src/lib/eval/groundedness.ts`.
  [ADR 0007](docs/adr/0007-groundedness-judge-model.md), [SPEC §9](SPEC.md#9-eval--quality-gates).
- **Ask contract** — the `/api/ask` wire shape both the route and the chat UI build against:
  `{ question }` in, AI SDK UI message stream out, errors as `{ error, message }` with
  user-facing Spanish. Declared once in `src/lib/answer/contract.ts` (types, part id, helpers);
  both sides import it. [SPEC §6](SPEC.md#6-api-surface-route-handlers), issue #57.
- **Sello snapshot** — a cumulative `data-citations` stream part carrying the deduped citations
  in order of use; the UI renders the latest snapshot as sello chips.
  [ADR 0004](docs/adr/0004-citation-rendering.md).
- **Corroboration** — a chunk surfacing in both retrieval legs (vector and lexical), which
  preserves its fused score under coverage-scaled fallback fusion (`isCorroborated` in
  `src/lib/retrieval.ts`). [ADR 0006](docs/adr/0006-coverage-scaled-fallback-fusion.md).
- **Signing-key mode** — whether Supabase Auth signs access tokens symmetrically (HS256, one
  shared secret) or asymmetrically (ES256/RS256, published JWKS). It decides what `getClaims()`
  costs and trusts: with asymmetric keys it verifies the signature locally and never asks the
  Auth server, so a deleted user's unexpired token still passes; with symmetric keys it falls
  back to `getUser()`, a server round trip. **Verified 2026-08-12:** the local stack signs
  **ES256** with a JWKS at `/auth/v1/.well-known/jwks.json`; **no production project exists
  yet** (#29 provisions it) — re-verify its mode at provisioning, and assume asymmetric, since
  that is the current Supabase default. Hence `POST /api/account/delete` verifies its caller
  with `getUser()` and globally signs the account out _before_ deleting it, while read paths
  keep `getClaims()` and carry the ≤1h token tail as the accepted risk on #121. Issue #124.
- **Tier 1** — a published beta question family whose every eval case blocks release across
  retrieval, required claims and steps, citations, freshness, and abstention behavior. It is the
  coverage Tramitico promises, not a quality average. [ADR 0015](docs/adr/0015-coverage-tiers-and-required-claims.md).
- **Tier 2** — an adjacent question family answerable to the same evidence standard as Tier 1 but
  not advertised as guaranteed coverage; it may receive a cited best-effort answer or an honest
  abstention. [ADR 0015](docs/adr/0015-coverage-tiers-and-required-claims.md).
- **Required claim** — a material assertion that an answer to a particular eval case must contain
  to be adequate; a required procedural step is the action-oriented form of the same contract.
  [SPEC §9](SPEC.md#9-eval--quality-gates).
- **Derived figure** — a number calculated deterministically by code from an official formula and
  cited official inputs, rather than arithmetic inferred by the answer model. Issue #263.
- **Routing category** — a content-free classification of an out-of-scope question by the
  institution that should receive it; it selects the honest decline route and may be counted
  without recording question text. [ADR 0017](docs/adr/0017-other-institutions-are-routed.md).
