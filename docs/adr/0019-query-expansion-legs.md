# ADR 0019 — The question is asked twice: expansion legs, not a different search

Date: 2026-09-05 · Status: accepted · Amends [SPEC §5](../../SPEC.md) ·
Context: issue [#286](https://github.com/rjwrld/tramitico/issues/286), follow-up of the 2026
baseline [#267](https://github.com/rjwrld/tramitico/issues/267)

## Context

The 2026 baseline left six retrieval misses whose expected artículo never entered the fused
pool of 40 — two of them Tier 1, and therefore blocking on their own. Three measurements on
that same corpus say what the cause is not, and what it is:

- **Not the chunks.** Embed each expected chunk's own opening sentence and ask the corpus for
  it: 19 of the 20 come back at vector rank 1. No extraction defect, no heading-path defect,
  no missing embedding.
- **Not the AND→OR switch of [ADR 0005](0005-lexical-and-or-fallback.md).** All six questions
  already take the fallback branch: no chunk in the corpus matches the strict conjunction, so
  the switch is not what excludes the target.
- **Register.** A reader writes «me inscribí un año tarde»; CNPT artículo 78 is titled
  «Omisión de la declaración de inscripción». The Spanish snowball stemmer cannot bridge
  those — `inscrib` and `inscripcion` do not even share a prefix, so prefix matching is dead
  too — and the vector leg puts that artículo at rank 96 of 871. Demand vocabulary and
  statutory vocabulary are two registers, and the corpus is written in only one of them.

Two fixes inside the existing legs were measured and rejected: prefix-expanding the fallback
lexemes (the stems diverge before the prefix ends) and coverage-ordering the lexical leg
before its top-50 cut (moves the target's fused rank by ≤ 3 — a chunk one leg found at rank
20 scores ≈ 0.012 and cannot beat a chunk two legs found at rank 40, which is
[ADR 0006](0006-coverage-scaled-fallback-fusion.md)'s RRF working as designed). A rewritten
query, by contrast, moved every one of the six targets to the top of the vector leg. That is
what makes this a query-side problem with a query-side fix.

## Decision

**The question is asked twice, and both askings are legs of one fusion.**

1. A small model call (`src/lib/answer/expand.ts`, Haiku, the same seam and the same
   never-fail discipline as [ADR 0012](0012-multi-turn-question-condensation.md)'s
   condensation) rewrites the question into the register of the corpus. It is grounded in the
   corpus's own document titles, read off `corpus/manifest.json`: without that inventory the
   model invents plausible-but-absent vocabulary and picks the wrong materia.
2. `search_chunks` v5 takes an optional expansion text and embedding and runs the **identical
   hybrid pair** over them — a vector leg on the embedding, a coverage-scaled lexical leg on
   the text — fused into the same RRF sum as the question's own two legs. Four legs, equal
   weight, one k.
3. The question's two legs are computed exactly as v4 computed them, and both expansion
   arguments default to null — a null, failed or disabled expansion reproduces v4 row for row.
   That is the guarantee, and it is narrower than "the expansion cannot hurt": an enabled
   expansion contributes to the _same_ RRF sum, so it adds candidates without removing any, but
   it does change the fused order. Measured over the 61 single-turn cases, 30 improved, 21 held
   and 10 worsened by up to four ranks, none of them out of the pool. What cannot happen is a
   chunk the question's own legs found dropping out of the candidate set.

**Rejected: replacing the vector leg with the expansion's.** Simpler and one leg cheaper, but
it makes a bad rewrite able to destroy a search that used to work. The whole reason this is
affordable at all is that the failure mode is bounded to "no lift".

**Rejected: sibling/PRF expansion with no model call.** Free, and it fixes the "right
document, wrong artículo" shape (four of the six have the right document in the pool's top
five). It cannot reach CNPT artículo 78, whose neighbourhood is nowhere near the pool, so the
blocking Tier 1 case would stay red.

**The reranker reads the question and its expansion — as two queries, not one
string.** A pool rank is not a hit, and `rerank-2.5-lite` reads the same
question the fused legs read, so it has the same register gap: a target moved
from pool 24 to pool 5 and still missed. Both readings, not the expansion
alone — the rewrite is a probe, the question is what the reader asked, and
dropping it costs a case the reader's own words carry. This is the one place
where #286's fix reaches into what #287 owns, and it is here because leaving
it out would have shipped a Tier 1 regression.

#286 composed them by concatenation, and that shipped a Tier 1 regression of
its own: one string is one reading, so an expansion that drifts into another
country's law is _inside_ the query, and the Costa Rican artículo the reader
needed fell from reranked #3 to #10. **#296 scores the two separately and
keeps the higher score per chunk** (`fuseByMaxScore`, rerank.ts) — two Voyage
calls in parallel under the one timeout. That gives the rerank side the bound
the fused side already had: the expansion can only raise a chunk's score,
never lower it. Measured over all 73 retrieval cases, 68/73 → **70/73**, two
gained, none lost. RRF over the two orders, their mean, and a
question-weighted blend were each measured too and each lost a case that
concatenation held; max was the only variant with no regression.

**Corroboration needs at least one leg that ran on the reader's own question.** A chunk is
corroborated when a similarity leg and a word-matching leg both surfaced it, and the
expansion's legs count towards those two modes — they are the same two modes asked in the
corpus's words, not a third mode. But an expansion-only pair does not corroborate. The
expansion is a passage a model wrote for this question, and it writes one for _any_ question,
including one the corpus cannot answer; its lexical leg then matches the words the model chose
and its vector leg the meaning of that same text. Two views of one invented passage are not
two witnesses, and treating them as such is exactly how an out-of-scope ask would stop
tripping `isWeak` and stop reaching the honest decline of #21.

## Consequences

- **SPEC §5 is amended.** "The question" retrieval searches on is now the standalone question
  _and_ its corpus-register expansion, fused. Everything downstream — rerank, the answer
  prompt, the citation invariant, the groundedness judge — still sees one question and one
  retrieval set.
- **Every ask costs one small-model call and one extra embed**, not only follow-ups as
  condensation does. Bounded at `EXPAND_TIMEOUT_MS` = 3 s, and observed at ~1.8–2.8 s of
  `retrieve` wall time on this corpus. `EXPAND=off` sheds it entirely, the way `RERANK=off`
  sheds the reranker, and is what compares against a pre-#286 number.
- **What Anthropic receives changed again**, so `/privacidad` says so in this change: every
  question, not only a follow-up, now reaches the provider before the search. The rewrite is a
  search term — it is not stored and never reaches the reader.
- **A bad expansion is a new failure mode, and a quiet one**, exactly as a bad condensation is.
  It cannot make a search worse than v4's by construction, but it can fail to help, and it can
  name the wrong materia for an ambiguous question. The hit-rate transcript prints the
  expansion under every case for that reason.
- **The expansion prompt is coupled to the corpus.** Its document inventory comes from
  `corpus/manifest.json`, so a corpus change moves this prompt with it — the same rule the
  manifest already carries, now with a unit test that fails when a title is missing from the
  inventory.
- **Measured, over the 61 single-turn retrieval cases:** target inside the pool of 40, 57 → 59;
  inside the fused top-8, 44 → 53; 30 improved, 21 held, 10 worsened, worst regression four
  ranks, none pushed out of the pool.
- **Measured in the eval lane (2026-09-05, two identical runs):** hit-rate **63/73 → 68/73**
  (86.3 % → 93.2 %), blocking misses 4 → 2, first-exposure 25/32 → 27/32, corpus-derived
  32/34 → 34/34. `HIT_RATE_GATE` does not move: the ratchet rule never lowers a threshold and
  the measured rate minus one case is below the current 0.92.
- **One Tier 1 regression, written down rather than tuned away — and then fixed by #296 without
  touching the prompt.** `ho-cliente-espana-lleva-iva` missed from pool rank 3: the expansion
  for a question naming a foreign country drifts into that country's law, and the concatenated
  rerank query carried the drift. A prompt rule against it was measured and reverted — it did
  not recover the case and flipped a different one. The cause was the composition, not the
  rewrite: scoring the two readings separately and fusing by max recovers that case _and_
  `ho-donde-inscribo-ya-no-atv`, with no case lost, and leaves the drifting expansion exactly
  as it is. eval/README.md holds both measurements.
- **Reranking costs two Voyage calls per ask when there is an expansion** (#296), over the same
  40 documents. They run concurrently under the one `RERANK_TIMEOUT_MS`, so the reader waits for
  the slower call rather than the sum; the spend is what doubles, not the latency. `EXPAND=off`
  sheds the second call along with the second pair of legs.
