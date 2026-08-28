# ADR 0013 — Every abort refunds, and the pipeline expires before the platform can kill it

Date: 2026-08-28 · Status: accepted · Amends
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
