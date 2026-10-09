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
tramitico.event {"event":"ask","outcome":"ok","latency":"1s_3s","stages":{"condense":"lt_1s","retrieve":"lt_1s","rerank":"lt_1s","pin":"lt_1s","generate":"1s_3s","validate":"lt_1s","persist":null},"generations":[{"latency":"1s_3s","firstText":"lt_1s","cache":"read","finishReason":"stop","refusal":null}],"providerError":null,"citationFailure":false,"absenceClaim":false,"typoRun":false,"quotaHit":false,"quotaReason":null,"abort":null,"routedCategory":null,"rerankDrops":[],"rerank":"on","lexicalRetry":false,"crossReference":"none"}
```

| Field             | Values                                                                                                                                                                                                                                                                                                                           | Means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`         | `ok`                                                                                                                                                                                                                                                                                                                             | an answer was delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|                   | `declined`                                                                                                                                                                                                                                                                                                                       | no answer, nothing broke: honest decline, bad request, spent quota, or a client abort (refunded only if it landed before retrieval began — ADR 0013's amendment; still not our failure, see `abort`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|                   | `degraded`                                                                                                                                                                                                                                                                                                                       | delivered without the vector leg — the embedding provider was down (#127)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|                   | `refunded_error`                                                                                                                                                                                                                                                                                                                 | **our side broke**; the ask was refunded or never charged: `retrieval_failed` (an outage), `answer_failed` (bar a deadline past the first generation), `rate_limit_unavailable`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|                   | `charged_error`                                                                                                                                                                                                                                                                                                                  | **our side broke** (or the search rejected the request's own text), but paid work had run, so the ask kept its charge: the deadline expired after generation began (`answer_failed`), or `unsearchable_question`, a SQLSTATE in class 22/54 (#436; `providerError` names it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `latency`         | `lt_1s` `1s_3s` `3s_10s` `10s_30s` `gte_30s`                                                                                                                                                                                                                                                                                     | whole request, auth and rate limit included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `stages`          | fixed keys `condense`, `retrieve`, `rerank`, `pin`, `generate`, `validate`, `persist`; each a latency bucket or `null`                                                                                                                                                                                                           | elapsed stage time, summed across citation retries before bucketing; `null` means the stage never ran. Failures and aborted generation retain their elapsed time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `generations`     | ordered array, one entry per answer attempt (at most two): `latency` bucket, `firstText` bucket or `null`, `cache` `read` / `write` / `none` / `null`, `finishReason` `stop` / `length` / `refusal` / `other` / `null`, `refusal` `cyber` / `bio` / `frontier_llm` / `reasoning_extraction` / `general_harms` / `other` / `null` | per-attempt total and time to first nonempty text delta at the server; `null` means no text arrived. This is not time to first visible text: the citation invariant still buffers the answer. `cache` (#413) is what the attempt did with the cached system prompt: `read` it, `write` it (first ask after the 5-minute entry expired), or `none`; `null` when the attempt never reported usage. The hit rate is `read` over all non-null. `finishReason` is why the model stopped: `length` is the output cap cutting the draft off (thinking counts toward it) — never shipped, retried once without the citation note; `refusal` is a safety classifier declining — no retry, the honest decline instead, and not a `citationFailure`. `refusal` names the classifier's category on a `refusal` (a category Anthropic adds later reads `other`), `null` otherwise |
| `providerError`   | a `describeError` token (`APICallError#429`) or `null`                                                                                                                                                                                                                                                                           | error _class_, never an error message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `citationFailure` | `true` / `false`                                                                                                                                                                                                                                                                                                                 | the citation invariant rejected at least one generation this ask (#131)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `absenceClaim`    | `true` / `false`                                                                                                                                                                                                                                                                                                                 | the delivered answer said the documents lack something the corpus index carries (#500): an artículo it ingested, or a listed figure (BMC, salario base, CABYS…). Since #563 it also counts #547's count hedge: «las fuentes no dicen cuántas veces se aplica» under a cited derived figure whose label says it («por cada declaración omitida»). These are the same checks as the eval lanes' false-absence zero, which fails the case there; here it is only counted, and the answer still ships. Never which claim                                                                                                                                                                                                                                                                                                                                                 |
| `typoRun`         | `true` / `false`                                                                                                                                                                                                                                                                                                                 | the delivered answer carried a typo run — a tripled letter, or a word starting with a doubled letter or syllable, like #490's «ppagado» (#500). Never the word                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `quotaHit`        | `true` / `false`                                                                                                                                                                                                                                                                                                                 | denied because the caller's daily quota was spent (#126)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `quotaReason`     | `subject` / `ip` / `null`                                                                                                                                                                                                                                                                                                        | which counter denied it (#383): `subject` is the caller's own daily quota (a user, or an anonymous IP + browser family), `ip` the anonymous per-IP umbrella every family on one IP shares. Non-null exactly when `quotaHit` is true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `abort`           | `client` / `deadline` / `null`                                                                                                                                                                                                                                                                                                   | cut short: the client's signal (Detener or a network drop — refunded only if it landed before retrieval began), or the route's own ~50 s deadline expiring before the platform kill (a system failure: `refunded_error` before generation began, `charged_error` after)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `routedCategory`  | `general` `hacienda` `ccss` `ins` `municipal` `registro-nacional` `colegios` `bancos` `meic` `migracion` `cosevi` `mtss` `contadores` / `null`                                                                                                                                                                                   | which institution the honest decline sent the reader to (#264) — non-null exactly on a weak-retrieval decline; `null` on every other ask, the #131 fail-closed decline included. A closed enum from `routing.ts`, derived by a keyword table; never the question. `contadores` (#285) is the one value that is not an institution: the question asked what to charge or which professional to hire                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `rerankDrops`     | array of `429` / `4xx` / `5xx` / `other_status` / `timeout` / `network` / `unreadable`, or `null`                                                                                                                                                                                                                                | one entry per rerank reading this ask lost (#466) — the question's, its expansion's or a step sentence's Voyage call; its length is the count. A lost reading is not an error: the answer is built from the readings that came back (all lost → the fused order), so the outcome stays `ok`, but the answer set may differ from the one a clean rerank would have chosen. `[]` when every reading came back; `null` when the rerank never called Voyage (a weak-retrieval decline, an ask that ended before it, `RERANK=off`). The number of readings _asked_ is deliberately absent: it depends on the step family the question classified to, which is a topic                                                                                                                                                                                                     |
| `rerank`          | `on` / `off`                                                                                                                                                                                                                                                                                                                     | the `RERANK` mode the deployment is configured with (#499), read as `rerank.ts` reads it — so an unknown value is `on`, the mode the pipeline actually runs. Configured, not performed: it tells `RERANK=off` apart from the other ways `rerankDrops` is `null` (no Voyage key, a decline, an ask that ended before the rerank). Production is `on`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `lexicalRetry`    | `true` / `false`                                                                                                                                                                                                                                                                                                                 | retrieval searched a second time with the question as typed, because the search without its question words came back weak (#509): one extra database round trip, no provider call. Never the question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `crossReference`  | `appended` / `none` / `failed` / `null`                                                                                                                                                                                                                                                                                          | what the cross-reference append did after the cut (#508, ADR 0024): `appended` one chunk, found `none` to append, or the lookup `failed` (an error, no service client, its 2 s budget — the line `cross-references: lookup failed` names which). `null` when it never ran: a decline, an ask that ended before it, `PIN_CROSS_REFERENCES=off`. Its time, with the derived pin's, is `stages.pin`: one database read on most asks, measured on the local stack at p50 ≈7 ms, p95 ≈14 ms (`pnpm cross-reference-census --timing`, eval/runs/2026-10-07-508/); production adds the Vercel → Supabase hop, which that measurement cannot see. Never which artículo                                                                                                                                                                                                       |

The prefix `tramitico.event` is a contract. It is a constant in `telemetry.ts`, it is
quoted in every query below, and renaming it silently breaks all of them.

`outcome` is one class per ask, by precedence: `refunded_error` / `charged_error` >
`degraded` > `ok` > `declined`. Which of the two error classes an ask gets is decided at
settlement, from whether its quota slot was given back (ADR 0013's amendment). So
`degraded` counts a degraded ask that then declined, and `declined` is the default for an
ask that delivered nothing at all.

#### Stage timing and the #356 measurement pass

Timing uses a monotonic clock. `condense` includes the no-op on first turns;
`retrieve` includes expansion, embedding and all search legs; `rerank` includes
fallback and derived-input pinning; `generate` includes prompt setup, provider wait,
SDK retries and draining the buffered text; `validate` includes citation and derived
figure checks; `persist` measures the history save on answers **and declines**.
Anonymous asks never persist. The stages exclude auth, quota checks, delivery and
refund settlement, so their sum is not the whole-request latency. Buckets cannot be
subtracted to obtain exact token throughput. A killed process still cannot emit a line.

After deploying the instrumentation, capture a bounded UTC window and deployment ID.
Use the nine questions in `src/components/chat/seed-prompts.tsx`, then a fixed Tier 2
comparison set from `eval/dataset.jsonl` (`tier: 2`). Send asks sequentially, with no
history for first-turn comparisons, respecting the normal quota. Record the first ask
after idle separately from warm asks; repeat on another day if quota is exhausted.
For follow-ups, use the dataset's history and report them separately.

For each controlled ask, keep its case/family and tier in the measurement worksheet,
then copy only the corresponding `tramitico.event` line from Vercel's request logs.
Do not add question text, case IDs, user identifiers or exact durations to production
telemetry. Arbitrary production traffic cannot reliably be divided by tier from these
content-free events; use the controlled pass for that comparison. Do not equate a
missing line with success, and exclude pre-instrumentation lines from stage counts.

Report, by tier, the sample count, outcome counts, stage bucket distributions, both
attempts' `firstText` and total buckets, citation retries, and **the count of
`abort: "deadline"` across all asks in the window**, not just successful probes.
Keep `null` separate from `lt_1s`. Record missing lines and interrupted probes too.

Record the decision and evidence on #356 after the pass:

- Fast first text but slow full generation supports testing shorter answers or a
  faster model. Compare required claims/steps, groundedness, citation validity and
  abstention against the current baseline; Tier 1 adequacy must not regress.
- Slow first text supports investigating provider/prompt latency and testing caching
  or a model change with the same eval gates. These buckets alone do not prove that
  prompt size caused the delay.
- Slow retrieval or rerank warrants an experiment in that stage before altering the
  answer prompt. Re-run retrieval and adequacy gates for any search change.
- Draft streaming requires a separate decision revisiting #131's citation invariant.
  A larger deadline only adds headroom; it does not fix time to visible text.

The instrumentation change is acceptance item 1. Items 2–3 remain open until this
production pass (or a week of usable production evidence) and its decision are recorded.

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

| Prefix                                | From                                 | Carries                                                    |
| ------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `ask: citation invariant violated`    | `src/lib/answer/invariant.ts`        | `violation=`, `attempt=`, `unresolved=`                    |
| `retrieval: degraded to lexical-only` | `src/lib/retrieval.ts`               | `reason=timeout\|error`, `error=`                          |
| `ask: history save failed`            | `src/lib/answer/persist.ts`          | `kind=answer\|decline`, `error=`                           |
| `ask: condensation failed`            | `src/lib/answer/condense.ts`         | `reason=timeout\|error\|unusable`, `error=`                |
| `ask: expansion failed`               | `src/lib/answer/expand.ts`           | `reason=timeout\|error\|unusable`, `error=`                |
| `rate limit: unavailable`             | `src/lib/rate-limit.ts`              | `error=`                                                   |
| `[csp-report] violation`              | `src/app/api/csp-report/route.ts`    | `directive=`, `blocked=`, `document=`                      |
| `config: unknown knob value`          | `src/lib/knobs.ts`                   | `NAME="value"`, the accepted values, the one it is read as |
| `cross-references: lookup failed`     | `src/lib/answer/cross-references.ts` | `error=`                                                   |

`rate limit: unavailable` is the whole diagnosis of a 503 (§1.3): the ask never reached the
telemetry event, so this line and its `error=` token — a `PostgrestError#…`, a
`TypeError`, an `Error` from a missing `RATE_LIMIT_SUBJECT_SECRET` — are the only signal
there is. One line per denied ask, so it also counts the blast radius.

`config: unknown knob value` (#499) is an environment variable that switches a pipeline
stage — `RERANK`, `EXPAND`, `STEPS`, `STEPS_RERANK`, `PIN_DERIVED_INPUTS`, `PIN_CROSS_REFERENCES` (#508), `PIN_NAMED_SOURCES` (#559) and, since #519,
`ANSWER_EFFORT` — set to a word it does not accept, or a numeric knob — `ANSWER_TOP_K`,
`ANSWER_DOC_CAP` (#519), and the daily quotas `RATE_LIMIT_ANON`, `RATE_LIMIT_AUTHED`,
`RATE_LIMIT_ANON_IP` (#532) — set to anything but a positive integer (or `off`, for the cap).
A quota counts whole asks, so `2.5` is a bad value too. The ask carries on in the variable's
code default, and the line repeats once per cold start until the variable is fixed in Vercel
and redeployed. For every pipeline knob but one that default is the production pipeline;
`ANSWER_EFFORT`'s is to send no effort, which the provider reads as `high`, so a typo there
costs production its `low` and its latency (#356). A bad quota reads as SPEC §7's 10, the
value production sets, and a bad `RATE_LIMIT_ANON_IP` as unset: 3 × the anonymous quota.
A mode knob opts out only on the exact word `off` (or another listed mode); `RERANK=on` kept
production unreranked from launch to #498 because nothing said so. A value that does not
look like a mode or a number is reported by its length, never printed: it may be a key
pasted into the wrong variable.

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

| #   | Question                                  | Search box                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | How many asks? (the denominator)          | `tramitico.event`                                                                                                                                                                                                                                                                                                                                              |
| Q2  | How many broke on our side?               | `refunded_error`                                                                                                                                                                                                                                                                                                                                               |
|     | … and those that kept their charge        | `charged_error` — a deadline past the first generation, or `unsearchable_question`: a search the request's own text broke (ADR 0013's amendment, #436)                                                                                                                                                                                                         |
| Q3  | Which provider is failing?                | `"providerError":"` — read the tokens off the matching lines                                                                                                                                                                                                                                                                                                   |
| Q4  | How many ran on lexical-only search?      | `"outcome":"degraded"`                                                                                                                                                                                                                                                                                                                                         |
| Q5  | Citation-invariant violations             | `ask: citation invariant violated`                                                                                                                                                                                                                                                                                                                             |
| Q6  | Asks touched by a citation failure        | `"citationFailure":true`                                                                                                                                                                                                                                                                                                                                       |
| Q7  | Lost history rows                         | `ask: history save failed`                                                                                                                                                                                                                                                                                                                                     |
| Q8  | Quota denials                             | `"quotaHit":true`                                                                                                                                                                                                                                                                                                                                              |
|     | … of which the per-IP umbrella (#383)     | `"quotaReason":"ip"` — a rise here with `"quotaReason":"subject"` flat is one IP fanning out across browser families, not more people asking                                                                                                                                                                                                                   |
| Q9  | Slow asks                                 | `"latency":"gte_30s"`                                                                                                                                                                                                                                                                                                                                          |
| Q10 | Asks cut short by the reader/network      | `"abort":"client"` — refunded only when it landed before retrieval began; the rest kept their charge                                                                                                                                                                                                                                                           |
| Q11 | Asks the internal deadline killed         | `"abort":"deadline"` — any at all means the pipeline exhausted its internal budget; use `stages` to locate the delay. `charged_error` if generation had begun                                                                                                                                                                                                  |
| Q12 | Which stage consumes the budget?          | On instrumented lines, group `stages.retrieve`, `stages.rerank`, `stages.pin`, `stages.generate`, `stages.validate`, `stages.persist` (and `condense`) by bucket; keep failures and nulls visible                                                                                                                                                              |
| Q13 | Provider wait or output generation?       | Compare `generations[0].firstText` with `generations[0].latency`; inspect the second attempt separately when present                                                                                                                                                                                                                                           |
| Q14 | Why the limiter is 503ing                 | `rate limit: unavailable` — read the `error=` tokens off the matching lines                                                                                                                                                                                                                                                                                    |
| Q15 | Declines by routing category (#264)       | `"routedCategory":"municipal"` (one query per category; `"routedCategory":"general"` is the unrouted default) — the content-free counter the decision record on #254 sets Tier 2 promotion against. On Hobby it is readable only live: one hour of retention and no drain (§2), so a count over weeks is tallied by hand from repeated reads, or waits for Pro |
| Q16 | Answers the model refused                 | `"finishReason":"refusal"` — read `refusal` off the matching lines. A tax question has no business tripping a classifier, so a steady trickle (`general_harms` above all) is a prompt or model question, not noise                                                                                                                                             |
| Q17 | Drafts the output cap cut off             | `"finishReason":"length"` — thinking and answer share `ANSWER_MAX_OUTPUT_TOKENS`; a rise after an effort or model change means the cap, not the model, is declining those asks                                                                                                                                                                                 |
| Q18 | Asks that lost a rerank reading (#466)    | `"rerankDrops":["` — read the classes off the matching lines; the rate is this over `"rerankDrops":[` (asks whose rerank ran). `429` is Voyage's rate limit, the load #457 measured in eval; a steady share is the case for retrying a rejected reading (#466 requirement 3)                                                                                   |
| Q19 | Rerank configured off (#499)              | `"rerank":"off"` — zero in production; any match is `RERANK=off` in the environment, deliberate or not                                                                                                                                                                                                                                                         |
| Q20 | Knob set to an unknown value (#499, #519) | `config: unknown knob value` — any match is a misconfigured variable, a mode knob (`ANSWER_EFFORT` included: production sets `low`) or a numeric one (`ANSWER_TOP_K`, `ANSWER_DOC_CAP`, `RATE_LIMIT_*`), and the line names it. Fix it in Vercel and redeploy                                                                                                  |
| Q21 | Answers with a false absence claim (#500) | `"absenceClaim":true` (a #547 count hedge included, §1.1) — the rate is this over delivered answers (`"outcome":"ok"` plus `"outcome":"degraded"`). It is the production read of what #507's prompt fix moves; a rise after a corpus or prompt change is worth a transcript read                                                                               |
| Q22 | Answers with a typo run (#500)            | `"typoRun":true` — a heuristic: read a few answers before calling it a model regression                                                                                                                                                                                                                                                                        |

**Error rate = (Q2 + its `charged_error` row) ÷ Q1** over the same timeline. That is the
number §4 is written against. Note what is deliberately _not_ in the numerator: `declined`
(including the honest decline and a spent quota) is the product working, and `degraded` is
a delivered answer.

`refunded_error`, `charged_error` and the prefixes in §1.2 are unique strings in this
codebase, so those queries need no quoting. Q3, Q4, Q6, Q8, Q9, Q18, Q19, Q21 and Q22 match on JSON fragments;
if the search box ever mangles the punctuation, fall back to the bare token (`degraded`,
`gte_30s`) plus `tramitico.event`.

### 2.2 Annual corpus churn (November–January)

**Who acts: the owner (RJ).** An agent may prepare the manifest PR, but the source review and
the ingest are the owner's, through `pnpm recrawl` from the main checkout (§2.3, #405). Finish
by **31 December**.

**What the app does on its own (#505).** `retrieve()` withholds every chunk from an
`annualChurn` source that does not cover the current Costa Rican fiscal year
([ADR 0016 amendment](adr/0016-source-freshness-policy.md)). At midnight on 1 January, Costa
Rica time, the chunks of a series with no source for the new year stop reaching the model, so
no answer can quote last year's figure as current. An ask left with nothing corroborated
declines. Next year's source can be
ingested beside this year's in December. The runtime switches to it on 1 January with no
deploy, so finishing early costs nothing.

**The signals.** From **1 December** the manifest vigencia test warns about every series with
no source for the coming year. In CI the warning is an annotation on each PR, and `pnpm recrawl`
prints it. On 1 January a series with no source for the new year turns the unit gate red. After
1 January the test also warns about each entry a newer one superseded, until it is retired.

**Calendar (checked 2026-10-07 for the 2027 pass).** It lives here and not in ADR 0016 because
it is operational and dated: the owner re-checks it every November, while the ADR records only
the decision that does not move. Links are to the official publications.

| Series              | Changes because                                                                                                                             | Published by, where                                                                                                                                                                                                                                | Last time                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 2027                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tramos-renta`      | Ley 7092 arts. 15, 33, 34 and 64 b), as the decree cites them: the tramos and créditos follow the IPC every year                            | Hacienda, Decreto Ejecutivo in La Gaceta, each one repealing the last                                                                                                                                                                              | 2026: DE 45333-H, [La Gaceta 229, 2025-12-05](https://www.imprentanacional.go.cr/pub/2025/12/05/COMP_05_12_2025.pdf). 2025: DE 44772-H, [Alcance 195 to La Gaceta 227, 2024-12-03](https://www.imprentanacional.go.cr/pub/2024/12/03/ALCA195_03_12_2024.pdf). Hacienda's `TramosRenta2026.pdf` is the only year at that URL pattern, so do not guess the next one                                                                                                                 | New decree, early December. New entry `tramos-renta-2027`; no carry-over                                                                                                  |
| `salario-base`      | Ley 7337 art. 2, read against the year's Ley de Presupuesto (the 2025 circular cites Ley 10.620)                                            | Consejo Superior of the Poder Judicial in December, then a Secretaría General circular in the Boletín Judicial; [Sala Tercera index](https://saladecasacionpenal.poder-judicial.go.cr/index.php/servicios/salarios-base-cuantias-en-materia-penal) | 2026: [Circular 246-2025](https://saladecasacionpenal.poder-judicial.go.cr/index.php/servicios/salarios-base-cuantias-en-materia-penal?download=905:base-salario-2026-circular-n-246-2025) (Consejo 2025-12-16, Boletín N.º 1, 2026-01-05). 2025: [Circular 258-2024](https://saladecasacionpenal.poder-judicial.go.cr/index.php/servicios/salarios-base-cuantias-en-materia-penal?download=809:circular-no-258-2024) (Consejo 2024-12-12, dated 2024-12-13). ¢462.200 both years | Circular expected mid-December, Boletín in early January. New entry `salario-base-2027` even if the figure holds: the doc_key and the circular carry the year             |
| `salarios-minimos`  | Ley 832 arts. 16–18: the Consejo Nacional de Salarios fixes them for one year, by 1 November; an MTSS decree makes them effective 1 January | Consejo Nacional de Salarios, then an MTSS Decreto Ejecutivo in La Gaceta or an Alcance; [MTSS page](https://www.mtss.go.cr/temas-laborales/salarios/salario_minimo.html)                                                                          | 2026: CNS sesión 5886 (2025-10-27), DE 45303-MTSS, [Alcance 156 to La Gaceta 229, 2025-12-05](https://www.imprentanacional.go.cr/pub/2025/12/05/ALCA156_05_12_2025.pdf). 2025: DE 44756-MTSS, [La Gaceta 232, 2024-12-10](https://www.imprentanacional.go.cr/pub/2024/12/10/COMP_10_12_2024.pdf)                                                                                                                                                                                  | New decree, late November to mid-December. New entry `salarios-minimos-2027`; no carry-over                                                                               |
| `ccss-escala-ivm`   | Reglamento del Seguro de IVM art. 33 and Transitorio XI: scheduled rises                                                                    | CCSS Junta Directiva acuerdo, in its actas                                                                                                                                                                                                         | Ficha PE-DAE-1179-2025, [sesión 9570 anexos](https://www.ccss.sa.cr/arc/actas/2025/files/9570-b1201.zip) (2025-12-18): effective 2026-01-01, «rige hasta 2028-12-31»                                                                                                                                                                                                                                                                                                              | **Carry over.** Confirm that no December acuerdo replaced it, then set `verifiedForFiscalYear: 2027`. Its brackets are in SM, so the colón bounds move with the SM decree |
| `ccss-escala-salud` | The Junta Directiva's escala for independientes and voluntarios; no scheduled step                                                          | CCSS Junta Directiva acuerdo, in its actas and La Gaceta                                                                                                                                                                                           | [Sesión 8999 art. 30](https://www.ccss.sa.cr/arc/actas/2018/11/8999.pdf) (2018), effective 2018-10-01; the 2026 adjustment touched IVM only                                                                                                                                                                                                                                                                                                                                       | **Carry over.** Same check, then `verifiedForFiscalYear: 2027`                                                                                                            |
| `ccss-bmc`          | The BMC is a multiple of the salario mínimo, so its colón amount moves with the MTSS decree                                                 | CCSS, by the indexation acuerdo in [SINALEVI ficha 87782](https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=87782&param2=&param3=1&param4=); current amounts on [ccss.sa.cr/patronos](https://www.ccss.sa.cr/patronos)                 | Acuerdos Segundo–Cuarto, verified for 2026                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Carry over** the mechanism (`verifiedForFiscalYear: 2027`). The colón figure is derived from the new `salarios-minimos` entry                                           |

The tramos decree and the salarios mínimos decree came out the same day, 2025-12-05. Watch La
Gaceta from late November. CCSS can change an escala at any Junta Directiva session, not only
on 1 January. Coverage is counted in whole fiscal years, so add an entry that takes effect
mid-year only once it does, and retire the one it replaces in the same PR.

**Year figures in sources that are not annual (#518).** Some artículos of non-annual sources
state one year's figures: SINALEVI's consolidated Ley 7092 carries the tramos and créditos in
arts. 15, 33 and 34, and the `ccss-faq` rate answer is the transcribed `av_tv_2026` image. The
manifest lists them as `yearFigures`, each with its `fiscalYear` and an `evidence` phrase.
`retrieve()` serves such a chunk only in its declared year **and** only while its own text carries
that evidence; the rest of the source keeps grounding answers
([ADR 0016 second amendment](adr/0016-source-freshness-policy.md)). So whichever moves first, the
manifest or the rows, the chunk is withheld until the other catches up. From 1 December the
vigencia test warns about each one; from 1 January it warns about each one still declared for a
past year. Neither turns CI red: the fix waits on SINALEVI and the CCSS, and until then the old
figure is already out of answers. Ingestion refuses a crawl in which a listed artículo is gone or
any of its chunks lacks the evidence.

**Steps.**

1. Review each new source against its official publication above. For IVM, a full re-verification
   is due before the current scale expires on 2028-12-31.
2. A changed source gets a **new entry beside the current one**, with the year in its doc_key,
   the new URL/member/pages, `effective_date` (1 January), audit hash and notes. Move the
   `derivedFigures` whose inputs it supplies with it: the CNPT multas read `salario-base-*`, the
   BMC reads `salarios-minimos*`. An unchanged source keeps its true `effective_date` and advances
   `verifiedForFiscalYear`, which may happen in December because the entry still covers the year
   it is in. Keep `carriesFigures` and `annualChurn` explicit.
3. Run `pnpm exec vitest run --project unit src/lib/ingestion/manifest-vigencia.test.ts`. A series
   that is still uncovered is a source-review task: do not move a date just to make the test green.
4. `pnpm recrawl <doc_key…>` for the reviewed entries. Commit the resulting
   `eval/corpus-index.json`, then run the unit, integration, pgTAP and local browser lanes before
   release.
5. **In January**, retire each entry the test lists as superseded: move its doc_key to
   `retiredDocKeys` with a `retirementNotes` line, retarget `eval/dataset.jsonl` and
   `eval/step-catalogue.json` rows that name it, and `pnpm recrawl` so its rows are deleted.
   Retrieval withholds a retired key from the moment the manifest deploys.
6. Query `documents` for the annual keys and check their `effective_date` and `fetched_at`. Open
   one live answer and one history answer to confirm both sello dates render.
7. **Year figures, once the publishers move (#518).** The manifest goes first, because
   `pnpm recrawl` crawls only merged `main` and refuses text that lacks the declared evidence.
   1. **Notice.** After 1 January the vigencia test names each artículo still declared for last
      year. Open SINALEVI's ficha for Ley 7092 (`idFichaNorma` 10969) and look for the new tramos
      decree's note in arts. 15, 33 and 34; for the FAQ, look for the new rate image on the CCSS
      page. An argument-less quarterly `pnpm recrawl` also stops at `ley-renta` once SINALEVI moves
      (§2.3).
   2. **Manifest PR.** Read the new figures against the decree. Set each moved artículo's
      `fiscalYear` and `evidence` to the new year (the decree note's «a partir del 01 de enero del
      2027»). For the FAQ, re-transcribe the new image first (#301, #407): its `imageTranscriptions`
      hash fails the crawl on new bytes. Then set its `fiscalYear` and `evidence` («ENERO 2027»).
      In the same PR, update the `eval/step-catalogue.json` sentences that quote the year's figures
      (the salarios mínimos line in T1-B and T1-F, the salario base in T1-I) to the new year's text
      and colones. They are search inputs only, and from 1 December `steps.test.ts` warns about
      each one. Merge.
   3. **Between the merge and the re-crawl,** production holds last year's text under this year's
      declaration, so those artículos are withheld, not served stale. Seven dataset rows target
      `ley-renta` arts. 15 and 33 (`renta-persona-fisica-deduccion`, `renta-tramos-2026`,
      `renta-salario-y-actividad`, `ho-minimo-renta-2026`, `ho-ademas-tengo-salario`,
      `rb-pill-impuesto-renta`, `rb-corto-tramos-renta`). From 1 January until the re-crawl of
      the database an eval run reads, they cannot reach those artículos: their reds there are not
      regressions.
   4. **Re-crawl** from the main checkout: `pnpm recrawl ley-renta ccss-faq` (just the moved ones).
      The chunks are served as soon as each document's rows are replaced. Commit
      `eval/corpus-index.json` if it changed.

   If SINALEVI keeps the old note beside the new one, both phrases are in the text: the re-crawl
   still ingests, and the declared year decides. A crawl in which one part of an artículo lacks the
   evidence fails; read that part before declaring it.

8. **Look for new year figures.** Still by hand, because the per-PR test reads the committed
   corpus index, which holds headings but not text: a re-crawl that adds a year's figure to an
   artículo nobody listed is invisible to it. On the shared local stack, after the re-crawl:

   ```sql
   select d.doc_key, c.articulo, c.part
   from chunks c join documents d on d.id = c.document_id
   where c.content ~ '(¢|₡) ?[0-9]' and c.content ~ '20[2-9][0-9]'
   order by 1, 2, 3;
   ```

   Every row should be an annual source, a listed `yearFigures` artículo, or one the ADR 0016
   second amendment records as not listed. Add anything else to `yearFigures` (and to the
   inventory test in `manifest-vigencia.test.ts`) in the same PR.

### 2.3 Quarterly re-crawl (owner-run, #405)

`.github/workflows/recrawl.yml` opens «Quarterly recrawl due YYYY-MM-01» on the 25th of
Dec/Mar/Jun/Sep and comments on it on the 1st if it is still open. The re-crawl itself cannot run
in Actions: GitHub-hosted runners time out on `www.ccss.sa.cr` and get a 400 from
`www.hacienda.go.cr`, the hosts behind six documents. From the main checkout, on `main`:

```
pnpm recrawl              # or: pnpm recrawl <doc_key…>
```

`scripts/recrawl.sh` refuses to start unless, after `git pull --ff-only`, the checkout is exactly
`origin/main` — nothing staged, modified or untracked — and runs `pnpm install --frozen-lockfile`
before it reads any secret. It then checks the routing front doors, runs the manifest vigencia
test, ingests into production with Voyage embeddings, and compares `eval/corpus-index.json` by
content: an unchanged corpus is restored, a changed one is formatted for the PR #163 requires. The
ingest runs under `env -i` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `VOYAGE_API_KEY`
parsed out of the deploy wizard's env file (never sourced), `INGEST_NO_DOTENV=1` so the dev
`.env.local` fills no gap, and otherwise only `PATH`, `HOME` and, if set, `TMPDIR` and
`PLAYWRIGHT_BROWSERS_PATH`: the file's other secrets never reach its child processes. Between
November and January, §2.2 comes first. Close the issue with one line: what ingested, whether the
corpus changed.

**A year-figure artículo moved (#518).** Once SINALEVI has consolidated a new tramos decree into
Ley 7092, an argument-less run stops at `ley-renta`, the second manifest entry, because its
artículos no longer carry the declared evidence (§2.2 step 7), and the documents after it are not
crawled. Until that manifest PR merges, re-crawl the rest by name:

```
pnpm recrawl $(node -p 'require("./corpus/manifest.json").documents.map((d) => d.doc_key).filter((k) => k !== "ley-renta").join(" ")')
```

The same holds for `ccss-faq` once the CCSS replaces its rate image: leave it out of the list too.

**A dated fact moved or vanished (#531).** A `datedFacts` artículo whose text no longer states its
last day, or whose heading is gone, stops the run at its document the same way: `ccss-faq`
today. Leave it out of the list above until the manifest PR of §2.4 merges.

**An overridden figure's text changed (#529).** An `overriddenFigures` artículo that fails with
«no longer carries» or «no chunk with that heading» stops the run at its document the same way:
`reglamento-renta` once Hacienda brings art. 23 in line with Ley 10392, or `ley-renta` if
SINALEVI rewrites art. 38. Read the new text as §2.5 says, and leave the document out of the list
above until that manifest PR merges.

**A pinned source changed.** Two checks stop the run instead of ingesting bytes nobody has read.
Documents ingested before the stop stay written and the corpus-index step does not run, so
finish with a complete re-run (ingestion is idempotent per document).

- A PDF whose bytes no longer match its manifest `source.sha256` fails its document; the error
  names the doc_key and both hashes. Read the new PDF. If it is still the audited instrument,
  ingest it once with `pnpm recrawl <doc_key> --accept-pdf-hash <doc_key>` — the run warns and
  continues, and the flag accepts only the doc_key it names (repeat it per document) — then commit
  the fetched hash to `corpus/manifest.json` in the PR for the re-crawl. If its figures changed,
  it is a §2.2-style source review first.
- A transcribed FAQ image (`imageTranscriptions`) has no such flag: its text is the chunk. New
  bytes, or an image the page no longer links, mean re-read it and update the manifest (#301).
  An entry with `fetchFrom` also fails when the page's own `src` answers again, since that URL may
  now serve a different image: re-read the image at `src`, update the transcription and hash, and
  drop `fetchFrom`.

---

### 2.4 Dated facts (#531)

A few chunks state a fact that ends on a day: a deadline, a transitional window. The manifest
lists them as `datedFacts`, each with its `lastDay` (Costa Rica time) and an `evidence` phrase
stating that day. `retrieve()` serves such a chunk through its last day, and only while its
text carries the evidence. From the next day it is withheld
([ADR 0016 third amendment](adr/0016-source-freshness-policy.md), which also records why the
other dated passages are not listed).

| Listed                                                    | Last day   | Look for an extension at                                                                                           |
| --------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `ccss-faq` · the Ley 10.232 condonación question (Cobros) | 2026-11-11 | the same question on [ccss.sa.cr/preguntas-frecuentes](https://www.ccss.sa.cr/preguntas-frecuentes), and CCSS news |

The vigencia test (`manifest-vigencia.test.ts`, also run by `pnpm recrawl`) warns, never fails,
from 7 days before each last day through 7 days after it.

1. **Before the day.** Check the publisher for an extension. If there is none, do nothing: the
   chunk leaves answers on its own.
2. **An extension.** Open a manifest PR that sets `lastDay` and `evidence` to the new day, as
   the new text states it. Merge, then `pnpm recrawl <doc_key>` from the main checkout. Between
   the two, the text and the declaration disagree and the chunk is withheld. A re-crawl that
   lands the new text before the PR merges fails with «no longer carry», and asks for the same
   PR.
3. **After the day.** Nothing, while the publisher keeps the old text up: the entry has to stay,
   or the chunk would be served again. Once a re-crawl fails with «no chunk with that heading»,
   the answer is gone. Delete its `datedFacts` entry and the line in the inventory test in
   `manifest-vigencia.test.ts`, then re-crawl.
4. **A new dated fact.** After each re-crawl, look for one on the shared local stack:

   ```sql
   select d.doc_key, c.articulo
   from chunks c join documents d on d.id = c.document_id
   where c.content ~* '(hasta|a más tardar|vence|plazo).{0,120}20[2-9][0-9]'
   order by 1, 2;
   ```

   A window that ends while the product is live, in a chunk that says nothing of what follows it
   and holds nothing else still current, joins `datedFacts`, the inventory test and the ADR's
   table in the same PR. The ADR records why the others stay.

### 2.5 Overridden figures (#529)

A few artículos still state a figure that a later law has replaced. The publisher keeps printing
the text, and only the figure has gone stale. The manifest lists the overridden words as
`overriddenFigures`, each with the law that overrode them (`overriddenBy`). `retrieve()`
withholds every chunk of the artículo that still carries those words, on any day, and serves
the artículo's other chunks
([ADR 0016 fourth amendment](adr/0016-source-freshness-policy.md)).

| Listed                           | Overridden words                                                             | By                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `reglamento-renta` · Artículo 23 | «¢106.000.000», «en un 100% / 75% / 50% de su impuesto determinado» (part 0) | `ley-renta` Artículo 15: its yearly decree (ceiling), Ley 10392 (reduction) |
| `ley-renta` · ARTICULO 38        | «setenta y dos mil colones (¢72.000)»                                        | the yearly tramos of `ley-renta` art. 33                                    |

Nothing warns on a clock: the figures are stale today and stay stale. A re-crawl is what can
change them.

1. **A re-crawl fails with «no longer carries».** The publisher changed the text. Read the
   artículo on SINALEVI. If it now agrees with the later law, delete its `overriddenFigures`
   entry and its line in the inventory test in `manifest-vigencia.test.ts`, then re-crawl. If it
   reworded the old figure, set `evidence` to the new words instead.
2. **A re-crawl fails with «no chunk with that heading».** The artículo was renamed or removed.
   A renamed heading would let the figure through unlisted: set `articulo` to the new heading,
   or retire the entry if the artículo is gone.
3. **A new overridden figure.** When a reform rewrites a law's figure, search the reglamento and
   the rest of the corpus for the old amount on the shared local stack:

   ```sql
   select d.doc_key, c.articulo, c.part
   from chunks c join documents d on d.id = c.document_id
   where c.content like '%¢106.000.000%'  -- the old amount, as the text writes it
   order by 1, 2, 3;
   ```

   An artículo that states the old figure as the rule joins `overriddenFigures`, the inventory
   test and the ADR's table in the same PR. The declaration deploys with the code: no re-ingest.

## 3. Alerts to create (#29 provisioning step)

Two alerts must reach the owner. Neither can be created from the repo — both are Vercel
dashboard configuration, and this section is the specification for it. The third signal,
§3.3, lives in the repo: a daily canary that asks production three questions and files an
issue when an answer fails. On Hobby it is the provider-failure coverage.

### 3.1 5xx rate — Vercel built-in Error Anomaly

Covers the `503` in §1.3 (a dead limiter, a missing secret) and any unhandled 5xx elsewhere
in the app.

1. Vercel dashboard → team **Settings → Alerts**.
2. **Add Rule**.
3. Triggers: **Error anomaly**. HTTP group: **5xx** (the default; leave 4xx off — our 4xx are
   refusals the route means to give: `429 rate_limited`, `403 cross_site_request`, and
   `400`/`413 invalid_question`, which the chat's composer no longer sends for length, so it is a
   hand-built request or text Postgres cannot store; a separate rule would only make noise).
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
§3.3's daily canary _is_ the coverage, and §4 says when the thresholds start meaning
anything.

**What to create**, when production moves to Pro:

1. Vercel dashboard → team **Settings → Drains** → add a drain.
2. Data type: **Logs**. Sources: runtime logs. Project: Tramitico. Environment: production.
3. Destination: either a **native integration** with threshold alerting, or a **custom HTTPS
   endpoint** the owner controls. This is the one open decision in this file and it is the
   owner's — it is the only thing here that adds a service.
4. At the destination, one alert rule:
   - **Condition:** `count(message contains "refunded_error" or "charged_error") ÷
count(message contains "tramitico.event") > 0.05`, evaluated over a rolling 30 minutes,
     with a floor of at least 20 asks in the window so a 1-in-3 morning does not page
     anyone.
   - **Also:** `count(message contains "ask: citation invariant violated")` more than triples
     its trailing 24-hour hourly average.
   - **Destination:** the owner, on a channel that interrupts — push or SMS, not email.

Drains are Pro/Enterprise only, billed by volume ($0.50/GB at the time of writing). One line
per ask at a couple hundred bytes makes this negligible at launch volume.

**Until the drain exists — the canary (§3.3).** It replaced the launch-day fallback, the
owner reading Q1/Q2/Q5 (§2.1) by hand twice a day, which this file always called a known
gap rather than coverage. The hand check still runs after every production deploy (§5).

### 3.3 The daily canary (#551) — provider-failure coverage on Hobby

`.github/workflows/canary.yml` runs `scripts/canary.ts` every day at 12:23 UTC (06:23 in
Costa Rica), and on demand. It asks `https://tramitico.com/api/ask` three fixed questions,
one at a time and signed out — the general IVA rate, the CCSS independent-worker quota and
Hacienda registration for foreign clients — and reads the stream the way the chat does. An
ask fails on any of:

| The log says                                               | What it usually is                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error part: answer_failed`                                | the `refunded_error`/`charged_error` of §1.1: `tramitico-prod`'s cap spent, a revoked or rotated key, a retired model (§7). Q2 (§2.1) names the `providerError` — read it inside the hour                                                                |
| `error part: retrieval_failed`                             | the search RPC failed: a paused or unreachable Supabase project (§7)                                                                                                                                                                                     |
| `HTTP 503: rate_limit_unavailable`                         | the limiter could not answer: the same paused project, or `RATE_LIMIT_SUBJECT_SECRET` gone (§1.3)                                                                                                                                                        |
| `degraded`                                                 | Voyage embeddings down (#127): answers still go out, labeled. Not a rollback trigger (§4)                                                                                                                                                                |
| `the rerank did not run (#498)`, `no data-reranked part`   | the stream's `data-reranked` part (#551, one boolean the chat ignores) said `false`: no Voyage rerank reading came back (outage, key) or `RERANK=off` in Vercel, so the answer set is the fused order. A missing part is a route that stopped writing it |
| `declined: …`, `no citations: …`                           | a fixed question that answers on main now declines — routed (weak retrieval) or fail-closed (#131, the model could not cite twice). A corpus or prompt regression; check what changed since the last green run                                           |
| `marker [n] resolves to no seal`, `unclosed marker [n`     | the citation contract broke on the wire (#133, #352): the reader sees an orphan superscript or a literal bracket                                                                                                                                         |
| `no percentage in an answer that asks for a rate`          | the IVA answer lost its figure                                                                                                                                                                                                                           |
| `request failed: …`, any other `HTTP …`, `not a stream: …` | the site itself: DNS, Vercel, a deploy that broke the route, or a bot challenge in front of it                                                                                                                                                           |

**The issue.** A failed run files one `needs-triage` issue titled «Production canary failed»
with the run's verdicts in it; while it stays open, later failures comment on it rather than
file another. Close it when production answers again; the next green run is the evidence.

**Cost.** Three asks a day is about US$1.50 a month of `tramitico-prod`'s US$10 cap — some
15% of it — plus a few Voyage calls. Each run also spends three of the runner IP's ten
anonymous asks (SPEC §7); runner IPs vary, so a stranger never inherits a spent quota from it.
A `429` in the log means the runner drew an IP that had already asked ten times that day.

**What it cannot see.** Three questions once a day: an outage that starts after 12:23 UTC
waits up to a day, the signed-in path (history, persistence) is not exercised, and a single
failed question is a bug report before it is an incident. §5 stays the check after a deploy.

**A quiet repo disables it.** GitHub turns off every scheduled workflow after 60 days
without a commit — this one, `keepalive.yml` and `recrawl.yml` together (§7, #553).

**Privacy.** The questions are fixed and about no one, so `/privacidad` stays true: they pass
through the subprocessors any anonymous ask does, and no other. The run log is public, as
the repo is; it prints question ids, counts, the failures and the opening of each failed
answer, which is text about official documents.

**By hand.** Production: `gh workflow run canary.yml`. A forced failure, which files (or
comments on) the issue: `gh workflow run canary.yml -f host=https://canary-forced-failure.invalid`
— close the issue afterwards. From a checkout, `pnpm canary` asks production and spends its
cap; `CANARY_HOST=http://localhost:3000 pnpm canary` asks a local `pnpm dev`.

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
the operative signal is §5 (the deploy check) and the daily canary in §3.3. The
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
   it, the daily canary (§3.3) takes over.

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

**A rolled-back app against a re-ingested corpus.** Ingestion (`pnpm ingest`, or the owner-run
`pnpm recrawl`) replaces a document's chunks wholesale, in one transaction per document
(`replace_chunks`, ADR 0002). Chunk identity is the document plus its label and part, not a stable row id, so
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
  a week later. Any commit re-enables them; so does **Actions → the workflow → Enable**.
  The mitigation lives outside GitHub (#553): a free **UptimeRobot** monitor polls
  `https://tramitico.com/api/health` every 5 minutes (keyword `"ok"`, or status 200) and
  emails on failure. The route makes the same read as `keepalive.yml` — one row of
  `documents` through the service-role client — so the monitor keeps the project awake
  however long the repo sits, and doubles as the uptime signal #551's daily canary is too
  coarse to give. It answers `{"status":"ok"}`, or a 503 `{"status":"unavailable"}` with
  the cause only in the log (`[health] unavailable — …`); an empty `documents` is still
  ok, since the database answered. UptimeRobot sees no question and no user data, so it
  is not a subprocessor and `/privacidad` does not name it. The owner creates the monitor
  after #553 merges; until it exists, push a trivial commit before two quiet months, or
  accept the pause and restore from the Supabase dashboard when the link is next needed.
- **It cannot un-pause.** A paused project is restored from the Supabase dashboard (a
  minute or two; the data is kept for 90 days on the free tier). The failure issue says so.

**Anthropic spend cap.** Anthropic spend is the one cost a stranger can drive: the daily
quota (SPEC §7, 10 per subject) bounds a subject, not a crowd. Production runs on its own
Anthropic **workspace, `tramitico-prod`, with its own key and a US$10 monthly limit** set
in the Console (Settings → Limits on the workspace). When the cap is hit every ask fails as
a `refunded_error` with `providerError` naming the 4xx (§1.2) until the month rolls over,
which is the intended behaviour: an empty page beats a bill. The eval lane and local
development use a **separate workspace and key**, so an authorized eval run (`eval.yml`,
≈US$8–12) can never be blocked by, or eat into, production's _cap_; it can eat into the
_balance_ that cap draws on, which the next paragraph covers. The pairing is recorded
beside `ANTHROPIC_API_KEY` in `.env.example`.

**The cap is not the balance (#552, owner check of 2026-10-09).** Workspaces separate limits
and keys, not money: the credit balance is **org-wide**, shared by `tramitico-prod` and the
eval workspace, so a paid wave can still drain the credit production answers on, below its
cap. There is no auto-reload and no monthly limit on the eval workspace (both declined);
Anthropic grants **US$200 of API credit a month**, which covers production's US$10 plus a
development wave's evals. The rule instead: **every paid wave's pre-launch balance check
must show its hard stop plus ~US$15**, so production keeps a margin. Evals run only in
development waves, with the owner's OK; nothing runs them on a schedule.

**What is not capped.** Voyage AI (embeddings and rerank) has no per-workspace spend limit
that this runbook knows of; the same stranger can drive it, up to seven embedding calls per ask (the question, its
expansion and each step sentence; the sentences are fixed, so the query cache usually serves them).
Its free allowance is large and the per-subject quota still applies, so it is accepted,
not solved. If Voyage starts billing, the knob is `RERANK=off`: up to seven calls fewer per
ask — the question's reading, its expansion's (#296) and one per step sentence of the family
it classified to (#304, at most five today) — and, in the extreme, `EMBEDDINGS_PROVIDER=stub`, which the app labels as `degraded` and
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

**Email templates (#350).** What production mails is `supabase/templates/magic_link.html`,
declared twice in `supabase/config.toml` (`magic_link`, and `confirmation` so a re-enabled
signup confirmation never falls back to Supabase's default, whose link bypasses
`/auth/confirm`). The hosted project gets it from the repo, not the dashboard:

```sh
# SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN, parsed out of .env.prod by recrawl.sh's
# env_file_value (sourcing recrawl.sh in bash only defines its functions). The file is
# never sourced, so its other secrets stay out of pnpm's environment.
email_push() {
  bash -c 'source scripts/recrawl.sh
    SUPABASE_PROJECT_REF=$(env_file_value .env.prod SUPABASE_PROJECT_REF) \
    SUPABASE_ACCESS_TOKEN=$(env_file_value .env.prod SUPABASE_ACCESS_TOKEN) \
    pnpm email:push "$@"' email_push "$@"
}
email_push --check    # read-only: does production send git's copy?
email_push            # PATCH the mailer_subjects_* / mailer_templates_* keys
pnpm email:preview    # no keys: render with sample values to .email-preview/ (--text for the stripped read)
```

The script sends _only_ those keys through the Management API's auth-config endpoint —
it is the sanctioned counterpart of the `supabase config push` ban above, which would
upload the whole `[auth]` section, localhost `site_url` included. The token is a scoped
access token from the Supabase account page — resource access _Project_ → the production
project only; permissions _Auth Config_ read-write **and** the project admin capability
read-write — the Management API checks `auth_config_write` and `project_admin_write` together
on `PATCH /config/auth`, so Auth Config alone reads but gets a 403 on write; everything else
None; not a legacy full-account token. The deploy wizard's stage 9 captures
it into `.env.prod` and runs the push. Even scoped it can rewrite production's auth
settings, so it goes nowhere else: not Vercel, not a GitHub secret. Editing a template in the dashboard is the drift
`--check` exists to catch; edit the file, push, and the diff is in git. Supabase Auth
sends a single `text/html` part, so there is no plain-text alternative to keep in step:
the file reads in order when tags are stripped, and `--text` shows that read.
