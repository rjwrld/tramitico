# ADR 0012 — Multi-turn is one condensed question, not a conversational pipeline

Date: 2026-08-25 · Status: accepted · Amends [SPEC §5, §6](../../SPEC.md) ·
Context: issue [#132](https://github.com/rjwrld/tramitico/issues/132), decision on
[#121](https://github.com/rjwrld/tramitico/issues/121)

## Context

The UI has implied a conversation since #22 — a thread, a composer under it, prior turns on
screen — while the API took exactly one question at a time. `prepareSendMessagesRequest` sent
the newest user message and nothing else, so a follow-up arrived with its antecedent stripped
off:

> — ¿Cuánto pago a la CCSS como trabajador independiente?
> — …
> — ¿Y si también soy asalariado?

That last question retrieves against no document in the corpus. Not badly: at all. There is no
noun in it that any artículo of the Ley 10.363 or the CCSS escalas contains, so the fused search
returns whatever the lexical fallback scrapes up, corroboration fails, and the reader gets the
honest decline — for a question the product could have answered, in a thread where the answer
was two lines above. The UI promised a conversation and the pipeline delivered twenty
independent asks.

SPEC §5 describes assembling an answer from _the_ question; §6's route table takes a question
and returns an answer. Neither says "single-turn" out loud, because at the time nothing else
was contemplated. Multi-turn is a deviation from that framing and gets recorded here rather
than drifting in silently (SPEC §12.3).

The obvious alternative — send the whole conversation to the answer model and let it work
things out — is the one this codebase can least afford. Every guardrail we have assumes one
question and one retrieval set: `ANSWER_SYSTEM_PROMPT` rule 1 constrains the answer to the
documents provided _for this question_; the citation invariant (#131, ADR 0011) checks markers
against `chunks.length` of one retrieval; the groundedness judge asks "is this answer supported
by these chunks" of one pair. A conversational prompt would let turn three's answer lean on
turn one's chunks, which no runtime check in this repo can see and no eval case would catch.

## Decision

**One small model call condenses; the pipeline is untouched.** When a request carries history,
`condenseQuestion` (`src/lib/answer/condense.ts`) rewrites the follow-up plus the recent turns
into one standalone Spanish question, and _that string_ enters the existing pipeline exactly
where the raw question used to. Retrieval, rerank, `buildUserPrompt`, `validateCitations`, the
groundedness gate: unchanged, and still reasoning about exactly one question. Multi-turn is a
transformation in front of the pipeline, not a property of it.

**A first turn costs nothing.** No history means no call — no latency, no tokens, no new failure
surface. Single-question behavior is byte-for-byte what it was, which is what makes this
shippable in launch scope at all.

**Failure falls back to the raw question, always.** A provider outage, the 4-second timeout, an
empty or oversized rewrite: every one of them returns the literal question and the ask proceeds.
`condenseQuestion` has no throwing path. The reasoning is a comparison of outcomes — a fallback
gives a follow-up the retrieval it got last week, while a propagated failure takes away an ask
that would otherwise have worked. Degrading to yesterday's behavior is not an incident.

**The window is fixed at three turns, both halves clamped.** `boundTurns` (contract.ts) keeps the
last `MAX_HISTORY_TURNS` exchanges, the question half to 1 000 characters and the answer half to 600. The antecedent a follow-up needs is nearly always one turn back; everything beyond that is
tokens paid on every ask of every session. A fixed count is what makes the thirtieth follow-up
cost what the second one does. The same function runs on the server against whatever arrived,
because a bound the client keeps is not a bound.

**The model is its own seam.** `getCondenseModel()` mirrors `getAnswerModel()` — Haiku by
default, `CONDENSE_MODEL` to override — rather than reusing the answer model. Condensation has
no corpus, no citations and no judgement in it, and it runs in front of every follow-up; tying
it to `ANSWER_MODEL` would make the Sonnet-vs-Haiku answer comparison silently change the cost
of multi-turn too. It is also the seam every test stubs, exactly as route tests stub the
answer model.

**History stores the reader's words, with the rewrite beside them.** The new
`questions.condensed_question` column is NULL whenever the pipeline ran on the literal question
— a first turn, or a fallback. What the reader sees in their history is always what they typed;
what an operator needs to explain a bad answer to a follow-up is the question it was really
retrieved against, and now both exist.

**Observability is a detail line, not a new telemetry field.** `ask: condensation failed —
reason=… error=…` on a stable prefix, plus an in-process tally, following
`retrieval-degraded.ts`. The per-ask event's vocabulary is closed and is a privacy claim
(runbook §1); prior turns are question text and never reach a log at all.

## Consequences

- **SPEC §5 and §6 are amended, not overturned.** "The question" the pipeline assembles an
  answer from is now "the standalone question", which on most asks is still what the reader
  typed. §6's request body grows an optional `history`.
- **A follow-up costs one extra small-model call and up to ~4 s of latency before "buscando"
  ends.** Bounded by construction, and paid only by follow-ups.
- **A bad rewrite is a new failure mode, and a quiet one.** Condensation can drop a qualifier or
  widen a question, and the reader sees only a slightly-off answer to a question they did not
  ask. The citation invariant does not catch it (the answer still cites real chunks) and neither
  does the groundedness judge (it judges the condensed question). The eval's condensation cases
  are the only thing that would, which is why they exist — and why the hit-rate table prints the
  rewrite next to every case that carries one.
- **The client sends prior answers to the provider that wrote them.** No new subprocessor, but
  what Anthropic receives changed, so `/privacidad` says so in the same change.
- **Anonymous callers get multi-turn too.** History travels in the request body, not from the
  database, so nothing here depends on being signed in — the thread on screen is the whole
  state.
- **A hand-rolled POST cannot buy a bigger prompt.** The server re-bounds the window it was
  sent, so the condensation budget is ours regardless of what the client claims.
- **The eval lane now needs an Anthropic key for the hit-rate suite.** It always had one for
  groundedness; the retrieval suite needs it because three of its cases are follow-ups that must
  be condensed before they can be retrieved.
