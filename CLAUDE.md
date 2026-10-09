# Tramitico

This file is the working map for coding agents: where things are, which lane a test
belongs to, what a change must keep true. Humans start at the [README](README.md); the
narrative of how the project was built is [docs/how-it-was-built.md](docs/how-it-was-built.md).

RAG assistant for CR independent developers — tax & trámite answers cited to official
Hacienda/CCSS documents. [SPEC.md](SPEC.md) is the build contract; [DESIGN.md](DESIGN.md) the
visual contract; [PRODUCT.md](PRODUCT.md) the strategic context; [BRIEF.md](BRIEF.md) the
original scope (its §5 OUT-list is binding).

## Map

| Path                                                           | What it is                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/ask/route.ts`                                     | the ask pipeline: rate-limit → condense → expand → retrieve → rerank → answer → persist; the eval lanes and `scripts/answer-*` copy it   |
| `src/lib/retrieval.ts`                                         | hybrid search (vector + lexical, RRF); chunks → citations; the RPC is the newest `supabase/migrations/*search_chunks*.sql`               |
| `src/lib/answer/`                                              | prompt, model call, condensation (#132), query expansion (#286), step catalogue (#304), rerank+pins #508, citation contract, persistence |
| `src/lib/rate-limit.ts`                                        | daily quota via RPC; refunds on system failure                                                                                           |
| `src/lib/routing.ts` + `scripts/check-routing-urls.ts`         | institution table + keyword classifier behind the routed decline; URLs verified by the re-crawl                                          |
| `src/lib/ingestion/` + `scripts/ingest.ts`                     | corpus fetch → extract → chunk → embed, CLI-driven; quarterly re-crawl is owner-run `pnpm recrawl` (#405)                                |
| `corpus/manifest.json`                                         | which official docs are ingested, and from where                                                                                         |
| `src/lib/eval/` + `eval/README.md`                             | release gates; the README's Quick reference holds the knobs, the baseline, the paid-run recipe and the cheap `scripts/` reads            |
| `eval/corpus-index.json`                                       | committed corpus coverage dump; makes the satisfiability census a per-PR unit test                                                       |
| `eval/step-catalogue.json`                                     | hand-written steps per Tier 1 family, searched as one more retrieval leg pair (#304)                                                     |
| `src/components/`                                              | `chat/`, `history/`, `auth/`, `ui/` (Base UI), `sello.tsx` (source seals)                                                                |
| `src/lib/supabase/` + `src/proxy.ts`                           | browser/server/service clients; auth session proxy                                                                                       |
| `src/app/privacidad/` + `src/lib/log-redaction.ts`             | the privacy page; `describeError` — the one log-safe way to put an error in a log                                                        |
| `src/lib/telemetry.ts` + `docs/runbook.md`                     | the content-free per-ask event; what to watch, and when to roll back                                                                     |
| `src/lib/site.ts` + `src/app/robots.ts` + `src/app/sitemap.ts` | the crawl surface: origin, public page list, title template, JSON-LD; a new public page joins `PUBLIC_PATHS` and sets its own canonical  |
| `supabase/migrations/`                                         | schema, applied to the shared local stack; `doc_key` lives on `documents`, joined to `chunks` by `document_id`                           |
| `supabase/templates/` + `pnpm email:push`                      | what production mails; `email:push` sends only the `mailer_*` keys (never `config push`), `email:push --check` reads back                |
| `supabase/tests/`                                              | pgTAP: the SQL-level least-privilege guard (`pnpm test:db`)                                                                              |
| `e2e/`                                                         | Playwright on placeholder env; `*.local.spec.ts` via `playwright.local.config.ts`                                                        |
| `scripts/public-release-wizard.sh` + `docs/audits/`            | the #252 visibility flip: the owner-run settings pass, and the review record of what was scanned before it; later security-audit records |
| `.gitleaks.toml`                                               | `gitleaks git --log-opts=--all .` must stay at zero leaks; the allowlist covers corpus `doc_key` slugs, nothing else                     |

`/privacidad` names the subprocessors a question actually passes through (#136), so adding or
removing one MUST update that page in the same change — the page is a claim about the code.

## Testing

Four lanes, split by what they _need_ (`pnpm test` runs the three vitest ones, for
local convenience):

| Command                 | Suites                                   | Needs                                                                          |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm test:unit`        | everything else under `src/`, `scripts/` | nothing — the required CI gate                                                 |
| `pnpm test:integration` | `src/**/*.integration.test.ts`           | a **migrated, empty** database                                                 |
| `pnpm test:db`          | `supabase/tests/*.test.sql` (pgTAP)      | the same database, plus the Supabase CLI                                       |
| `pnpm test:eval`        | `src/**/*.eval.test.ts`                  | a database **carrying the ingested corpus**, real embeddings, an Anthropic key |

The dividing question when adding a suite: would it pass against a database that has
just been migrated and holds no rows? Yes → `*.integration.test.ts`. No → `*.eval.test.ts`.
Directory does not decide — `src/lib/retrieval.eval.test.ts` sits beside the module it
covers.

An integration suite must also pass against a database that holds _more_ than its own
fixtures: CI's stack is empty, but the local stack every worktree shares carries the
ingested corpus. A retrieval fixture therefore needs a word no real document contains, so
it wins `search_chunks`'s strict AND branch outright rather than competing with the whole
corpus for a place in the fused top-8 (#279).

The per-PR census of `eval/dataset.jsonl` is the one suite that straddles that
question by carrying its answer: `eval/corpus-index.json` is a committed dump of
the coverage in `public.chunks`, rewritten by `pnpm ingest` whenever it changes, so a
corpus change MUST commit the re-dump with it (#163). The eval lane's
real-table census is the backstop that fails when it drifts.

That line is a CI boundary, not a taxonomy (#147). `ci.yml`'s `suites` job runs the
integration and pgTAP lanes on every PR against a throwaway `supabase start` stack, with
**no secrets** — so a suite that needs corpus or a paid provider cannot live there.
`eval.yml` runs the eval lane on demand, with secrets. Since #161 the `suites`
job also runs `pnpm test:e2e:local`, the browser lane whose specs need a real Supabase in
the loop: on a stack with no corpus every `/api/ask` takes its weak-retrieval path, so
those specs stay keyless there too.

`supabase/tests/least_privilege.test.sql` is the SQL-level guard for the #123 lockdown:
it reads `pg_class`/`pg_proc`/`pg_default_acl` directly and fails if `anon`,
`authenticated` or `PUBLIC` hold any privilege on any object in `public`, or if the three
RLS policies on `questions` go missing. A regenerated schema dump re-adding grants is the
regression it exists to catch.

Env-dependent suites are gated with `integrationSuite()` from
`src/lib/test-support/suite-gate.ts` — never `describe.skipIf`/`describe.runIf` directly.
It skips locally when prerequisites are missing and **fails** under `CI=true`, naming what
is absent: a required check that silently asserts nothing is the failure mode it exists to
prevent (#129). Keep anything that throws without the environment (client and embedder
constructors) inside hooks or tests (`beforeAll`, `it`) — `describe.skip` still executes
the suite body, so describe scope is as unsafe as module scope (#211).

Every interactive component (anything with a click/submit/toggle path) ships with a jsdom
interaction test that exercises the interaction — not just the states an issue's Tests section
happens to enumerate. Rationale: our UI primitives are Base UI, whose composition constraints
(e.g. `GroupLabel` needs a `Group` ancestor) only fail at runtime, and server-side smoke tests
can't click. Pattern: `// @vitest-environment jsdom` + Testing Library + `afterEach(cleanup)`;
mock `@/lib/supabase/client` and `next/navigation` at the module boundary
(see `src/components/auth/user-menu.test.tsx`).

Done means: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit` and
`gitleaks git --log-opts=origin/main..HEAD .` pass locally, plus `shellcheck scripts/*.sh` when a
script changed (`brew install shellcheck`; the runner image's version can differ). CI's `checks` job
runs prettier as its own step, and ad hoc vitest runs always take `--project unit`, since a path
filter still pulls in the paid `*.eval.test.ts`. `pnpm build:hermetic` is Linux-only (CI); use
`pnpm build` locally. Compare and reset against `origin/main`: the local `main` ref is shared
with the main checkout and moves under you. After pushing, the PR is still open (the owner
merges fast, and a push to a merged PR's branch goes nowhere), its head matches local HEAD, and
CI is green.

Merging is the owner's call, and it deploys production: `gh pr merge <n> --squash
--match-head-commit <full sha>`. `main` requires green checks and an up-to-date branch; on
`BEHIND`, `gh pr update-branch <n>` and wait for CI again.

## Worktrees (T3 Code)

Development happens in T3 Code worktrees off `main`, under `~/.t3/worktrees/tramitico/` (the
branch is renamed from the thread title after the first turn). `scripts/worktree-setup.sh`
runs on create (deps, Playwright, symlinked `.env.local`, `.claude/settings.local.json` and
`eval/transcripts/`); a Local thread runs it in the main checkout too, where it exits at once.
If `node_modules` or those links are missing, run `bash scripts/worktree-setup.sh` (safe to
re-run). T3 creates worktrees; `EnterWorktree` and a raw `git worktree add` stay unused.
The linked env carries real keys — `pnpm test:eval` spends real API money, so default to
`test:unit` and `test:integration`. That money is the org-wide Anthropic balance production
answers on (no auto-reload, #552): a paid wave's pre-launch balance check must cover its hard
stop plus ~US$15 (runbook §7). The local Supabase stack is **shared across worktrees**:
`supabase start`/`stop` belong to the main checkout only, and a migration added on a branch
reaches the shared db via `supabase migration up` — a deliberate step, not part of setup.

T3 deletes a worktree on merge, on thread delete and after 15 days, with no teardown hook, so
nothing worth keeping may live only in one. A worktree's `eval/transcripts/` is a symlink to
the main checkout's: confirm `ls -l eval/transcripts` shows the link before a paid run, and
never `rm -rf eval/transcripts/` (the trailing slash empties the main checkout's). Commit
`eval/runs/` evidence before the PR merges. #304's three full-run transcripts (~US$30) died
with their worktree on 2026-09-08, and `eval/README.md` still cites them by name. A
transcript filename in the README is not a promise the file is on disk: check, and re-run
if you need the rows.

## Reporting

At the end of any run that commits, opens a PR, or spends paid API calls, report under three
headings, in this order: **Blocked on me** (decisions left open, `!` commands only the owner
can run, paid runs awaiting OK), **Changed** (branches, PRs, commits, shared-db or prod
state), **Found** (bugs, drift, stale docs — spotted but not fixed).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on rjwrld/tramitico (gh CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at root (created lazily) + `docs/adr/`. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
