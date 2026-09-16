# Runbook — Tramitico in production

What to watch, what it means, and when to roll back.

**Scope.** This file starts with #141: the operational signal the app emits, the alerts
that have to be created in Vercel around it, and the rollback threshold. The deploy issue
(#29) extends it with the things only a real deployment can pin down — project and
environment wiring, the production Supabase, DNS, the rollback _procedure_ itself. Sections
marked **#29** are placeholders with the decision already made and only the mechanics
missing. #327 (2026-09-12) then re-based the whole file on the **free stack**: Tramitico ships
as a portfolio project first — no user cohort, no marketing, near-zero monthly cost — and §2,
§3.2 and §4 say what that changes and what it does not. §6 is the rollback procedure #141
left open; §7 is the free stack itself: why the database stays awake, where the spend cap is,
and why there is one Supabase project.

**Authority.** The owner (RJ) decides rollback. No automation rolls anything back.

---

## 1. What the app emits

Seven log signals, all content-free by construction. None of them may ever carry a question,
an answer, a user id, an IP, or an anonymous subject hash — see `src/lib/log-redaction.ts`
and `/privacidad`. If a change adds a field here, it changes a privacy claim.

### 1.1 The per-ask event (#141)

One line per request to `/api/ask`, whatever the request did, written from
`src/lib/telemetry.ts`:

```
tramitico.event {"event":"ask","outcome":"ok","latency":"1s_3s","providerError":null,"citationFailure":false,"quotaHit":false,"abort":null,"routedCategory":null}
```

| Field             | Values                                                                                                                                | Means                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`         | `ok`                                                                                                                                  | an answer was delivered                                                                                                                                                                                                                                                                                                                                                                            |
|                   | `declined`                                                                                                                            | no answer, nothing broke: honest decline, bad request, spent quota, or a client abort (refunded since #205, but still not our failure — see `abort`)                                                                                                                                                                                                                                               |
|                   | `degraded`                                                                                                                            | delivered without the vector leg — the embedding provider was down (#127)                                                                                                                                                                                                                                                                                                                          |
|                   | `refunded_error`                                                                                                                      | **our side broke**; the ask was refunded or never charged                                                                                                                                                                                                                                                                                                                                          |
| `latency`         | `lt_1s` `1s_3s` `3s_10s` `10s_30s` `gte_30s`                                                                                          | whole request, auth and rate limit included                                                                                                                                                                                                                                                                                                                                                        |
| `providerError`   | a `describeError` token (`APICallError#429`) or `null`                                                                                | error _class_, never an error message                                                                                                                                                                                                                                                                                                                                                              |
| `citationFailure` | `true` / `false`                                                                                                                      | the citation invariant rejected at least one generation this ask (#131)                                                                                                                                                                                                                                                                                                                            |
| `quotaHit`        | `true` / `false`                                                                                                                      | denied because the caller's daily quota was spent (#126)                                                                                                                                                                                                                                                                                                                                           |
| `abort`           | `client` / `deadline` / `null`                                                                                                        | cut short: the client's signal (Detener or a network drop — refunded, #205), or the route's own ~50 s deadline expiring before the platform kill (a system failure)                                                                                                                                                                                                                                |
| `routedCategory`  | `general` `hacienda` `ccss` `ins` `municipal` `registro-nacional` `colegios` `bancos` `meic` `migracion` `mtss` `contadores` / `null` | which institution the honest decline sent the reader to (#264) — non-null exactly on a weak-retrieval decline; `null` on every other ask, the #131 fail-closed decline included. A closed enum from `routing.ts`, derived by a keyword table; never the question. `contadores` (#285) is the one value that is not an institution: the question asked what to charge or which professional to hire |

The prefix `tramitico.event` is a contract. It is a constant in `telemetry.ts`, it is
quoted in every query below, and renaming it silently breaks all of them.

`outcome` is one class per ask, by precedence: `refunded_error` > `degraded` > `ok` >
`declined`. So `degraded` counts a degraded ask that then declined, and `declined` is the
default for an ask that delivered nothing at all.

### 1.2 The detail lines

The event says _that_ something happened; these say _what_. The first three predate #141 and
keep their prefixes; the fourth is #132's, added under the same rule — a detail line, not a
new field on the event, whose shape is a privacy claim. The last two are #208's: the
rate-limit door is the one failure the event cannot describe (it 503s before there is an
event), and `/api/csp-report` is the one line a stranger can cause to be written.

A rising `ask: condensation failed` count is a **degradation, not an outage**: every one of
those asks was answered, on the reader's literal question instead of a standalone rewrite, so
follow-ups retrieve worse while first turns are untouched (they never condense at all).
`reason=unusable` is the one to read closely — the provider answered and we rejected what it
said, which points at the prompt or the model rather than at availability.

`ask: expansion failed` (#286) reads the same way and is the same class of event, with one
difference in blast radius: expansion runs on **every** ask, not only follow-ups, so a
provider problem shows up here first and at full volume. It is not itself an outage: retrieval
continues on the question's own two legs, which is the search this product ran before #286, so
the ask proceeds down the ordinary path. That path can still find little and decline, or fail
later in answer generation — this line says only that the search was the pre-expansion one.
`EXPAND=off` turns the call off entirely if it ever needs to be shed.

| Prefix                                | From                                | Carries                                     |
| ------------------------------------- | ----------------------------------- | ------------------------------------------- |
| `ask: citation invariant violated`    | `src/lib/answer/invariant.ts`       | `violation=`, `attempt=`, `unresolved=`     |
| `retrieval: degraded to lexical-only` | `src/lib/retrieval-degraded.ts`     | `reason=timeout\|error`, `error=`           |
| `ask: history save failed`            | `src/lib/answer/persist-failure.ts` | `kind=answer\|decline`, `error=`            |
| `ask: condensation failed`            | `src/lib/answer/condense.ts`        | `reason=timeout\|error\|unusable`, `error=` |
| `ask: expansion failed`               | `src/lib/answer/expand.ts`          | `reason=timeout\|error\|unusable`, `error=` |
| `rate limit: unavailable`             | `src/lib/rate-limit.ts`             | `error=`                                    |
| `[csp-report] violation`              | `src/app/api/csp-report/route.ts`   | `directive=`, `blocked=`, `document=`       |

`rate limit: unavailable` is the whole diagnosis of a 503 (§1.3): the ask never reached the
telemetry event, so this line and its `error=` token — a `PostgrestError#…`, a
`TypeError`, an `Error` from a missing `RATE_LIMIT_SUBJECT_SECRET` — are the only signal
there is. One line per denied ask, so it also counts the blast radius.

`[csp-report] violation` carries only what an unauthenticated caller cannot use as a
channel: a directive name, the blocked load's **origin**, the document's **path**. Anything
outside those shapes reads `redacted`, and a body that never became a report is counted by
`[csp-report] dropped — reason=oversized|unreadable|unparsable|malformed` and otherwise
thrown away. A rising `dropped` count is someone poking the endpoint, not a CSP problem.

### 1.3 What is _not_ visible as an HTTP error

**Read this before trusting a 5xx dashboard.** `/api/ask` is stream-first (#71): everything
past the rate-limit check happens inside a **200** response, with failures carried as an
`error` part in the stream. So a dead Anthropic, a dead retrieval, a mid-answer network drop
— the route's principal failure modes — are **200s in Vercel's metrics**.

The only ask-route failures that appear as HTTP errors:

| Status | Cause                                                                              |
| ------ | ---------------------------------------------------------------------------------- |
| `400`  | missing/oversized question — client bug, not ours                                  |
| `429`  | quota spent — the product working                                                  |
| `503`  | rate limiter unavailable (Supabase RPC down, or `RATE_LIMIT_SUBJECT_SECRET` unset) |

The `503` is the one that carries no telemetry event; read `rate limit: unavailable` (§1.2)
for its reason.

This is exactly why §1.1 exists, and why the provider-failure alert in §3.2 cannot be one of
Vercel's built-in ones.

---

## 2. Reading the signal

**Where.** Vercel dashboard → project → **Logs** (sidebar). Filter `Route` to `/api/ask` and
`Environment` to `production`. The main search box does a substring match on the log message;
the sidebar filters do everything else.

**Retention is a prerequisite, not a detail.** Runtime-log retention is 1 hour on Hobby, 1
day on Pro, 30 days on Pro + Observability Plus. The rollback threshold below is a
**30-minute** window, which a 1-hour retention leaves no room to investigate inside.

**Production is on Hobby (#327, decision of 2026-09-12).** At portfolio traffic the 30-minute
window is empty anyway — §4's floor of 20 asks in a window is not reached in a week — so
the 1-hour retention costs nothing that Pro would buy back. What it does mean, honestly: the
queries in §2.1 answer for **the last hour only**, the §5 check after a deploy is the one time
the owner is guaranteed to be looking inside the window, and anything older than an hour is
gone unless it also produced a `questions` row. **Pro is what real traffic needs**: the day
there is a cohort, retention (1 day) and the drain in §3.2 are the first two things to buy,
and this paragraph is rewritten. Hobby's terms also forbid commercial use; a portfolio and a
free public tool are inside them, a paid tier on the same deployment would not be.

### 2.1 Queries

Each is a search-box string plus the sidebar filters already applied. Counts come from the
result count over the selected timeline.

| #   | Question                             | Search box                                                                                                                                                                                         |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | How many asks? (the denominator)     | `tramitico.event`                                                                                                                                                                                  |
| Q2  | How many broke on our side?          | `refunded_error`                                                                                                                                                                                   |
| Q3  | Which provider is failing?           | `"providerError":"` — read the tokens off the matching lines                                                                                                                                       |
| Q4  | How many ran on lexical-only search? | `"outcome":"degraded"`                                                                                                                                                                             |
| Q5  | Citation-invariant violations        | `ask: citation invariant violated`                                                                                                                                                                 |
| Q6  | Asks touched by a citation failure   | `"citationFailure":true`                                                                                                                                                                           |
| Q7  | Lost history rows                    | `ask: history save failed`                                                                                                                                                                         |
| Q8  | Quota denials                        | `"quotaHit":true`                                                                                                                                                                                  |
| Q9  | Slow asks                            | `"latency":"gte_30s"`                                                                                                                                                                              |
| Q10 | Asks cut short by the reader/network | `"abort":"client"`                                                                                                                                                                                 |
| Q11 | Asks the internal deadline killed    | `"abort":"deadline"` — any at all means generation is running against `maxDuration`                                                                                                                |
| Q12 | Why the limiter is 503ing            | `rate limit: unavailable` — read the `error=` tokens off the matching lines                                                                                                                        |
| Q13 | Declines by routing category (#264)  | `"routedCategory":"municipal"` (one query per category; `"routedCategory":"general"` is the unrouted default) — the content-free counter the decision record on #254 sets Tier 2 promotion against |

**Error rate = Q2 ÷ Q1** over the same timeline. That is the number §4 is written against.
Note what is deliberately _not_ in the numerator: `declined` (including the honest decline
and a spent quota) is the product working, and `degraded` is a delivered answer.

`refunded_error` and the prefixes in §1.2 are unique strings in this codebase, so those
queries need no quoting. Q3, Q4, Q6, Q8 and Q9 match on JSON fragments; if the search box
ever mangles the punctuation, fall back to the bare token (`degraded`, `gte_30s`) plus
`tramitico.event`.

### 2.2 Annual corpus churn (November–January)

Start the annual pass when the first next-period decree appears in November; finish it before the
new fiscal year can serve an answer. The manifest vigencia test turns red on 1 January while any
`annualChurn` entry still names the prior year, so a missed pass blocks release.

1. Check the new renta tramos, MTSS salarios mínimos, Poder Judicial salario base, both CCSS
   contribution scales, and the retained CCSS BMC adjustment mechanism against their official
   sources. For IVM, do a full re-verification before the current scale expires on 2028-12-31.
2. Update each changed entry's URL/member/pages, `doc_key` when it carries a year,
   `effective_date`, audit hash, notes, and derived-figure inputs. When an older rule remains
   unchanged, preserve its true `effective_date` and advance `verifiedForFiscalYear`. Keep
   `carriesFigures` and `annualChurn` explicit.
3. Run `pnpm exec vitest run --project unit src/lib/ingestion/manifest-vigencia.test.ts` before
   ingestion. A stale entry is a source-review task; do not move its date merely to make the test
   green.
4. Run `pnpm ingest` for the reviewed annual entries. Commit the resulting
   `eval/corpus-index.json`, then run the unit, integration, pgTAP, and local browser lanes before
   release.
5. Query `documents` for the annual keys and verify their `effective_date` and `fetched_at`; open
   one live answer and one history answer to confirm both sello dates render.

---

## 3. Alerts to create (#29 provisioning step)

Two alerts must reach the owner. Neither can be created from the repo — both are Vercel
dashboard configuration, and this section is the specification for it.

### 3.1 5xx rate — Vercel built-in Error Anomaly

Covers the `503` in §1.3 (a dead limiter, a missing secret) and any unhandled 5xx elsewhere
in the app.

1. Vercel dashboard → team **Settings → Alerts**.
2. **Add Rule**.
3. Triggers: **Error anomaly**. HTTP group: **5xx** (the default; leave 4xx off — our 4xx is
   `400 invalid_question`, a client bug, and a separate rule would only make noise).
4. **Next**. Name it `tramitico 5xx`. Project scope: the Tramitico project only.
5. Severities: **High** and **Medium** (the defaults). Low is off — at launch volume the
   baseline is too thin for a low-severity signal to mean anything.
6. **Create Alert Rule**, then in **Configure notifications**: enable **Subscribe Team
   Owners**, and under **Your Notifications** enable email _and_ push. Push is what makes it
   an alert rather than an inbox item.
7. Optional, once there is somewhere to send it: **Configure Slack Channels** on the rule
   (`/invite @Vercel` in the channel, then the `/vercel subscribe <team-id> alerts
+rule:<rule-id>` command the modal shows).

Vercel's error anomaly is a _baseline_ detector, not a fixed threshold: it fires on a
five-minute error count that is unusual against the route's trailing 24-hour baseline, with a
minimum activity floor to suppress low-volume noise. At launch traffic that floor may never
be crossed. **Treat this alert as a backstop, not as coverage** — §4's threshold is checked
by hand until traffic makes the detector meaningful.

### 3.2 Sustained provider-failure rate — a drain, because nothing built-in can see it

Vercel's built-in alerts only fire on HTTP status and usage metrics. §1.3 is the problem: our
provider failures are 200s. Vercel has no alert that runs a log query, and Monitoring's saved
queries were sunset. So this alert needs the logs to leave Vercel.

**Not provisioned on the free stack (#327).** Drains are Pro-only, and Hobby is the decision
(§2). The design below stays as the specification for the day the plan changes; until then
the "launch-day fallback" at the end of this section _is_ the coverage, and §4 says when
the thresholds start meaning anything.

**What to create**, when production moves to Pro:

1. Vercel dashboard → team **Settings → Drains** → add a drain.
2. Data type: **Logs**. Sources: runtime logs. Project: Tramitico. Environment: production.
3. Destination: either a **native integration** with threshold alerting, or a **custom HTTPS
   endpoint** the owner controls. This is the one open decision in this file and it is the
   owner's — it is the only thing here that adds a service.
4. At the destination, one alert rule:
   - **Condition:** `count(message contains "refunded_error") ÷ count(message contains
"tramitico.event") > 0.05`, evaluated over a rolling 30 minutes, with a floor of at
     least 20 asks in the window so a 1-in-3 morning does not page anyone.
   - **Also:** `count(message contains "ask: citation invariant violated")` more than triples
     its trailing 24-hour hourly average.
   - **Destination:** the owner, on a channel that interrupts — push or SMS, not email.

Drains are Pro/Enterprise only, billed by volume ($0.50/GB at the time of writing). One line
per ask at a couple hundred bytes makes this negligible at launch volume.

**Until the drain exists — the launch-day fallback.** The alert is not optional, but the drain
may not be ready on day one. In that gap, the owner checks Q1/Q2/Q5 (§2.1) by hand:

- after every production deploy, at +15 min and +60 min;
- twice daily otherwise.

Log this as a known gap, not as coverage. An eyeball at two fixed times is not an alert, and
the rollback threshold in §4 assumes someone is looking.

---

## 4. Rollback threshold (#141 req. 4)

**Roll back when either holds:**

1. **Error rate > 5% sustained over 30 minutes.** Q2 ÷ Q1 (§2.1) over a 30-minute window,
   with at least 20 asks in it. "Sustained" means the whole window, not a spike inside it —
   a single bad minute that recovers is not a rollback.
2. **A citation-validation failure spike.** Q5 running at more than 3× its trailing 24-hour
   hourly rate, or any 30-minute window in which more than 10% of asks carry
   `"citationFailure":true` (Q6 ÷ Q1).

Why these two and not more: the first is "the service is broken", the second is "the service
is answering, and we cannot stand behind what it says". The second is the more dangerous of
the two, because nothing about it looks broken from outside — a citation-invariant spike ends
in honest declines or, worse, in answers whose sourcing just started drifting. It is the one
failure mode where a working-looking app is the symptom.

**Not rollback triggers:**

- `degraded` (#127). The embedding provider is _allowed_ to be down; answers are still
  delivered and labeled. Worth investigating, not worth reverting — a rollback does not bring
  Voyage back.
- `quotaHit` (#126) or `declined`. Both are the product working.
- Lost history rows (§1.2, #139). The answer was delivered; the row was not. Investigate.

**When these become meaningful (#327).** The first threshold carries a floor of 20 asks in
a 30-minute window; the second is a rate against a trailing 24-hour average that an empty day
cannot form. At portfolio traffic neither condition can be met, so the thresholds are not
_wrong_, they are _dormant_: a single broken ask in an otherwise empty hour is 100% error rate
and still not a rollback signal, it is a bug report. Until traffic makes the floor reachable,
the operative signal is §5 (the deploy check) and the periodic eyeball in §3.2. The
thresholds are unchanged so that nothing has to be re-derived when the floor is reached.

**Authority: the owner.** Not a threshold that auto-reverts, not a decision delegated to an
agent. The thresholds above say _when to look_; the owner says whether to roll back.

**Procedure: §6.**

---

## 5. First 30 minutes after a deploy

Written for Hobby (#327): every step below runs with a browser, `curl`, and a 1-hour log
window. Do them in order; a failure at any step is a rollback per §6, not a retry.

1. **Serving.** Open the production URL. The home page renders and the `/privacidad` link
   works. `curl -sI https://tramitico.com/ | grep -i strict-transport-security` shows
   exactly one HSTS header with `max-age=63072000` (#137 — a shorter platform value winning
   would silently downgrade the control; reconcile in Vercel, not in `next.config.ts`).
2. **One real ask, signed out.** Ask a question from `eval/dataset.jsonl` — the first row,
   «¿Tengo que inscribirme en Hacienda si facturo a clientes en el extranjero?», is fine. The
   answer streams, ends, and carries at least one citation whose seal opens the official
   document. This is the whole pipeline — limiter, retrieval, rerank, model, citation
   contract — exercised once.
3. **Q1 and Q2** (§2.1) on the last 15 minutes. Q1 ≥ 1 (the ask above). Q2 = 0.
4. **One real ask, signed in.** Sign in (magic link or OAuth — the sign-in path is part of the
   deploy), ask again, confirm the row appears in history and that deleting it works. Q7 = 0.
5. **At +60 min**, Q1/Q2/Q5 again. This is the last look the 1-hour retention allows; past
   it, §3.2's twice-daily eyeball takes over.

Record the result as a comment on the deploy PR: the five steps, pass or fail, the time.

---

## 6. Rollback procedure (#141 req. 4, written by #327)

**The step.** Vercel keeps every previous deployment. Vercel dashboard → project →
**Deployments** → the last known-good production deployment → **⋯ → Promote to
Production** (or `vercel promote <deployment-url>` with the CLI). It is instant, and the
promoted build is exactly the build that was tested, not a rebuild. Then run §5 against
the rolled-back deployment; a rollback is a deploy.

**A rolled-back app against a migrated database.** The database does not roll back with the
app. Supabase migrations in `supabase/migrations/` are applied forward with `supabase db
push` and the previous deployment then runs against the _current_ schema. So the rule is:

> **A migration must be compatible with the deployment before it.** If it is not, the
> release is two steps — deploy the schema change that both versions can run on, then
> deploy the code that needs it — so that promoting the previous deployment is always safe.

What "compatible" means here, read off the migrations that exist today:

- **No migration drops or renames a column or table.** `20260804190000` changes the
  `chunks.embedding` type (vector(1024)), and it predates any deployment; the two
  `questions` changes add nullable columns. Additive changes are safe for a rollback by
  construction: the previous code never reads the new column.
- **The `search_chunks` rewrites are the destructive ones.** Seven migrations
  (`20260806140000`, `20260813153000`, `20260828120000`, `20260904120000`,
  `20260905120000`, `20260907120000`, and the original `20260723012234`) each `drop
function` and recreate `search_chunks` with a **new argument list**. A deployment that
  calls the old list gets PostgREST's function-not-found (`PGRST202`) on every ask: not a
  500, a `refunded_error` on a 200 stream (§1.3), i.e. an outage that only Q2 can see.
  `rate_limit_increment`, `rate_limit_refund` and `replace_chunks` have kept their
  signatures since they were created, but the same rule covers them. **Any RPC signature
  change is a two-step release**: the migration adds
  the new signature and keeps the old one as an overload (or the new code tolerates both),
  the code deploys, and a later migration drops the old signature once nothing can be
  promoted back to it. The `search_chunks` migrations to date did not do this because
  nothing had been deployed; the first one after #29 must. (PostgREST resolves overloads
  by named argument set, so two `search_chunks` with different parameter names coexist;
  two with the same names and different types would be ambiguous — change names, not
  just types.)
- **`least_privilege` (`20260812120000`) is a one-way door by design** (#123): a
  rolled-back app never held the grants it revoked, so it changes nothing for a rollback.

Check before every deploy that carries a migration: `git diff main -- supabase/migrations/`
and ask "can the deployment currently in production run against this?". If not, split it.

**A rolled-back app against a re-ingested corpus.** Ingestion (`pnpm ingest`, `recrawl.yml`)
replaces a document's chunks wholesale, in one transaction per document (`replace_chunks`,
ADR 0002). Chunk identity is the document plus its label and part, not a stable row id, so
after a re-ingest the ids in `chunks` are new. That has two consequences, both benign:

- **History keeps rendering.** `questions.citations` is a JSON snapshot of what was cited —
  document key, title, norma, artículo, URL, the dates (`src/lib/citations.ts`) — not a
  foreign key into `chunks`, and no chunk text. A citation in someone's history names the
  document as it was cited, and the seal still opens the official URL. Nothing in history
  breaks when the corpus changes underneath it; the «consultado el» date on the seal just
  gets older, honestly.
- **New asks see the new corpus, whatever the app version.** Retrieval reads `chunks`
  live. A rolled-back app answers from the re-ingested text, and a current app answers
  from a pre-recrawl corpus if ingestion has not run. The corpus and the app version are
  independent, and `eval/corpus-index.json` in the deployed commit is the record of which
  corpus the app was _tested_ against (#163). If a rollback crosses a recrawl and answers
  look wrong, the question is "which corpus is in the table", not "which build is
  serving" — `select id, title, fetched_at from documents order by fetched_at desc` says.

There is no corpus rollback. A re-ingest that went wrong is fixed forward by re-running
ingestion from the manifest, which is idempotent for the same reason.

---

## 7. The free stack (#327)

Decision of 2026-09-12: portfolio first. Everything below is chosen for near-zero monthly
cost and written down so an operator knows what is load-bearing. The console pass that
provisions all of it is scripted: `bash scripts/deploy-wizard.sh` opens each dashboard in
order, says what to click, and captures the values into a gitignored `.env.prod` and the
GitHub secrets the workflows read. Hosted Auth is configured through the dashboard only —
never `supabase config push`, which would upload `config.toml`'s localhost `site_url`.

**Vercel Hobby.** §2 says what it changes for observability. Nothing else in this file
depends on the tier.

**One Supabase free project.** Production is the only hosted project. The eval lane
(`eval.yml`) points its `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` secrets at it: the eval
suites read `chunks` and never write a row, and a second ingested project would double the
ingestion cost and the pause problem for a corpus that is supposed to be identical. The
per-PR lanes (`test:integration`, pgTAP, `test:e2e:local`) keep CI's throwaway `supabase
start` stack and never see production. `eval/README.md` records the same.

**Keep-alive.** A free project **pauses after 7 days without activity**, and portfolio
traffic does not guarantee a visit a week. `.github/workflows/keepalive.yml` reads one row
from `documents` through the service-role key, twice a week (Monday and Thursday, 06:00
UTC — a single missed run still lands inside seven days), and files a `needs-triage` issue
if the read fails. Two things it cannot do:

- **It cannot survive a quiet repo.** GitHub disables _every_ scheduled workflow in a
  repository after 60 days without a commit, and sends one email first. A portfolio repo
  that goes quiet loses `keepalive.yml` and `recrawl.yml` together, and the project pauses
  a week later. Any commit re-enables them; so does **Actions → the workflow → Enable**. If
  the repo is going to be untouched for two months, either push a trivial commit or accept
  the pause and restore from the Supabase dashboard when the link is next needed.
- **It cannot un-pause.** A paused project is restored from the Supabase dashboard (a
  minute or two; the data is kept for 90 days on the free tier). The failure issue says so.

**Anthropic spend cap.** Anthropic spend is the one cost a stranger can drive: the daily
quota (SPEC §7, 10 per subject) bounds a subject, not a crowd. Production runs on its own
Anthropic **workspace, `tramitico-prod`, with its own key and a US$10 monthly limit** set
in the Console (Settings → Limits on the workspace). When the cap is hit every ask fails as
a `refunded_error` with `providerError` naming the 4xx (§1.2) until the month rolls over,
which is the intended behaviour: an empty page beats a bill. The eval lane and local
development use a **separate workspace and key**, so an authorized eval run (`eval.yml`,
≈US$8–12) can never be blocked by, or eat into, production's cap. The pairing is recorded
beside `ANTHROPIC_API_KEY` in `.env.example`.

**What is not capped.** Voyage AI (embeddings and rerank) has no per-workspace spend limit
that this runbook knows of; the same stranger can drive it, one embedding call per ask.
Its free allowance is large and the per-subject quota still applies, so it is accepted,
not solved. If Voyage starts billing, the knob is `RERANK=off` (one call fewer per ask)
and, in the extreme, `EMBEDDINGS_PROVIDER=stub`, which the app labels as `degraded` and
answers on lexical search alone (#127).

**Google's consent screen names `<ref>.supabase.co`, not Tramitico.** Google prints the app
name only when the OAuth redirect lands on a domain the app's owner has verified; the
redirect is Supabase's, which cannot be. The cure is a Supabase custom auth domain
(`auth.tramitico.com`), a Pro-plan add-on — accepted as a cosmetic limit of the free stack on
2026-09-15 (#29). GitHub's consent screen has no such line.

**Email.** Resend, free tier, on the sending domain **`mail.tramitico.com`** — a subdomain
so its SPF/DKIM records never touch the apex, whose MX records the `privacidad@` forwarder
needs. `/privacidad` names Resend as the sign-in email provider (#327 req. 7): it holds the
address of everyone who signs in by magic link, which is personal data even though it
never sees a question.
