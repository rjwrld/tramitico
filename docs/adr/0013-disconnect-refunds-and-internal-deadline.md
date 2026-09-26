# ADR 0013 — Every abort refunds, and the pipeline expires before the platform can kill it

Date: 2026-08-28 · Status: accepted, amended 2026-09-25 (see
[Amendment](#amendment-2026-09-25--the-quota-bounds-paid-work-not-only-delivered-answers)) · Amends
[ADR 0011](0011-runtime-citation-invariant.md) ·
Context: issue [#205](https://github.com/rjwrld/tramitico/issues/205), decisions from
[#126](https://github.com/rjwrld/tramitico/issues/126)

## Context

ADR 0011 named the abort branch and reasoned about it as a choice: "a reader who pressed stop"
returns without writing, refunding or persisting — a deliberate stop, nothing owed. That reasoning
assumed the signal meant Detener. It does not: `request.signal` fires identically on a WiFi
handoff, a locked phone, or a proxy killing an idle connection — and ADR 0011's own buffering made
the connection _maximally_ idle, sitting silent through the whole `redactando` phase, which is
exactly the window a passive drop is likeliest to land in. A reader whose network blinked lost
both the answer and a quota slot, with no way for the server to tell them apart from someone who
chose to stop.

Two more holes shared the shape "a spent slot that is neither answered nor refunded":

- `streamText` ran under the client's signal only, with no clock of its own. A slow
  citation-retry run (#131 allows two paid attempts) could sail past `maxDuration = 60`, and the
  platform's kill is silent — no `finally`, no refund, no telemetry line. The ask just vanished,
  spent.
- Refunds settled in the stream's `onFinish`, which a disconnect can fire early via the stream's
  `cancel()` — _before_ the failure path still running has marked its debt. The refund was
  silently dropped by an ordering accident.

## Decision

**Every client abort refunds, and persists nothing.** The server cannot distinguish Detener from
a network drop, so both are treated as the reader receiving no value: the slot comes back, no
history row is written, no error part is sent (there is nobody to read it). ADR 0011's
"abort = deliberate stop, nothing owed" reading is replaced. The free-ask worry that shaped #126's
boundary does not apply: aborting an ask costs the reader the answer, so it is not a lever for
free asks the way a refundable decline would be.

**The pipeline carries its own deadline** (`startAskDeadline`, ~50 s, `deadline.ts`), cumulative
across condensation, retrieval, rerank and both generation attempts — because `maxDuration` is.
Generation runs under `AbortSignal.any([request.signal, deadline.signal])`; the earlier phases
keep their own tighter budgets (the condense timeout, the embed timeout) and are checked against
the deadline at every await boundary, so a budget spent before generation still exits through the
same door. An expired deadline is a _system failure_: Spanish error part (the reader is still
connected and waiting), refund, `refunded_error` telemetry — all inside the route, provably
before the platform's silent kill at 60 s.

**Refunds settle in `execute`'s own `finally`,** not in `onFinish`. The stream machinery awaits
`execute` to completion even after a client cancel, so the `finally` is the one block every path
funnels through. `onFinish` stays as a once-only backstop (it also catches a debt the SDK-level
`onError` marks after the `finally` has run). The refund handle itself was already once-only;
the route additionally guards so two settlements pay at most once.

**The telemetry event gains `abort: "client" | "deadline" | null`** — a closed enum, content-free
per #141's rules. A client abort stays `outcome: "declined"` (nothing was delivered, nothing
broke); a deadline expiry is `refunded_error`. First reason wins when both signals fire.

**One clock read per request** for the rate limit: the anonymous subject and the quota window both
derive from the same `new Date()`, so an ask straddling CR midnight cannot key its subject to one
day and its window to the next.

## Consequences

- **The invariant #205 asked for holds:** no path leaves a spent slot that is neither
  answered-and-delivered nor refunded. The one remaining gap is a platform kill inside the final
  ~10 s margin, which the deadline exists to make unreachable in practice.
- **A stopped ask is free.** Detener now refunds where it used to consume. The cost is bounded:
  the reader still paid the wait and got nothing, and the paid provider call is cancelled at the
  same moment, so an abort is strictly cheaper for us than a delivered answer.
- **Aborts are observable.** `"abort":"client"` rates in the log drain now separate "readers keep
  leaving mid-ask" (a latency smell) from genuine declines; `"abort":"deadline"` firing at all is
  a runbook-worthy signal that generation is running against the platform ceiling.
- **ADR 0011's abort branch is superseded**; everything else in it — buffering, the invariant, the
  fail-closed decline consuming the ask — stands.

## Amendment (2026-09-25) — the quota bounds paid work, not only delivered answers

**The rule "every abort refunds" is narrowed: an interrupted ask keeps its quota charge once
paid provider work has begun on it.** The daily quota is the one control on what a caller can
make us spend (the runbook's spend-cap section: it bounds a subject, not a crowd), and the
decision above let it bound only _delivered answers_. By the time `retrieve()` returns, an ask
has already paid for a query expansion and the Voyage embeds inside it; the rerank is another
Voyage call; generation is up to `MAX_ANSWER_ATTEMPTS` (two) runs of up to
`ANSWER_MAX_OUTPUT_TOKENS` (4096) each. Refunding all of that on an abort, or on a deadline
that two long generations reach by themselves, meant a caller could set that spend off again and
again without the quota ever moving. The consequence above — "an abort is strictly cheaper for
us than a delivered answer" — is true of one ask and says nothing about how many.

The boundary, door by door:

- **Client abort** (`clientGone`): refunds only if it lands **before `retrieve()` is called**.
  The route now checks both signals between condensation and retrieval, so an abort there exits
  without starting the search, and gives the slot back. From `retrieve()` on, an abort consumes
  the ask: nothing is written and nothing persisted, exactly as before, but the slot stays spent.
  Detener and a network drop are still one event on the server, so they still get one rule.
- **Internal deadline** (`deadlineHit`): refunds only while **no answer generation has
  started**. Once the first `generateAnswer`/`streamText` call has been made, an expiry consumes
  the ask. The reader still gets the `answer_failed` error part with the contract's Spanish, and
  the event still carries `"abort":"deadline"`. A deadline spent before generation — by retrieval
  or rerank — still refunds.
- **`retrieval_failed`**: refunds an **outage**, and consumes a failure the **request's own text
  produced**. "Caller-shaped" is read off the one field that is safe to read: `retrieve` wraps a
  rejected `search_chunks` call in `SearchChunksError`, whose `cause` carries the PostgREST
  error's SQLSTATE in `code` (the token `describeError` already logs as
  `SearchChunksError<Object#22P05>`). A SQLSTATE in **class 22** (data exception — 22P05, 22021)
  or **class 54** (program limit exceeded — a tsvector or tsquery built from the question
  outgrowing its limits) is caller-shaped. Everything else refunds: a fetch that never reached
  the database (an empty code), a gateway error (no code), a statement timeout (57014), a missing
  grant (42501), an RPC signature the deployment cannot find (`PGRST202`), and any throw that is
  not a `SearchChunksError` at all. #429's admission check turns away the known characters
  Postgres cannot store before the quota is touched; this is the second line behind it.
- **`answer_failed` from a provider or pipeline error** is unchanged: it refunds whenever it
  lands. That failure is ours, and a caller cannot produce it by shaping a question.

`REFUNDS_ASK` stays exhaustive over `AskErrorCode`, but each entry is now a function of the
failure — `{ kind: "error", error }` or `{ kind: "deadline", generationBegun }` — rather than a
boolean, because two codes decide per failure. A client abort still has no code; its rule sits
in `clientGone`. Settlement is unchanged: once-only, in `execute`'s `finally` with `onFinish` as
the backstop.

One mechanism the old rule had been hiding: the AI SDK hands **every** `error` part the route
writes back to `createUIMessageStream`'s `onError` as it streams past, and that handler marked a
refund unconditionally. While every error part refunded, the echo was a harmless second door onto
the same debt; under this rule it would have refunded the error parts that are meant to consume.
Each door that writes an error part now records that it has decided (`QuotaDebt.decided`), and
`onError` fails only what no door has.

**Telemetry stays truthful.** A consumed failure must not report `refunded_error`, and it is not
`declined` either — the reader saw an error. The event's `outcome` gains **`charged_error`**: an
error part went out and the ask kept its charge (the deadline after generation began, or a
caller-shaped `retrieval_failed`). The route decides it at settlement, from what the quota
actually did, so the two can never disagree. The runbook's error rate counts both
`refunded_error` and `charged_error`. A consumed client abort stays `declined` with
`"abort":"client"`: nothing broke. No new field, and nothing content-bearing: `/privacidad`'s
description of the operational log is unchanged.

**Accepted residuals:**

- **Condensation runs before the line.** On a follow-up, `condenseQuestion` — a model call —
  runs before `retrieve()`, so an abort during `buscando` that lands before retrieval still
  refunds, although the condensation was paid for. It is the cheapest call in the pipeline
  (a capped output, its own short timeout, and only on follow-ups), and moving the line in front
  of it would charge a reader who pressed Detener before any search began.
- **A deadline before generation still refunds** even when retrieval and rerank have run. Those
  budgets are ours (the embed and condense timeouts exist to keep them short), and a caller
  cannot stretch them by shaping a question the way they can stretch a generation.
- **A reader whose network drops after retrieval loses the slot** with nothing received. The
  server cannot tell that from Detener, and giving it back is exactly the refund this amendment
  removes.
- **A class-22 error that is not the question's doing** — a malformed embedding or expansion
  reaching the RPC — would also read as caller-shaped and consume. Neither provider has returned
  one; if one ever does, `providerError` names the SQLSTATE on the `charged_error` line.

The #205 invariant becomes: no path leaves a spent slot that is neither answered-and-delivered,
refunded, nor charged for paid work that ran on it. The Decision's "every client abort refunds",
its deadline refund past the first generation, and the consequence "a stopped ask is free" are
superseded; the internal deadline itself, settlement in `finally`, one clock read, and the
`abort` field all stand.
