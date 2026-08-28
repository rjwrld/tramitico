# Runbook — Tramitico in production

What to watch, what it means, and when to roll back.

**Scope.** This file starts with #141: the operational signal the app emits, the alerts
that have to be created in Vercel around it, and the rollback threshold. The deploy issue
(#29) extends it with the things only a real deployment can pin down — project and
environment wiring, the production Supabase, DNS, the rollback _procedure_ itself. Sections
marked **#29** are placeholders with the decision already made and only the mechanics
missing.

**Authority.** The owner (RJ) decides rollback. No automation rolls anything back.

---

## 1. What the app emits

Four log signals, all content-free by construction. None of them may ever carry a question,
an answer, a user id, an IP, or an anonymous subject hash — see `src/lib/log-redaction.ts`
and `/privacidad`. If a change adds a field here, it changes a privacy claim.

### 1.1 The per-ask event (#141)

One line per request to `/api/ask`, whatever the request did, written from
`src/lib/telemetry.ts`:

```
tramitico.event {"event":"ask","outcome":"ok","latency":"1s_3s","providerError":null,"citationFailure":false,"quotaHit":false,"abort":null}
```

| Field             | Values                                                 | Means                                                                                                                                                               |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outcome`         | `ok`                                                   | an answer was delivered                                                                                                                                             |
|                   | `declined`                                             | no answer, nothing broke: honest decline, bad request, spent quota, or a client abort (refunded since #205, but still not our failure — see `abort`)                |
|                   | `degraded`                                             | delivered without the vector leg — the embedding provider was down (#127)                                                                                           |
|                   | `refunded_error`                                       | **our side broke**; the ask was refunded or never charged                                                                                                           |
| `latency`         | `lt_1s` `1s_3s` `3s_10s` `10s_30s` `gte_30s`           | whole request, auth and rate limit included                                                                                                                         |
| `providerError`   | a `describeError` token (`APICallError#429`) or `null` | error _class_, never an error message                                                                                                                               |
| `citationFailure` | `true` / `false`                                       | the citation invariant rejected at least one generation this ask (#131)                                                                                             |
| `quotaHit`        | `true` / `false`                                       | denied because the caller's daily quota was spent (#126)                                                                                                            |
| `abort`           | `client` / `deadline` / `null`                         | cut short: the client's signal (Detener or a network drop — refunded, #205), or the route's own ~50 s deadline expiring before the platform kill (a system failure) |

The prefix `tramitico.event` is a contract. It is a constant in `telemetry.ts`, it is
quoted in every query below, and renaming it silently breaks all of them.

`outcome` is one class per ask, by precedence: `refunded_error` > `degraded` > `ok` >
`declined`. So `degraded` counts a degraded ask that then declined, and `declined` is the
default for an ask that delivered nothing at all.

### 1.2 The three detail lines

The event says _that_ something happened; these say _what_. The first three predate #141 and
keep their prefixes; the fourth is #132's, added under the same rule — a detail line, not a
new field on the event, whose shape is a privacy claim.

A rising `ask: condensation failed` count is a **degradation, not an outage**: every one of
those asks was answered, on the reader's literal question instead of a standalone rewrite, so
follow-ups retrieve worse while first turns are untouched (they never condense at all).
`reason=unusable` is the one to read closely — the provider answered and we rejected what it
said, which points at the prompt or the model rather than at availability.

| Prefix                                | From                                | Carries                                     |
| ------------------------------------- | ----------------------------------- | ------------------------------------------- |
| `ask: citation invariant violated`    | `src/lib/answer/invariant.ts`       | `violation=`, `attempt=`, `unresolved=`     |
| `retrieval: degraded to lexical-only` | `src/lib/retrieval-degraded.ts`     | `reason=timeout\|error`, `error=`           |
| `ask: history save failed`            | `src/lib/answer/persist-failure.ts` | `kind=answer\|decline`, `error=`            |
| `ask: condensation failed`            | `src/lib/answer/condense.ts`        | `reason=timeout\|error\|unusable`, `error=` |

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

This is exactly why §1.1 exists, and why the provider-failure alert in §3.2 cannot be one of
Vercel's built-in ones.

---

## 2. Reading the signal

**Where.** Vercel dashboard → project → **Logs** (sidebar). Filter `Route` to `/api/ask` and
`Environment` to `production`. The main search box does a substring match on the log message;
the sidebar filters do everything else.

**Retention is a prerequisite, not a detail.** Runtime-log retention is 1 hour on Hobby, 1
day on Pro, 30 days on Pro + Observability Plus. The rollback threshold below is a
**30-minute** window, which a 1-hour retention leaves no room to investigate inside. **#29
should deploy on Pro at minimum.**

### 2.1 Queries

Each is a search-box string plus the sidebar filters already applied. Counts come from the
result count over the selected timeline.

| #   | Question                             | Search box                                                                          |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Q1  | How many asks? (the denominator)     | `tramitico.event`                                                                   |
| Q2  | How many broke on our side?          | `refunded_error`                                                                    |
| Q3  | Which provider is failing?           | `"providerError":"` — read the tokens off the matching lines                        |
| Q4  | How many ran on lexical-only search? | `"outcome":"degraded"`                                                              |
| Q5  | Citation-invariant violations        | `ask: citation invariant violated`                                                  |
| Q6  | Asks touched by a citation failure   | `"citationFailure":true`                                                            |
| Q7  | Lost history rows                    | `ask: history save failed`                                                          |
| Q8  | Quota denials                        | `"quotaHit":true`                                                                   |
| Q9  | Slow asks                            | `"latency":"gte_30s"`                                                               |
| Q10 | Asks cut short by the reader/network | `"abort":"client"`                                                                  |
| Q11 | Asks the internal deadline killed    | `"abort":"deadline"` — any at all means generation is running against `maxDuration` |

**Error rate = Q2 ÷ Q1** over the same timeline. That is the number §4 is written against.
Note what is deliberately _not_ in the numerator: `declined` (including the honest decline
and a spent quota) is the product working, and `degraded` is a delivered answer.

`refunded_error` and the three prefixes in §1.2 are unique strings in this codebase, so those
queries need no quoting. Q3, Q4, Q6, Q8 and Q9 match on JSON fragments; if the search box
ever mangles the punctuation, fall back to the bare token (`degraded`, `gte_30s`) plus
`tramitico.event`.

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

**What to create**, at #29 time:

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

**Authority: the owner.** Not a threshold that auto-reverts, not a decision delegated to an
agent. The thresholds above say _when to look_; the owner says whether to roll back.

**Procedure: #29.** Vercel keeps previous deployments and promoting one is the rollback, but
the exact steps, the Supabase-migration question (a rolled-back app against a migrated
database is the case that actually needs writing down), and the corpus-version question all
belong to the deploy issue. #29 fills this in.

---

## 5. First 30 minutes after a deploy (#29)

Placeholder, to be filled in with #29 once there is a real deployment to check against. The
shape: verify the deploy is serving, run Q1 and Q2, confirm a real ask returns a cited
answer, then re-check at +60 min against §4.
