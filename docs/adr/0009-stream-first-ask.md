# ADR 0009 — Stream-first /api/ask: stages as data parts, failures inside the 200

Date: 2026-08-10 · Status: accepted · Extends
[ADR 0004](0004-citation-rendering.md) ·
Context: issue [#71](https://github.com/rjwrld/tramitico/issues/71)

## Context

`POST /api/ask` ran embed → `search_chunks` → rerank before `createUIMessageStream` existed, so
the client received no bytes until the whole retrieval pipeline finished. The audit found those
pre-stream stages dominate perceived TTFB, and that the retrieval→generation gap carried no
signal at all — the "Consultando los documentos oficiales…" line was a client-side guess keyed on
`status === "submitted"`.

Moving retrieval inside `execute` fixes the TTFB, but it forces a second question. Once the
response is a 200, a failure has no status code left to travel on, and ADR 0004 pinned exactly one
failure channel: a non-OK body `{ error, message }` with user-facing Spanish.

## Decision

**The stream opens as soon as validation and the rate limit pass.** Those two are the only checks
whose verdict the caller cannot be shown mid-stream — a 400 must reject the request and a 429/503
must deny it — so they stay pre-stream HTTP JSON errors, unchanged. Retrieval and rerank run
inside `execute`.

**Progress travels as `data-status` parts** carrying a stage from a union declared in
`contract.ts`: `buscando` (retrieval + rerank) → `redactando` (the model). Stable part id,
cumulative snapshots, non-transient — the same bargain ADR 0004 struck for `data-citations`, and
for the same reason: the UI renders the latest snapshot, so a re-emitted or reordered part can
never stack two stages. The SDK's `transient: true` is deliberately _not_ used; it drops the part
from `message.parts`, which would make the stable id meaningless and leave the consumer UI nothing
to read off the message.

**Failures past the 200 reuse ADR 0004's envelope, re-homed.** They arrive as a stream `error`
part whose `errorText` is the same `{ error, message }` JSON, built by `askStreamErrorText`. So
`askErrorMessage` — the one function that recovers our Spanish from whatever the transport
throws — covers both channels unchanged. Raw prose in `errorText` was rejected: it is
indistinguishable from a leaked provider message, and would fall through to the generic line.

`onError` is wired in two places, because a model failure has two doors: `toUIMessageStream` maps
error parts on the model's stream, `createUIMessageStream` catches throws in `execute` and
stream-stopping errors. Both point at one mapper, so neither can leak the SDK's English default
(audit F-22).

## Consequences

- ADR 0004's "non-OK responses carry a JSON body" now describes only the pre-stream half. The
  envelope is unchanged; where it rides is not.
- Retrieval failure is no longer a 502. Anything asserting that status — a monitor, a client
  branch — reads a 200 with an error part instead.
- The weak-retrieval path persists inside `execute` rather than in the stream's `onFinish`, so its
  `saveQuestion` call is explicitly try/caught: `persist.ts` promises failures are logged and never
  surfaced, and inside `execute` a rejection would otherwise stamp a Spanish failure under an
  answer the user already has.
- Perceived UX depends on a consumer shipping the status UI. Between this change and that one, the
  client's `submitted`-keyed line disappears almost immediately (first byte now arrives in
  milliseconds) with nothing yet rendering `data-status` in its place.
