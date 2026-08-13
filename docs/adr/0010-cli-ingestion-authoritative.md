# ADR 0010 — Ingestion runs from the CLI/CI, not from an HTTP route

Date: 2026-08-12 · Status: accepted · Amends [SPEC §6](../../SPEC.md) ·
Context: issues [#121](https://github.com/rjwrld/tramitico/issues/121),
[#128](https://github.com/rjwrld/tramitico/issues/128)

## Context

SPEC §6 has always listed `POST /api/ingest` (auth: "CI/admin secret") as part of the API
surface. It was never built. The real and only ingestion mechanism is `scripts/ingest.ts`, run as
`pnpm ingest [doc_key…]` — the same runner that produced the corpus, idempotent per document and
already the thing every ingestion issue points at.

The audit in #121 recorded the gap as a finding — the spec and the implementation disagree — and
the fix is one of two things: build the route, or make the CLI authoritative and say so. Nothing
in the product needs the route. Re-crawl is quarterly (SPEC §3), operator-initiated, and produces
a log an operator reads.

## Decision

**`pnpm ingest` is the authoritative ingestion mechanism, from a developer machine or from CI.
`POST /api/ingest` is dropped from the spec and will not be built.**

The route would be an internet-reachable write path holding the Supabase **service-role** key —
the one credential that bypasses every RLS policy in the database. Its blast radius is the whole
corpus and every user's history. Against that, it buys a solo operator nothing the CLI does not
already give: the CLI needs no shared secret in a request header, no rate limit of its own, no
timeout budget (a full re-crawl fetches, extracts, embeds, and upserts 14 documents — far past
any serverless duration cap), and it leaves no endpoint to discover, guess at, or brute-force.
The secret-guarded route is not "small extra risk"; it is the only door in the application
through which an attacker could reach service-role writes at all.

**Scheduled re-crawl is a GitHub Actions workflow** (`.github/workflows/recrawl.yml`) —
quarterly cron plus `workflow_dispatch` — that runs the same `pnpm ingest`. The service-role key
lives in Actions secrets, reachable only by a workflow run, never by an inbound request. This is
also what makes the quarterly maintenance contract in SPEC §3 real rather than aspirational, and
it matches the review cadence #121 asks its accepted risks to be re-examined on.

The workflow fails loudly and leaves evidence: the run log is the record, and an `if: failure()`
step files a GitHub issue, because a scheduled workflow's own failure email goes to one person
and is easy to miss. It also refuses to run with the stub embedder — `createEmbedder()` falls
back to `"stub"` when `EMBEDDINGS_PROVIDER` is unset, and a silent stub run would upsert
meaningless vectors over a working production corpus. Missing Supabase credentials already throw
inside the script.

## Consequences

- SPEC §6's route table lists two routes, `POST /api/ask` and `GET /api/history`. Any future
  admin action reached over HTTP is a new decision, not a re-reading of this one.
- Ingestion cannot be triggered by the running application — not by a cron inside Vercel, not by
  a webhook from a source site. Triggering means a workflow dispatch or a developer shell.
- The service-role key stays out of the deployed runtime's inbound surface entirely. The app's
  server code still uses its own Supabase credentials for reads and history writes under RLS.
- Re-crawl evidence lives in Actions run logs and in the issue the failure step files, not in an
  in-app admin view. There is no UI for ingestion, and this ADR is the reason not to build one.
- The workflow's secrets arrive with [#29](https://github.com/rjwrld/tramitico/issues/29)
  (production Supabase + provider keys). Until then a scheduled run fails at the guard or at the
  script's credential check — loudly, which is the intended behaviour, but the first real
  end-to-end proof is a manual dispatch after #29 lands.
