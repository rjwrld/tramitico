# Public-release review — 2026-09-17

Issue: [#252](https://github.com/rjwrld/tramitico/issues/252), half 2 · Reviewer: Claude
(Fable 5.1), the agent session that produced this file · Baseline: `e786697` on `main`
(the merge of #357, CSP enforced) · Owner sign-off: the comment
`scripts/public-release-wizard.sh` posts on #252 at its last stage.

> #252's verification list asks for a visibility-change checklist that records who
> reviewed secrets, corpus rights, Actions logs, repository settings and the live
> README/demo. This is that record for the agent's half. Half 1 (license, `SECURITY.md`,
> `CONTRIBUTING.md`, the rights table, the README section) landed earlier and is only
> re-checked here.

## 1. Verdict

Nothing blocks the flip. No credential was ever committed, no Actions log or artifact
carries one, and the tracked tree holds no production or personal data. The settings the
public repository needs — secret scanning, push protection, private vulnerability
reporting, Dependabot, branch protection — are switches the owner flips with the wizard,
most of them only available once the repository is public.

## 2. Secrets in the Git history

| What               | How                                                                                                                                                   | Result                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every commit       | `gitleaks git --log-opts=--all .` (gitleaks 8.30.1) after fetching every remote branch and tag                                                        | 195 commits, 31.9 MB, 20 refs. 53 findings, all `generic-api-key` on `doc_key`/`docKey` corpus slugs (`reglamento-iva-vigente`, …). Zero after the allowlist below.       |
| The allowlist      | `.gitleaks.toml`, a `[[rules.allowlists]]` entry on `generic-api-key` only, `regexTarget = "match"`, anchored to the whole `doc_?key: "<slug>"` match | Scoped to one rule and one match shape: a real secret on the same line, under any other name, or under any other rule still fires (checked with a scratch fixture).       |
| Tracked file names | `git ls-files` against `.env`, `.sql`, `.dump`, `.pem`, `.key`, `.p12`, `backup`, `secret`, `credential`, `transcript`                                | `.env.example` (placeholders only), `corpus/certs/globalsign-rsa-ov-ssl-ca-2018.pem` (a public CA intermediate, ADR 0001), and two eval transcript modules. Nothing else. |
| Tracked content    | `git grep` for the production Supabase ref, the owner's addresses, the Vercel team id, and the Anthropic/Voyage/Resend/Supabase/GitHub key prefixes   | Zero hits.                                                                                                                                                                |

Nothing to rotate, nothing to rewrite. The local `.env.local` and `.env.prod` files carry
real keys and are gitignored (`.env*`); the history scan confirms they never entered a
commit.

## 3. Actions logs and artifacts

Every run's log becomes public with the repository, so the whole history was pulled and
scanned, not sampled.

| What        | Scope                                                                                                     | Result                                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run logs    | All 300 runs still on GitHub (296 CI, 2 Eval, 2 Keepalive; none expired), 85 MB                           | gitleaks: 1027 findings, every one the `supabase start` fixed local-development keys (`sb_publishable_ACJWlz…`, `sb_secret_N7UND0…`) that the CLI's status table prints in the `suites` job. They are the same on every machine and open a throwaway container only. |
| Run logs    | Pattern grep for `sk-ant-`, `pa-`, `re_`, `sbp_`, `ghp_`, JWTs, the production ref, the owner's addresses | Zero hits.                                                                                                                                                                                                                                                           |
| Artifact    | The one artifact, `eval-transcripts` (433 KB, two `.jsonl` files from the production eval run)            | gitleaks: zero. Content is model answers plus the retrieved chunks of official text; the only e-mail addresses are CCSS institutional ones inside that text.                                                                                                         |
| Workflows   | `ci.yml`, `eval.yml`, `keepalive.yml`, `recrawl.yml` read                                                 | Secrets arrive via `${{ secrets.* }}` (masked by GitHub); `ci.yml`'s credential export writes to `$GITHUB_ENV`, not the log. Nothing echoes a secret.                                                                                                                |
| Source maps | `pnpm build` from a clean clone                                                                           | No `.map` under `.next/static`; `productionBrowserSourceMaps` is unset. Vercel builds with the same config.                                                                                                                                                          |

## 4. Content and corpus rights

Half 1's table in [`docs/corpus-samples/README.md`](../corpus-samples/README.md) names every
tracked third-party file — the two SINALEVI HTML snapshots, Hacienda's PDF and the CABYS
subset — with source URL and status, and states that Apache-2.0 relicenses none of it. The
README's License section says the same in one paragraph and reserves the Tramitico name and
mark. The published eval runs under `eval/runs/` embed official text verbatim inside their
groundedness rows, which the same README covers. Re-checked against `git ls-files`: no
third-party file exists outside that table. No sample needs replacing.

## 5. Security that does not depend on secrecy

Publishing the source reveals the routes, the prompt, the retrieval design and the
rate-limit scheme. None of those is a control. The controls are: the SQL-level lockdown
(`supabase/tests/least_privilege.test.sql`: no privilege for `anon`, `authenticated` or
`PUBLIC` on any public object, three RLS policies on `questions`), the anonymous-subject
HMAC key that lives only in the environment (`RATE_LIMIT_SUBJECT_SECRET`), the daily quota
RPC, the enforced CSP (#357), and provider keys held by Vercel and GitHub. `SECURITY.md`
states this and gives the private reporting path.

## 6. Issue and PR text

Every issue and pull-request body and comment was swept for the same identifiers as the
tree. Two informational hits, no credentials:

- **#2** (domain purchase) names the Vercel team slug in five comments. It is a dashboard
  URL path behind Vercel's login, not a secret. The owner may edit it out; nothing here
  requires it.
- **#29** (deploy) names the production Supabase project ref once. The same ref ships in
  the browser bundle as `NEXT_PUBLIC_SUPABASE_URL`, so it is public by construction.

## 7. Repository settings

State on 2026-09-17, read through the API, and what the wizard changes.

| Setting                         | Before                           | After the wizard                                                                  | Stage |
| ------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- | ----- |
| homepage                        | `https://tramitico.vercel.app`   | `https://tramitico.com`                                                           | 2     |
| topics                          | none                             | rag, nextjs, supabase, pgvector, claude, costa-rica, … (15)                       | 2     |
| Dependabot alerts               | disabled                         | enabled                                                                           | 3     |
| Dependabot security updates     | disabled                         | enabled (version bumps: `.github/dependabot.yml`, weekly, grouped)                | 3     |
| social preview                  | none                             | `docs/assets/social-preview.png`, uploaded by hand                                | 4     |
| visibility                      | private                          | public                                                                            | 5     |
| secret scanning                 | unavailable (private, free plan) | enabled                                                                           | 6     |
| push protection                 | unavailable                      | enabled                                                                           | 6     |
| private vulnerability reporting | unavailable                      | enabled                                                                           | 7     |
| branch protection on `main`     | none (deferred 2026-09-10)       | required `checks`, `suites`, `e2e`; `enforce_admins`; no reviews; `strict: false` | 8     |
| license detection               | Apache-2.0 (already detected)    | unchanged                                                                         | 9     |
| release                         | none                             | tag `v0.1.0` on `main`, GitHub release with short notes                           | 10    |

## 8. Clean-clone verification

Fresh `git clone` of `main` at `e786697` into an empty directory, no `.env.local`, Node
22.22.2, pnpm 11.5.2:

| Step                             | Result                            |
| -------------------------------- | --------------------------------- |
| `pnpm install --frozen-lockfile` | ok                                |
| `pnpm typecheck`                 | clean                             |
| `pnpm test:unit`                 | 88 files, 1409 tests, all passing |
| `pnpm build`                     | ok, 15 routes, no source maps     |

That is exactly the three-command path the README and `CONTRIBUTING.md` promise.

## 9. Sign-off

| Area                           | Reviewed by                  | When       | Evidence                                              |
| ------------------------------ | ---------------------------- | ---------- | ----------------------------------------------------- |
| Secrets, full Git history      | Claude (agent, #252 session) | 2026-09-17 | §2; `.gitleaks.toml`                                  |
| Actions logs and artifacts     | Claude (agent)               | 2026-09-17 | §3                                                    |
| Corpus and content rights      | Claude (agent), half 1 + §4  | 2026-09-17 | `docs/corpus-samples/README.md`, README License       |
| Issue and PR text              | Claude (agent)               | 2026-09-17 | §6                                                    |
| Clean clone                    | Claude (agent)               | 2026-09-17 | §8                                                    |
| Repository settings            | owner, via the wizard        | pending    | the wizard's stage-11 comment on #252 (API read-back) |
| Live README, demo, policy page | owner, via the wizard        | pending    | wizard stage 9                                        |
