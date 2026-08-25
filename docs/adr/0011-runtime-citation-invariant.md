# ADR 0011 — The answer is buffered and checked before any of it is written

Date: 2026-08-25 · Status: accepted · Amends
[ADR 0009](0009-stream-first-ask.md) ·
Context: issue [#131](https://github.com/rjwrld/tramitico/issues/131), decision on
[#121](https://github.com/rjwrld/tramitico/issues/121)

## Context

Citations were prompt-led and nothing more. `ANSWER_SYSTEM_PROMPT` rule 2 asks the model to put a
`[n]` after every claim, and whether it obliged was discovered — if at all — weekly, by the eval
lane. Two answers could reach a reader in production without anyone noticing:

- one with no marker anywhere, which is a confident paragraph about tax law with nothing under it;
- one citing a `[9]` when eight chunks were retrieved, which is worse, because the render path
  _tidies it away_. `renumberCitationMarkers` deletes a marker no seal backs, so a hallucinated
  source silently becomes a bare uncited claim rather than a visible defect.

For a product whose entire proposition is "cited to official documents", both are the failure that
matters most.

The check itself is cheap — presence and resolvability of markers, no judge model. What it costs
is the streaming. An answer can only be checked for "cites at least one retrieved source, and
nothing else" once it is whole, and a marker missing from a paragraph is only missing at the end.
A check that runs after the text has been streamed to the browser enforces nothing: the answer has
already been read.

## Decision

**Generation is buffered.** `generateAnswer` drains the provider's deltas into a string. Nothing is
written to the wire from inside it.

**`validateCitations` is the gate.** At least one marker in `[1, chunkCount]`, and no marker
outside it. Narrow on purpose: whether the cited chunk actually _supports_ the claim needs a judge
model, which the request path cannot afford, and stays where it already lives — the groundedness
gate in the eval lane.

**One retry, then fail closed.** A violation is counted and the answer is regenerated once, with
`CITATION_RETRY_NOTE` appended to the user prompt — a bare re-roll mostly reproduces the same
omission. A second violation gets the reader the same honest decline weak retrieval gives. Not
"until it works": a model that cannot cite twice running is not going to on the third try, and
each attempt is paid tokens against a 60-second budget.

**The decline is a delivered answer.** It consumes the ask and is persisted, exactly as the
weak-retrieval decline does — #126's boundary, unchanged. Refunding here would hand a free ask
back every time a model misbehaves, which is a hole whose shape we do not control.

**The weak-retrieval decline is exempt**, structurally rather than by a flag: the invariant runs on
model output, and that path never calls a model.

**Failures are counted twice.** There is no metrics pipeline in this repo yet — the observability
issue owns that — so `invariant.ts` keeps an in-process tally the tests read, and logs each
violation on a fixed prefix (`ask: citation invariant violated — violation=… attempt=… `) that a
platform log drain can count today. The log line, not the tally, is the durable signal; the tally
is per instance and dies with it.

## Consequences

- **ADR 0009's stream-first bargain now covers the pipeline, not the prose.** The 200 still opens
  before retrieval, `buscando`/`redactando` still report progress, failures still ride the error
  envelope. What changed is that `redactando` now lasts the whole generation instead of yielding to
  text partway through. Perceived TTFB is unchanged; time-to-first-_word_ is now time-to-last-word.
- **DESIGN §8's "native token flow" is a wire shape, not a live one.** `writeAnswer` still emits one
  word per event, so #73's client contract and its test hold, but the words arrive together. The
  20 ms `smoothStream` pacing came off the model call: its job was to spend the provider's bursts on
  the way to a reader, and there is no reader on the other side of it any more — all it could do is
  delay our own buffer.
- **A partial answer is now no answer.** A provider dying mid-generation used to leave whatever had
  arrived on screen under a Spanish error ("a partial answer beats a blank", #71). A truncated
  answer is precisely one whose citations were never checked, so it is exactly what this ADR keeps
  off the wire; the error part is the whole response.
- **Abort is a named branch.** It used to be a consequence of `streamText`'s `onFinish` never firing.
  Buffered, a client stop arrives either as a rejection or as a provider stream that simply ends, so
  the loop checks `request.signal.aborted` on both exits and returns without writing, refunding or
  persisting.
- **Sellos stamp once, not as they apply.** ADR 0004's cumulative-snapshot rule is unchanged and the
  client is unaffected — one snapshot is a valid snapshot — but in practice there is now exactly one.
- **A well-behaved model pays nothing.** The retry only fires on a violation; the common path is one
  generation, as before.
