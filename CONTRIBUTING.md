# Contributing

Thanks for your interest. Tramitico is a small, single-maintainer project, and at launch
it is **not accepting external pull requests**. Issues are welcome: bug reports, wrong or
outdated answers (please include the question and the citations shown), and suggestions
for official documents the corpus should cover.

If that changes, this file will say so. Anything you do contribute in the meantime
(issue text, patches attached to issues) is understood to be offered under the same
[Apache-2.0](LICENSE) terms as the codebase.

Security problems go through [SECURITY.md](SECURITY.md), not the issue tracker.

## Running the project locally

Requirements: Node 24 (`.nvmrc`; `fnm use` or `nvm use` picks it up), [pnpm](https://pnpm.io), and, for anything that touches the
database, the [Supabase CLI](https://supabase.com/docs/guides/cli) with Docker.

```bash
pnpm install
pnpm test:unit     # no database, no API keys
pnpm build
```

Those two commands are the keyless path and the required CI gate. They pass from a
clean clone with no `.env.local`.

To run the app or the database-backed lanes you need a local Supabase stack and
provider keys. Copy `.env.example` to `.env.local`, then:

```bash
supabase start
supabase migration up
pnpm dev
```

## Test lanes

| Command                 | Needs                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm test:unit`        | nothing                                                                                       |
| `pnpm test:integration` | a migrated, empty local database                                                              |
| `pnpm test:db`          | the same database plus the Supabase CLI (pgTAP)                                               |
| `pnpm test:e2e:local`   | the same database plus Playwright's Chromium                                                  |
| `pnpm test:eval`        | a database carrying the ingested corpus, real embeddings, an Anthropic key. Costs real money. |

`pnpm lint`, `pnpm typecheck` and `pnpm format:check` (Prettier) also run in CI on every
pull request. The rules for which lane a new test belongs to are in
[CLAUDE.md](CLAUDE.md#testing).

## Conventions

- One pull request per issue, conventional-commit title, squash-merged on green CI.
- Decisions that deviate from [SPEC.md](SPEC.md) are recorded as ADRs in `docs/adr/`.
- Answers must cite official documents; the eval lane in `eval/` is the release gate for
  that, and `eval/README.md` explains how it is run.
