# ADR 0020 — The step the reader did not ask for: a hand-written catalogue per family, searched sentence by sentence and pinned past the cut

Date: 2026-09-07 · Status: accepted · Amends [SPEC §5](../../SPEC.md) ·
Context: issue [#304](https://github.com/rjwrld/tramitico/issues/304), follow-up of
[#303](https://github.com/rjwrld/tramitico/issues/303) and
[#286](https://github.com/rjwrld/tramitico/issues/286) ([ADR 0019](0019-query-expansion-legs.md))

## Context

#303 read the nineteen Tier 1 "answer omission" rows of the 2026 baseline through the
production path and located every missing requirement in the reranked order. Of the 23 that
were retrieval, 20 were **pool depth** — the chunk carrying the requirement was deep in the 40
or absent from it — and only 3 were the cut between #8 and #12. The absent chunks share a
shape: they carry a _step_ the dataset requires of a complete answer and the question never
asks for. «¿Dónde me afilio?» requires when to pay; «¿me puedo desinscribir si debo
declaraciones?» requires the sanction; «¿qué porcentaje me cobra la Caja?» requires how to
adjust the declared income. Nothing in the question points at them, so neither its own legs
nor its corpus-register expansion find them — and #303 measured that the expansion model
cannot be asked to guess them: a "next step" probe written by Haiku either rewrote the
question again or copied the prompt's worked example.

The steps are not open-ended. The dataset's nine Tier 1 families name them, and a family's
steps are the same whichever of its questions is asked.

## Decision

**The steps are written by hand, per family, and searched as one more leg pair — sentence by
sentence — and the reranker's best chunk per sentence is pinned past the cut.**

1. `eval/step-catalogue.json` carries, per family, two or three sentences in the corpus's own
   register, each written in the words of the one chunk it is meant to reach, one step per
   sentence and no second clause. Beside each entry: the dataset cases it was written for and
   the chunks it reaches. A unit test pins the shape against the committed corpus index.
2. `classifyFamily` (`src/lib/answer/steps.ts`) names a question's family by a keyword table
   over the condensed question — `classifyRouting`'s rules ([ADR 0017](0017-other-institutions-are-routed.md)),
   shared `wordPatterns` — with no model call. A question naming no family gets no probe. A tie
   goes to the later family: the later families (prescription, cessation, sanction) name a
   situation that presupposes the earlier ones.
3. `search_chunks` v6 takes `step_texts[]`/`step_embeddings[]` and runs one more hybrid pair:
   each sentence's own 50 nearest chunks and 50 best lexical matches, interleaved by **best rank
   in any sentence's list** into one leg of 50 each. Not one concatenated text: measured, a
   three-sentence text carried «¿Cuándo me corresponde pagar…?» at pool #17 and `cnpt` art. 79
   not at all, while each sentence alone carried its chunk at vector rank 1. Not nearest by raw
   distance across sentences either: that merge let one sentence's fifty nearest crowd out
   another sentence's first. A catalogue of three sentences weighs what one expansion weighs.
4. The question's four legs are computed exactly as v5 computed them, and both step arguments
   default to null — `STEPS=off`, and a question of no family, reproduce v5 row for row. The
   catalogue's legs are **no witness to corroboration** ([ADR 0019](0019-query-expansion-legs.md)'s
   #307 rule, applied): the probe is the same text for every question in the family, so it can
   fill a pool and never move `isWeak`.
5. At the rerank, each sentence is scored as its own Voyage query in the same batch, and the
   default mode is **`pin`**: the question's readings decide the order and the cut exactly as
   #296 left them, and the best chunk of each sentence's reading is appended past the cut when
   the cut did not already take it — the [#287](https://github.com/rjwrld/tramitico/issues/287)
   derived-input shape. `STEPS_RERANK=max|off` keep the alternatives measurable.

**Rejected: the sentences as rerank queries fused by max, as the issue proposed.** Measured
first on the #303 six: the step chunks reach reranked #1–#3, and the question's own chunks move
down to make room — the F case's escala chunks from #3/#4 to #8/#9, the H case's
`reglamento-renta` 27 from #7 to #21. A required step in front of the model at the price of the
claim the question was about is not a trade the adequacy gate can take.

**Rejected: a model-written step probe.** #303's prototype, on the current expansion model;
the numbers are in that thread.

## Consequences

- On the #303 six, every chunk the issue named as a pool miss now enters the fused 40 (#3, #4,
  #10, #10, #14) and reaches the model, pinned or in the top-8, with not one question-side
  reranked rank moved except #9 → #8. Six-case adequacy 1/6 → 2/6; the four that still fail
  fail on the answer side with the step chunk in hand (#130).
- Full-dataset hit-rate 70/73 → **71/73**, gates green; the two misses are the Tier 2 corpus
  cases #296 left.
- Cost per ask that classifies: three more embeds and up to three more rerank calls, all in the
  batches the ask already waits for, and up to three more chunks of prompt. No new
  subprocessor and nothing new of the reader's leaves the service, so `/privacidad` is
  unchanged.
- A catalogue sentence is a claim about a chunk: a corpus change that renames or drops one is
  caught by `steps.test.ts` against `eval/corpus-index.json`, and `pnpm pool-dump` prints the
  family and the step ranks (`sv`/`sl`) for any case.

Measured and recorded in `eval/README.md`, «The pool misses are step-shaped».
