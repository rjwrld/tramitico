# Eval dataset (SPEC §9, issues #25/#26)

`dataset.jsonl` holds the hand-written eval questions — Appendix A's nine Tier 1
seeds (#264), the corpus-derived regression suite, and since #261 part B the
48-case **held-out set** written from demand evidence — each with the source
docs/artículos a correct retrieval must surface. SPEC §9's 25–45 band now
describes the corpus-derived half only; the held-out set has a composition
instead of a size (see below). One JSON object per line:

```json
{
  "id": "iva-clientes-fuera-cr",
  "seed": "appendix-a:2",
  "question": "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?",
  "expected": [
    { "docKey": "reglamento-iva", "articulo": "Artículo 11" },
    { "docKey": "ley-iva", "articulo": "Artículo 8" }
  ],
  "blocking": true,
  "notes": "…"
}
```

- `expected` — any one target matching any answer-top-k chunk counts as a hit.
  Targets must be _correct sources for the question_, verified against the
  ingested corpus; never add a target just because retrieval returns it.
- `articulo` — exact label as chunked (case-insensitive); omit it to accept any
  chunk of the document (single-artículo docs like `cabys-dev`).
- `pathIncludes` — exact heading-path element, for artículo labels that repeat
  across Títulos of one norma.
- `blocking` — the case fails the eval on its own, regardless of hit-rate.
  The canary from ADR 0003 is the one blocking case.
- `seed` — provenance: `appendix-a:<n>` (SPEC Appendix A), `demand:<family>`,
  `held-out:<family>` (#261 part B) or `corpus`.
- `history` — optional, and what makes a case a **condensation case** (#132,
  [ADR 0012](../docs/adr/0012-multi-turn-question-condensation.md)): a
  non-empty list of `{ question, answer }` turns preceding this one. Both eval
  suites condense such a case first — the same `condenseQuestion` the route
  calls — and then run the standalone result through the ordinary path, so
  `expected` describes the retrieval the _rewrite_ must produce, not the
  follow-up's. Write the follow-up the way a reader would type it ("¿Y si
  también soy asalariado?"): a case that would retrieve fine on its own proves
  nothing about condensation. Because these cases make a real model call, the
  hit-rate suite now needs `ANTHROPIC_API_KEY` too, and the per-case table
  prints the rewrite under any case that carries one — a miss is usually a bad
  rewrite rather than a retrieval regression.

The assertion lives in `src/lib/eval/retrieval-hitrate.eval.test.ts`
(loader/matcher in `src/lib/eval/dataset.ts`). It runs each question through
the production retrieval path — a fused pool of `RERANK_POOL` (40 since #51),
Voyage rerank, the answer top-k — and gates on hit-rate, the blocking canary,
and the weak-retrieval threshold. It is env-gated: skipped without
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and real embeddings; the on-demand
`eval.yml` lane runs it with those secrets (#147 moved it out of `ci.yml`).

**Which database `eval.yml` reads (#327).** The production Supabase project —
there is one hosted project, not a dedicated eval copy. The eval suites read
`chunks` and write nothing (they never call `rate_limit_increment` or insert
into `questions`), so the only thing a run costs production is the read, and
the corpus it measures is exactly the corpus production answers from. The
per-PR lanes (`test:integration`, pgTAP, `test:e2e:local`) keep CI's throwaway
`supabase start` stack and never see production. The Anthropic key the lane
uses comes from a workspace separate from production's capped one (runbook
§7), so an authorized run is never blocked by the US$10 cap.

Run locally:

```sh
supabase start && pnpm ingest   # once
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
pnpm vitest run --disableConsoleIntercept src/lib/eval/retrieval-hitrate.eval.test.ts
```

`--disableConsoleIntercept` is not optional (#342): vitest hides a _passing_
file's console, so without it a lane that passes leaves no per-case table in
the log — #305 paid US$0.25 to re-read one number that way, and `eval.yml`
now carries the flag too. `RERANK=off` measures the fused-only baseline; the
per-case table (pool rank, top score) prints with the run. Since #286 the retrieval a case runs is also
the _expanded_ one — a Haiku rewrite of the question into corpus register,
fused as two further legs — so a run without `ANTHROPIC_API_KEY` measures a
different search than a run with one. `EXPAND=off` opts out explicitly, and is
what to set when comparing against a pre-#286 number.

For a single case, `pnpm pool-dump <case id> …` prints the top of the fused
pool with every leg's rank and the expansion that produced it, then every
expected target's own fused rank (#312) — the diagnostic #286 was written with,
and the cheapest way to tell a chunk problem from a register problem (one embed
per case, no answer model). `--pool=<n>` widens the fused depth past
`RERANK_POOL`, which is how a target nowhere near the 40 is located at all.

Four knobs exist so the #287 and #303 options are measured rather than
argued, all read at call time and all defaulting to the pipeline of record:

| Variable             | Default           | What it changes                                                                                         |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `RERANK_MODEL`       | `rerank-2.5-lite` | the Voyage reranker asked for                                                                           |
| `ANSWER_TOP_K`       | `8`               | how many reranked chunks reach the answer prompt; 10 measured and kept at 8 (#305)                      |
| `ANSWER_DOC_CAP`     | `off`             | at most _n_ chunks per document in the answer set, backfilled (#303); rejected at 8 and 10 (#312, #305) |
| `PIN_DERIVED_INPUTS` | `off`             | `on` completes a derived figure whose sibling input survived the cut; read at top 10 only (#305)        |

Changing one changes the ask pipeline, not just the eval, so a run that moves
a knob says so in its header line, and all four keep their defaults until a
measured run earns the change. That includes the pin: it is deterministic and
append-only, which makes it safe to measure rather than already measured — it
matches on source identity, not on question relevance, so it can add context
to an answer that never asked for the figure. Measure it on both sides of an
otherwise fixed run before it becomes the default
([ADR 0018](../docs/adr/0018-derived-figures-by-code.md)).

For every case that missed with its target inside the fused pool, the run
prints the target's reranked rank, the answer set it lost to, and the chunk
holding the last surviving place (#287 requirement 1).

## The 2026 baseline (#267)

> **Measured 2026-09-05 (02:55–03:23 UTC), one authorized local run, on the
> beta corpus: 23 documents / 871 chunks / 0 missing embeddings, the corpus
> `eval/corpus-index.json` describes (dump of 2026-09-04, real-table census
> 3/3 PASS).** Answer `claude-sonnet-5`, judge `claude-sonnet-4-5`
> (temperature 0), embeddings `voyage-3`, rerank `rerank-2.5-lite` (pool 40 →
> top 8), condensation via `getCondenseModel()`. Every suite ran once, in
> series, with `--disableConsoleIntercept`; no suite was re-run. Raw logs are
> the session's; the tables below are transcribed from them.

This is the number #195 was waiting for, and #254's «baseline to keep»: it
describes the corpus the beta ships with, after the #269–#276 corpus changes
and the #278/#284 contract. It is also the first execution of the adequacy
gate, the abstention lane, the held-out set, the three #187 condensation cases
and the two adversarial suites inside one measured session.

| Suite                                         | Result                                                      | Gate                         | Wall-clock |
| --------------------------------------------- | ----------------------------------------------------------- | ---------------------------- | ---------- |
| satisfiability census (real table)            | 3/3, index in sync                                          | PASS                         | <1s        |
| retrieval hit-rate, `RERANK=voyage` (default) | **63/73 (86.3 %)**, 4 blocking Tier 1 misses, 0 weak        | **FAIL** (≥ 92 %)            | 58s        |
| retrieval hit-rate, `RERANK=off` (fused only) | 52/73 (71.2 %) — informational                              | —                            | 33s        |
| groundedness                                  | **70/73 (95.9 %)**, all three failures unanimous            | PASS (≥ 90 % → now ≥ 94 %)   | 1443s      |
| adequacy, Tier 1 (per case)                   | **2/27**                                                    | **FAIL**                     | (same run) |
| adequacy, Tier 2                              | 9/13 (69.2 %)                                               | **FAIL** (≥ 80 %)            | (same run) |
| citation invariant (#168)                     | 0 violations / 73 answers                                   | PASS → now asserted on all   | (same run) |
| F1 derived figures (`ccss-cuanto-pago-base`)  | `bmc-ivm-2026` input not in top-8                           | **FAIL**                     | (same run) |
| abstention                                    | **4/7 gated** (+2 reported-only, both pass); 2 figure flags | **FAIL** (≥ 90 %, 0 figures) | 124s       |
| conflicting sources (#135)                    | pass                                                        | PASS                         | 7s         |
| amending law (#182)                           | pass                                                        | PASS                         | 11s        |
| adequacy fixture                              | pass (incomplete fails, complete passes)                    | PASS                         | 15s        |
| `retrieval.eval.test.ts`                      | 9 pass / 4 fail / 1 skip — stale fixtures                   | FAIL (maintenance, #291)     | 3s         |

Paid wall-clock: **1,794s (≈30 min)** across the suites that spend. Cost is an
estimate — the harness does not count tokens, and the exact figure is in the
Anthropic and Voyage consoles for that window: roughly 73 Sonnet 5 answers,
~80 Sonnet 4.5 groundedness judgements (3 failures re-judged twice), ~190
single-requirement adequacy judgements, 9 abstention judgements plus
re-judges, and ~180 Voyage embeds and 80 reranks — on the order of **US$8–12**
in Anthropic spend and cents in Voyage.

### By exposure (#261 part B)

The held-out set has seven promoted members that the retrieval suite had
already scored, so every lane tallies three groups; the first-exposure column
is the coverage claim.

| Lane                               | first-exposure (32) | promoted (7) | corpus-derived (34) |
| ---------------------------------- | ------------------- | ------------ | ------------------- |
| hit-rate, rerank                   | 25/32               | 6/7          | 32/34               |
| hit-rate, fused only               | 20/32               | 4/7          | 28/34               |
| groundedness                       | 31/32               | 7/7          | 32/34               |
| adequacy (cases with requirements) | 10/32               | 1/7          | 0/1                 |

Abstention's nine cases are all first-exposure.

### What the numbers say

- **Groundedness held and ratcheted.** 70/73 with three unanimous failures;
  the gate moves from 0.90 to **0.94** (measured rate minus one case, rounded
  down — the ratchet rule below). The #182 rule 4 fix held:
  `iva-tarifas-reducidas` passed in the first judgement and
  `tribu-cr-declarar-pagar`, unstable in #157, passed too; both `notes` are
  rewritten against this result (#195 §A).
- **Retrieval is the first red.** Ten misses with rerank on: six with the
  target outside or deep in the fused pool (#286) and four cut between the
  pool and the top-8 (#287). Two of each are Tier 1. The reranker is worth
  eleven cases over the fused baseline, so `RERANK=off` remains a diagnostic,
  not an option.
- **Adequacy is the red that matters.** Tier 1 scores 2/27. Groundedness
  passed 70 of the same answers, which is exactly the gap #130 predicted:
  supported but incomplete. Most missing items are `requiredSteps` and scope
  claims, four are deterministic-lane figure misses. The answers were not
  persisted by the harness at the time, which is what #289 fixed first (the
  run transcript below); five of the figure misses turned out to be the
  comma-vs-period defect in `checkLiteral`, not omissions at all.
- **Abstention routes badly on sociedades.** Two of the three failures should
  route to Registro Nacional; the third rejected a false premise and named no
  institution (#290). The two `figureMentions` flags are cited corpus figures
  quoted while declining — a harness false positive on the model route, fixed
  in the same issue.
- **#187:** `exportacion-comprobante-followup` and `renta-plazo-followup` hit
  and passed; `ccss-asalariado-followup` was rewritten correctly and still
  missed (fused rank 20, cut by rerank) and failed groundedness 3/3 — **not
  promoted** to blocking. A gate is armed on a measured hit.
- **#168:** 0 citation violations over 73 answers, so the invariant is now
  asserted on every case, not only the blocking ones.
- **No gate was lowered.** Hit-rate (0.92), Tier 2 adequacy (0.80) and
  abstention (0.90) stay where they were and stay red until their follow-ups
  land; Tier 1 is per-case blocking by construction (the parser refuses a
  Tier 1 case without `blocking: true`). The `eval.yml` lane, run on demand,
  will be red until then — that is the pressure, not a defect.

### The ratchet rule

A threshold is set from a measured run as **the measured pass rate minus one
case, rounded down to two decimals, never below its previous value**. A gate
set exactly at the measured rate turns one flaky case into a red week; one
case of headroom is what the majority-of-three judge cannot absorb. A gate
above the measured rate stays where it is until the follow-ups bring the
measurement over it — it is never lowered to meet the number.

### Follow-ups, by cause

| Cause                             | Cases                                | Issue |
| --------------------------------- | ------------------------------------ | ----- |
| retrieval (outside/deep pool)     | 6 (2 Tier 1)                         | #286  |
| rerank (pool → top-8 cut)         | 4 (2 Tier 1) + F1 derived input      | #287  |
| generation / citation             | 3 groundedness (1 Tier 1)            | #288  |
| adequacy / actionability          | 25 Tier 1 + 4 Tier 2                 | #289  |
| abstention routing + harness      | 3 routing + 2 figure false positives | #290  |
| eval maintenance (stale fixtures) | 4 in `retrieval.eval.test.ts`        | #291  |

### The six pool misses, diagnosed and answered (#286)

The six retrieval misses of the table above — the ones whose expected artículo
never entered the fused pool of 40 — have one cause, measured three ways on
the same corpus the baseline ran on:

1. **The chunks are healthy.** Embed each expected chunk's own opening
   sentence and ask the corpus for it: 19 of the 20 come back at vector rank
   1 (the twentieth, `ley-renta` ARTICULO 2 #0, at rank 2, behind a
   near-identical `ley-iva` Artículo 4). No extraction defect, no heading-path
   defect, no missing embedding.
2. **The lexical switch is not holding anything back.** All six questions
   already take `search_chunks`'s OR-fallback branch — no chunk in the corpus
   matches the strict conjunction — so the strict/loose decision of #51 is not
   what is excluding the target.
3. **What fails is register.** A reader writes «me inscribí un año tarde»; the
   artículo says «omisión de la declaración de inscripción». The Spanish
   snowball stemmer cannot bridge those (`inscrib` vs `inscripcion` — not even
   a shared prefix, so prefix matching does not rescue it either), and the
   vector leg puts that artículo at rank 96 of 871.

Two candidate fixes were measured and rejected on the evidence: **prefix
expansion** of the fallback lexemes (dead — the stems diverge before the
prefix ends) and **coverage-ordering the lexical leg** before its top-50 cut
(moves the target's fused rank by ≤ 3; a chunk one leg found at rank 20 scores
≈ 0.012 and cannot beat a chunk two legs found at rank 40, which is RRF
working as designed). A hand-written expansion, by contrast, moved every one
of the six targets to the top of the vector leg — which is what made query
expansion the fix: of the three the issue allows — chunk shape, query
expansion, lexical weighting — the measurements above rule out chunk shape
and lexical weighting, and expansion is what is left standing.

| Case                         | Best target, vector rank       | Cause                                                                        |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `inscripcion-tardia-sancion` | 96, no lexical match           | «inscribí» vs «declaración de inscripción»; nothing in CNPT 78 shares a stem |
| `ho-t2-constancia-al-dia`    | 122                            | «constancia … al día» vs «consulta pública de situación tributaria»          |
| `tribu-cr-declarar-pagar`    | 53                             | right document at pool 1/2 (Preámbulo, Art. 8), wrong artículo               |
| `ho-t2-credito-iva-compras`  | 51 — one place outside the leg | «me lo puedo rebajar» vs «crédito fiscal»                                    |
| `ho-t2-payoneer`             | 38                             | plataforma de pago vs «renta de fuente costarricense»                        |
| `ho-rebajar-25-sin-facturas` | 23                             | «rebajar sin facturas» vs «deducción única … sin necesidad de prueba»        |

**The fix, and what it does.** `expand.ts` rewrites the question into the
register of the corpus, grounded in the corpus's own document titles
(`corpus/manifest.json`), and `search_chunks` v5 runs the identical hybrid
pair over the rewrite — its embedding on a vector leg, its text on a lexical
leg — fused into the same RRF sum as the question's own two legs. Four legs,
equal weight, one k. The question's legs are computed exactly as v4 computed
them, and every chunk they find stays a candidate. That is narrower than "the
expansion cannot hurt": it shares the RRF sum, so it changes the fused order —
the table below measures by how much. The byte-for-byte guarantee is the null
one: both expansion arguments default to absent and reproduce v4 row for row,
which is what `EXPAND=off` and every keyless lane get.

**Exposure, stated plainly.** The #267 baseline is published, which is what
lifts the held-out embargo («nobody consults these cases while tuning
retrieval… until the #267 baseline is published»), so these six were visible
while the rewrite prompt was written. The 61-case table below is therefore
**in-sample for the six** and out-of-sample for the other 55; the aggregate is
worth reading as the 55. Concretely: the rule that stops the model from
silently disambiguating a question the reader left ambiguous — and its list of
trámites that exist at both institutions — was written with
`inscripcion-tardia-sancion` and `ho-t2-constancia-al-dia` in view. It moved
the first into the pool and did not move the second at all.

**What it measured, and what it did not.** The fused pool is not the hit-rate
gate — only an authorized eval run measures that — so what is claimed here is
the pool, over the 61 single-turn retrieval cases of the dataset, on the
baseline corpus, with `--no-expansion` as the control:

| Measure                                | v4 (question only) | v5 (+ expansion legs) |
| -------------------------------------- | ------------------ | --------------------- |
| expected target inside the pool of 40  | 57 / 61            | **59 / 61**           |
| expected target inside the fused top-8 | 44 / 61            | **53 / 61**           |
| cases that improved / held / worsened  | —                  | 30 / 21 / 10          |

No case left the pool, and the worst single regression is four ranks
(`ho-trabajitos-por-mi-cuenta`, 3 → 7): the candidate-set property holds
empirically, and the small negative moves are other chunks gaining an
expansion contribution, not the question's own legs changing. The fused top-8
column is the one that predicts a hit without the reranker, and it is where
the mechanism shows: +9.

Of the six, four now reach the pool — `ho-rebajar-25-sin-facturas` at 4 (was
31), `ho-t2-payoneer` at 14 (was 40), `inscripcion-tardia-sancion` at 23 (was
outside), `tribu-cr-declarar-pagar` at 31 (was outside). **Both Tier 1 cases
are in the pool; neither is claimed as a hit here** — that is the reranker's
half and it is measured only in the eval lane.

Two are not fixed, and the honest reasons differ:

- `ho-t2-credito-iva-compras` is outside the pool of 40 (the dump cannot say
  by how much — outside is all it measures). It reached rank 39 under an
  earlier draft of the rewrite prompt, so it is a pool-edge case, and the
  change that cost it is the one that bought the blocking Tier 1 case: the
  rule that stops the model from silently disambiguating a question the
  reader left ambiguous.
- `ho-t2-constancia-al-dia` is not reached at all. The expansion names the
  trámite correctly («certificación de cumplimiento de obligaciones
  tributarias») and the corpus's answer is a TRIBU-CR FAQ entry that calls it
  «consulta pública de situación tributaria»; the FAQ entry that _does_ use
  the reader's words («¿Qué significa el estado "al día"?», · 7) is not one of
  the case's expected targets. Naming targets is not this issue's business —
  the README rule forbids editing a case to match retrieval — so it is
  recorded here and left for the case's own review.

**The reranker had the same problem, and it had to be fixed here.** Putting a
target in the pool is not putting it in the top-8, and the reranker scores the
_question_ against the chunks — so it carries the register gap the legs just
closed. Measured: `ho-desde-cuanta-plata-caja` moved from pool 24 to pool 5
and still missed, because `rerank-2.5-lite` was still matching «desde cuánta
plata al mes lo obligan a uno a pagar Caja» against artículos that say «base
mínima contributiva». `rerankChunks` therefore scores against the question
**and** its expansion (rerank.ts). Both, not the expansion alone: the rewrite
is a probe and the question is what the reader asked, and dropping the
question costs a case the reader's own words carry. (#286 composed the two by
concatenating them into one query; #296 replaced that with two queries fused
by the higher score — see «The rerank query, recomposed (#296)» below.)

**The measured result (eval lane, 2026-09-05).** Two runs of
`retrieval-hitrate.eval.test.ts`, `RERANK=voyage`, `EXPAND=on`, on the same
871-chunk corpus as the baseline, ~192 s each. Both returned the identical
number and the identical five misses, so this is stable, not a draw:

| Run                                         | Hit-rate           | Blocking misses |
| ------------------------------------------- | ------------------ | --------------- |
| #267 baseline                               | 63/73 (86.3 %)     | 4               |
| expansion legs, reranker on the question    | 65/73 (89.0 %)     | 3               |
| **expansion legs + expansion-aware rerank** | **68/73 (93.2 %)** | **2**           |

By exposure: first-exposure 27/32 (was 25/32), promoted 7/7 (was 6/7),
corpus-derived 34/34 (was 32/34).

Six cases gained, one lost:

| Case                              | Tier             | Change                   |
| --------------------------------- | ---------------- | ------------------------ |
| `inscripcion-tardia-sancion`      | 1 T1-I coloquial | MISS → **hit** (pool 23) |
| `ho-rebajar-25-sin-facturas`      | 1 T1-E literal   | MISS → **hit** (pool 4)  |
| `ho-factura-electronica-o-recibo` | 1 T1-C coloquial | MISS → **hit** (pool 2)  |
| `tribu-cr-declarar-pagar`         | 2                | MISS → hit (pool 31)     |
| `ccss-asalariado-followup`        | 2                | MISS → hit (pool 4)      |
| `ho-t2-compu-cara-iva`            | 2                | MISS → hit (pool 7)      |
| `ho-cliente-espana-lleva-iva`     | 1 T1-D literal   | hit → **MISS** (pool 3)  |

**Both of #286's Tier 1 cases hit**, which is this issue's acceptance line.
The hit-rate is above `HIT_RATE_GATE` for the first time since the baseline,
and the gate does **not** move: the ratchet rule sets a threshold at the
measured rate minus one case (67/73 → 0.91), never below its previous value,
so 0.92 stands.

**The one regression, and what causes it.** `ho-cliente-espana-lleva-iva`
(«Le cobro a un cliente en España…») now misses from pool rank 3. The pool is
fine; the rerank query is not. The expansion for that question drifts into
foreign law — «otro Estado miembro de la Unión Europea», «lugar de
suministro», «servicios electrónicos» — because the question names a country,
and appending that to the rerank query pulls the reranker away from the Costa
Rican artículos sitting at pool 3. It is a general failure shape, not a
one-off: a question naming a foreign country, currency or platform can make
the model write that country's rules. One prompt rule aimed at it («escriba
siempre normativa de Costa Rica; el país que menciona la pregunta es un dato
del caso, no la ley aplicable») was written and **measured and reverted**: it
did not recover the case and it flipped a different one, which is the
signature of tuning against individual cases rather than fixing a mechanism.
It is written down here instead, as the next piece of work on the expansion
prompt. **#296 fixed it, and not in the prompt** — the drift is real and is
still there, but it is _appending_ the drift to the rerank query that made it
cost a case; see «The rerank query, recomposed (#296)» below.

**Two blocking cases remain**, and neither is #286's:
`ho-donde-inscribo-ya-no-atv` (a `seguimiento` case whose pool rank 7 has not
moved) and the regression above. Both were **recovered by #296**, which also
corrects the reading recorded here: `ho-donde-inscribo-ya-no-atv` was not
failing on its condensation — it was being cut by the rerank.

**Re-measured again after #287 merged in**, since that change touches the same
reranker: `68/73`, the same five misses, exposure unchanged — #287's knobs are
default-neutral (`rerank-2.5-lite`, pool 40 → top 8, `pin=off`), so the two
changes compose without interacting. The transcript line now names all of
them: `rerank=voyage rerank-2.5-lite, pool 40 → top 8, expand=on, pin=off`.

**The other lanes, re-measured too.** The change moves the top-8 for most
cases, which is the input every other lane reads, so groundedness and adequacy
were re-run on it (2026-09-05, 1 964 s, answer `claude-sonnet-5`, judge
`claude-sonnet-4-5`):

| Lane                         | #267 baseline  | now                | Gate            |
| ---------------------------- | -------------- | ------------------ | --------------- |
| groundedness                 | 70/73 (95.9 %) | **69/73 (94.5 %)** | PASS (≥ 0.94)   |
| adequacy (cases with claims) | 11/40          | **11/40**          | FAIL, unchanged |
| citation invariant (#168)    | 0 violations   | **1** violation    | FAIL, new       |
| F1 derived figures           | FAIL           | FAIL               | unchanged       |

Groundedness holds over its gate with one case of the two-case headroom spent,
and the gate does not move — the ratchet raises a threshold from a measured
run, and this run measured lower than the one that set it. By exposure:
first-exposure 29/32 (was 31/32), promoted 6/7 (was 7/7), corpus-derived 34/34
(was 32/34). The failing set turned over completely — the baseline's three
(`ho-hacienda-solo-cliente-eeuu`, `iva-credito-fiscal-compras`,
`ccss-asalariado-followup`) all pass now, and four different cases fail
(`multa-iva-no-declarado`, `ho-trabajitos-por-mi-cuenta`,
`ho-cliente-espana-lleva-iva`, `ho-minimo-caja-independiente-2026`). One of
those is #296's regression showing up in a second lane, which is what a worse
retrieval looks like downstream.

**Adequacy did not move at all: 11/40, the same total as the baseline.** That
is the #130 gap doing exactly what it is supposed to — retrieval finding the
right artículo does not make an answer state the required claim. It stays
#289's work, and this run is evidence that better retrieval alone will not
close it.

**One new citation violation:** `factura-primera-cabys`, `unresolved_markers`.
The baseline shipped 0 over 73 answers. The runtime invariant (#168) would
refuse that answer rather than ship it, so it is not a reader-facing defect,
but it is a regression against a clean sheet and belongs to #288.

**A harness defect had to be fixed before any of this could be measured.** Two
runs crashed in `beforeAll` — 222 s and 1 048 s of paid answers lost — because
one adequacy judge report failed to parse and the throw took the whole suite
with it. The judge closes `items` with `}` instead of `]`, identically on every
attempt, since it runs at temperature 0. It now answers into a Zod schema
(`generateObject`), `parseAdequacyReport` still enforces the index rules the
schema cannot express, and an unreadable report is retried and logged in full
instead of ending the run.

Reproduce any of this with `pnpm pool-dump <case id> …`, which prints the top
of the fused pool with all six leg ranks and then every expected target's own
fused rank (`--no-expansion --no-steps` for the v4 pool, since the expansion
and the catalogue both run by default).

### The rerank query, recomposed (#296)

#286 shipped one Tier 1 regression and wrote it down rather than tuning it
away: `ho-cliente-espana-lleva-iva` («Le cobro a un cliente en **España** por
un sistema que él usa allá, ¿va con IVA?») missed from pool rank 3. This is
that issue's answer, and the answer is **not in the expansion prompt**.

**The diagnosis: composition, not the rewrite (#296 requirement 1).** The
expansion for that question does drift into European VAT doctrine — «otro
Estado miembro de la Unión Europea», «lugar de suministro», «servicios
electrónicos» — but the drift only costs the case because #286 handed the
reranker `question + " " + expansion` as **one string**. One string is one
reading. Scoring the same pool against each query separately says so exactly:

| Rerank query         | Rank of `ley-iva` Art. 3 | Answer top-8 |
| -------------------- | ------------------------ | ------------ |
| the question alone   | **3**                    | hit          |
| the expansion alone  | 10                       | MISS         |
| the two concatenated | 10                       | MISS         |

Concatenated, the top-8 is `reglamento-iva` 46 / 10 / 49, `ley-iva` 1,
`reglamento-iva` 47 / 25, `ley-iva` 4 / 30 — the target is displaced by
`reglamento-iva` Art. 49 and Art. 25, the two chunks the foreign-law
vocabulary lifts. The reader's own words never stopped ranking the right
artículo third; the query stopped being the reader's own words.

**Measured on the whole dataset, not the case (#296 requirement 2 and 3).**
Every composition was scored from **one** data collection: per case, condense
→ `retrieve` (pool 40) → three Voyage calls (question, expansion, concatenated),
dumped raw. Every variant below is then computed offline from those three
orders, so nine variants cost three calls per case rather than nine runs. The
baseline reproduces #286 exactly — 68/73 with the identical five misses, and
65/73 for the pre-#286 question-only rerank — which is what says the fresh
expansions did not drift.

| Rerank composition                       | Hits      | Gained                     | Lost                                                                        |
| ---------------------------------------- | --------- | -------------------------- | --------------------------------------------------------------------------- |
| question + expansion concatenated (#286) | 68/73     | —                          | —                                                                           |
| question alone (pre-#286)                | 65/73     | espana                     | asalariado-followup, desde-cuanta-plata, factura-electronica, t2-compu-cara |
| expansion alone                          | 68/73     | donde-inscribo             | donde-me-afilio                                                             |
| RRF(question, expansion)                 | 69/73     | donde-inscribo, espana     | factura-electronica                                                         |
| RRF(question×2, expansion)               | 68/73     | donde-inscribo, espana     | factura-electronica, t2-compu-cara                                          |
| RRF(question, expansion, concatenated)   | 69/73     | espana                     | —                                                                           |
| mean of the two scores                   | 69/73     | donde-inscribo, espana     | factura-electronica                                                         |
| 0.7 × question + 0.3 × expansion         | 68/73     | donde-inscribo, espana     | asalariado-followup, factura-electronica                                    |
| **max of the two scores**                | **70/73** | **donde-inscribo, espana** | **—**                                                                       |

**The criterion is "lost nothing", not "scored highest".** Two variants lose no
case — max, and RRF over all three orders. Max is the one of the two that costs
two Voyage calls rather than three, and the one with a mechanism behind it
rather than a fusion that happens to come out clean. Scoring the two readings separately and keeping the
higher score per chunk gives the rerank the same bound the expansion legs
already have on the fused side (expand.ts property 3): **the expansion can
only ever raise a chunk's score, never lower it.** It is a bound, not
immunity — a chunk the expansion lifts can still cross above one whose own
score never moved — but the reader's own best answer can no longer be dragged
down by a passage no reader wrote, which is the failure #296 exists to remove.
That it also recovers `ho-donde-inscribo-ya-no-atv`, a case nobody was aiming
at, is the evidence that it is a mechanism and not a tuning.

Shipped as `fuseByMaxScore` (rerank.ts): two Voyage calls, run concurrently
under the one `RERANK_TIMEOUT_MS`, ties broken by the question's own Voyage
order and then by pool position. Both back → fused; one back → that reading
alone; neither → the fused order, unchanged policy. No expansion → one call,
byte-identical to before. The cost is **two rerank calls per ask instead of
one**, over the same 40 documents; the latency is the slower call, not the sum.

**The eval lane confirms it (#296 acceptance).** Two runs of
`retrieval-hitrate.eval.test.ts` on the same 871-chunk corpus, `RERANK=voyage`,
`EXPAND=on`, ~193 s each, both **70/73 (95.9 %)** with the identical three
misses — the offline scorer's prediction, case for case:

| Run                                      | Hit-rate           | Blocking misses |
| ---------------------------------------- | ------------------ | --------------- |
| #267 baseline                            | 63/73 (86.3 %)     | 4               |
| #286 expansion legs, concatenated rerank | 68/73 (93.2 %)     | 2               |
| **#296 rerank fused by max score**       | **70/73 (95.9 %)** | **0**           |

By exposure: first-exposure **29/32** (was 27/32), promoted 7/7, corpus-derived
34/34. `ho-cliente-espana-lleva-iva` hits from pool 3 and
`ho-donde-inscribo-ya-no-atv` from pool 7, so **the blocking-cases assertion
passes for the first time since the 2026 baseline** — and the README's earlier
reading of `ho-donde-inscribo-ya-no-atv` as a condensation failure was wrong:
its condensation was fine and its rerank was not.

The three remaining misses are all Tier 2 and none of them is a rerank
problem: `ho-t2-credito-iva-compras` and `ho-t2-constancia-al-dia` never reach
the pool of 40 (diagnosed above, unchanged), and `ho-t2-payoneer` reranks #15
from pool #14, displaced by `ley-iva` Art. 30 at 0.5313.

**`HIT_RATE_GATE` stays at 0.92** (#296 requirement 4). The ratchet rule would
allow 0.94 from a 70/73 run; the issue pins it, and pinning is right here —
the remaining headroom belongs to three Tier 2 cases whose next fix is a
corpus or dataset one, not a retrieval one.

**The other lanes, re-measured on the new top-8.** The change moves the
reranked order for far more cases than the two that flipped, and that order is
the input every other lane reads, so groundedness, adequacy and the citation
invariant were re-run on it (2026-09-05, answer `claude-sonnet-5`, judge
`claude-sonnet-4-5`). None of them regressed; one recovered to PASS and one
improved without reaching its gate:

| Lane                         | #267 baseline  | #286           | #296 (this change) | Gate            |
| ---------------------------- | -------------- | -------------- | ------------------ | --------------- |
| groundedness                 | 70/73 (95.9 %) | 69/73 (94.5 %) | **69/73 (94.5 %)** | PASS (≥ 0.94)   |
| adequacy (cases with claims) | 11/40          | 11/40          | **14/40**          | FAIL, +3        |
| citation invariant (#168)    | 0 violations   | 1 violation    | **0 violations**   | PASS, recovered |
| F1 derived figures           | FAIL           | FAIL           | FAIL               | unchanged       |

Groundedness holds exactly where #286 left it — 94.5 %, over the gate, by
exposure first-exposure 29/32, promoted 6/7, corpus-derived 34/34 — so the
better retrieval was not bought with a worse answer. The gate does not move:
the ratchet raises a threshold from a measured run, and this run matched rather
than beat the one that set it.

Two things did get better without being aimed at. **Adequacy moves for the
first time since the baseline**, 11/40 → 14/40; #286 recorded that better
retrieval alone would not close the #130 gap, and three cases say that is not
quite the whole story, though 14/40 is still a failing lane and still #289's
work. And **the citation violation #286 introduced is gone**
(`factura-primera-cabys`, `unresolved_markers`), back to the baseline's clean
sheet — that one belonged to #288 and no longer needs to.

> Provenance, since it matters for how much this is worth: this measurement
> was not planned. A misplaced `--disable-console-intercept` swallowed the
> file path on the second hit-rate run and executed the whole eval project
> instead. The numbers are real and are reported here whichever way they came
> out; the point of saying so is that they are one run, not the two the
> hit-rate figures above rest on.

**Exposure, stated plainly.** All 73 retrieval cases were visible while the
composition was chosen, so "max" is the best of nine variants measured
in-sample. What limits the overfitting is the shape of the choice: the variants
are compositions of two fixed rerank calls, not prompt text tuned per case, and
max was selected for losing nothing rather than for winning most. There is no
out-of-sample check available — the held-out set (#261) is 39 retrieval cases
that are already inside these 73 — and that is a gap, not a claim.

### Retrieval, groundedness and adequacy, per case

> **This table is the #267 baseline's, and it stays that way.** It records what
> the 2026-09-05 baseline run measured, which is what the follow-up issues were
> written against — so `inscripcion-tardia-sancion` and
> `ho-rebajar-25-sin-facturas` read MISS here and `ho-cliente-espana-lleva-iva`
> reads hit, all three of which #286 later changed. Every later run is a
> section of its own with its own numbers; overwriting this one would erase the
> measurement the issues cite. The current state is «The six pool misses,
> diagnosed and answered (#286)» above.

| Case                                       | Tier               | Exposure | Hit (rerank) | Pool # | Hit (fused) | Groundedness          | Adequacy |
| ------------------------------------------ | ------------------ | -------- | ------------ | ------ | ----------- | --------------------- | -------- |
| `inscripcion-hacienda-clientes-extranjero` | 2                  | corpus   | hit          | 2      | hit         | pass                  | —        |
| `iva-clientes-fuera-cr`                    | 2                  | corpus   | hit          | 12     | MISS        | pass                  | —        |
| `cabys-desarrollo-software`                | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `ccss-cuanto-pago-base`                    | 2                  | corpus   | hit          | 4      | hit         | pass                  | —        |
| `ccss-cobro-retroactivo`                   | 2                  | corpus   | hit          | 2      | hit         | pass                  | —        |
| `ccss-pedir-prescripcion-cuotas`           | 1 T1-G coloquial   | promoted | hit          | 1      | hit         | pass                  | FAIL     |
| `ccss-ventana-prescripcion-24-meses`       | 1 T1-G seguimiento | promoted | hit          | 1      | hit         | pass                  | FAIL     |
| `ccss-obligacion-ingreso-bajo`             | 1 T1-B literal     | promoted | hit          | 2      | hit         | pass                  | FAIL     |
| `ccss-asalariado-y-freelance`              | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `ccss-cese-actividad`                      | 1 T1-H seguimiento | promoted | hit          | 8      | hit         | pass                  | pass     |
| `ccss-arreglo-pago`                        | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `ccss-suspension-seguro-ti`                | 2                  | corpus   | hit          | 4      | hit         | pass                  | —        |
| `factura-electronica-v44`                  | 2                  | corpus   | hit          | 2      | hit         | pass                  | —        |
| `desinscripcion-dejar-actividad`           | 1 T1-H literal     | promoted | hit          | 23     | MISS        | pass                  | FAIL     |
| `renta-persona-fisica-deduccion`           | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `regimen-simplificado-programador`         | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `tribu-cr-declarar-pagar`                  | 2                  | corpus   | MISS         | —      | MISS        | pass                  | FAIL     |
| `iva-servicios-extranjero-comprados`       | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `iva-credito-fiscal-compras`               | 2                  | corpus   | hit          | 11     | MISS        | FAIL [fail/fail/fail] | —        |
| `iva-declaracion-mensual`                  | 2                  | corpus   | hit          | 5      | hit         | pass                  | —        |
| `iva-tarifa-general`                       | 2                  | corpus   | hit          | 37     | MISS        | pass                  | —        |
| `iva-tarifas-reducidas`                    | 2                  | corpus   | hit          | 3      | hit         | pass                  | —        |
| `iva-momento-hecho-generador`              | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `renta-bruta-que-incluye`                  | 2                  | corpus   | hit          | 5      | hit         | pass                  | —        |
| `renta-tramos-2026`                        | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `renta-declaracion-plazo`                  | 2                  | corpus   | hit          | 2      | hit         | pass                  | —        |
| `renta-pagos-parciales-retenciones`        | 2                  | corpus   | hit          | 16     | MISS        | pass                  | —        |
| `renta-salario-y-actividad`                | 2                  | corpus   | hit          | 4      | hit         | pass                  | —        |
| `comprobantes-plazo-conservacion`          | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `comprobantes-factura-vs-tiquete`          | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `exportacion-servicios-comprobante`        | 2                  | corpus   | hit          | 2      | hit         | pass                  | —        |
| `iva-facturas-en-dolares`                  | 2                  | corpus   | hit          | 8      | hit         | pass                  | —        |
| `ccss-asalariado-followup`                 | 2                  | corpus   | MISS         | 20     | MISS        | FAIL [fail/fail/fail] | —        |
| `exportacion-comprobante-followup`         | 2                  | corpus   | hit          | 3      | hit         | pass                  | —        |
| `renta-plazo-followup`                     | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `iva-ajuste-bien-de-capital`               | 2                  | corpus   | hit          | 3      | hit         | pass                  | —        |
| `iva-retencion-tarjetas-porcentaje`        | 2                  | corpus   | hit          | 1      | hit         | pass                  | —        |
| `inscripcion-tribu-cr`                     | 2                  | corpus   | hit          | 4      | hit         | pass                  | —        |
| `multa-iva-no-declarado`                   | 1 T1-I literal     | promoted | hit          | 15     | MISS        | pass                  | FAIL     |
| `inscripcion-tardia-sancion`               | 1 T1-I coloquial   | promoted | MISS         | —      | MISS        | pass                  | FAIL     |
| `factura-primera-cabys`                    | 2                  | corpus   | hit          | 4      | hit         | pass                  | —        |
| `ho-hacienda-solo-cliente-eeuu`            | 1 T1-A literal     | first    | hit          | 2      | hit         | FAIL [fail/fail/fail] | FAIL     |
| `ho-trabajitos-por-mi-cuenta`              | 1 T1-A coloquial   | first    | hit          | 3      | hit         | pass                  | FAIL     |
| `ho-donde-inscribo-ya-no-atv`              | 1 T1-A seguimiento | first    | MISS         | 16     | MISS        | pass                  | FAIL     |
| `ho-desde-cuanta-plata-caja`               | 1 T1-B coloquial   | first    | hit          | 24     | MISS        | pass                  | FAIL     |
| `ho-donde-me-afilio-caja`                  | 1 T1-B seguimiento | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-tiquete-en-vez-de-factura`             | 1 T1-C literal     | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-factura-electronica-o-recibo`          | 1 T1-C coloquial   | first    | MISS         | 5      | hit         | pass                  | FAIL     |
| `ho-cabys-paginas-web`                     | 1 T1-C seguimiento | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-cliente-espana-lleva-iva`              | 1 T1-D literal     | first    | hit          | 9      | MISS        | pass                  | FAIL     |
| `ho-iva-en-cero-sin-facturar`              | 1 T1-D coloquial   | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-hasta-que-dia-tengo-iva`               | 1 T1-D seguimiento | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-rebajar-25-sin-facturas`               | 1 T1-E literal     | first    | MISS         | 31     | MISS        | pass                  | FAIL     |
| `ho-minimo-renta-2026`                     | 1 T1-E coloquial   | first    | hit          | 2      | hit         | pass                  | FAIL     |
| `ho-ademas-tengo-salario`                  | 1 T1-E seguimiento | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-minimo-caja-independiente-2026`        | 1 T1-F literal     | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-800-mil-que-porcentaje-caja`           | 1 T1-F coloquial   | first    | hit          | 2      | hit         | pass [fail/pass/pass] | FAIL     |
| `ho-tambien-asegurado-por-patrono`         | 1 T1-F seguimiento | first    | hit          | 17     | MISS        | pass                  | FAIL     |
| `ho-cobrar-8-anos-atras-caja`              | 1 T1-G literal     | first    | hit          | 2      | hit         | pass                  | pass     |
| `ho-desinscribir-debiendo-declaraciones`   | 1 T1-H coloquial   | first    | hit          | 15     | MISS        | pass                  | FAIL     |
| `ho-rebajar-multa-si-pago-ya`              | 1 T1-I seguimiento | first    | hit          | 11     | MISS        | pass                  | FAIL     |
| `ho-t2-credito-iva-compras`                | 2                  | first    | MISS         | —      | MISS        | pass                  | pass     |
| `ho-t2-hosting-extranjero`                 | 2                  | first    | hit          | 6      | hit         | pass                  | pass     |
| `ho-t2-retencion-tarjetas`                 | 2                  | first    | hit          | 2      | hit         | pass                  | pass     |
| `ho-t2-compu-cara-iva`                     | 2                  | first    | MISS         | 12     | MISS        | pass                  | FAIL     |
| `ho-t2-tipo-de-cambio`                     | 2                  | first    | hit          | 6      | hit         | pass                  | pass     |
| `ho-t2-panaderia-simplificado`             | 2                  | first    | hit          | 1      | hit         | pass                  | pass     |
| `ho-t2-arreglo-pago-caja`                  | 2                  | first    | hit          | 9      | MISS        | pass                  | pass     |
| `ho-t2-salir-del-pais-seguro`              | 2                  | first    | hit          | 1      | hit         | pass                  | FAIL     |
| `ho-t2-pensionado-con-actividad`           | 2                  | first    | hit          | 4      | hit         | pass                  | pass     |
| `ho-t2-autorizar-contador`                 | 2                  | first    | hit          | 1      | hit         | pass                  | pass     |
| `ho-t2-constancia-al-dia`                  | 2                  | first    | MISS         | —      | MISS        | pass                  | FAIL     |
| `ho-t2-payoneer`                           | 2                  | first    | MISS         | 40     | MISS        | pass                  | pass     |

### Groundedness failures (judge reason)

- `iva-credito-fiscal-compras` — The answer cites fragment [1] twice but fragment [1] only discusses the simplified regime prohibition, not the general vinculación requirements stated in the second citation.
- `ccss-asalariado-followup` — The answer states that fragments do not detail the exact percentage or the current Base Mínima Contributiva amount, but fragments [6] and [7] explicitly provide this information including an image with the contribution table.
- `ho-hacienda-solo-cliente-eeuu` — The answer claims that the obligation to register arises because the person 'exercises the lucrative activity in Costa Rica,' but the fragments do not establish that invoicing a U.S. client from Costa Rica automatically constitutes a Costa Rican-source activity subject to registration; the fragments define contributors and source rules but do not support the blanket assertion that this scenario triggers Hacienda obligations.

### Adequacy failures (missing requirements)

- `ccss-pedir-prescripcion-cuotas` — En cobro, la Administración dispone de 20 días hábiles desde el siguiente día hábil a la recepción para resolver; en verificación, la solicitud se atiende dentro del informe o de la resolución del recurso, según la fase.; El canal correcto según la fase del caso — la unidad o sucursal financiera si está en verificación, cobros@ccss.sa.cr si ya está en cobro — y el plazo en que la Administración resuelve.
- `ccss-ventana-prescripcion-24-meses` — Para una persona trabajadora independiente no inscrita que no se regularizó dentro de esa ventana, vuelve a aplicar el plazo de diez años; la CCSS además debe analizar si hubo actos que interrumpieran la prescripción.
- `ccss-obligacion-ingreso-bajo` — Toda persona trabajadora independiente está obligada a asegurarse ante la CCSS; la obligación no depende de superar un umbral de ingresos.; La obligatoriedad está en la Ley Constitutiva de la CCSS y en el Reglamento para el aseguramiento de los trabajadores independientes, no en una decisión voluntaria de la persona.; Quien tiene muy escasa capacidad contributiva se ubica en la categoría 1 de la escala, que es exclusiva de trabajadores independientes y asegurados voluntarios.; Dónde se hace la afiliación y qué se declara: el ingreso de referencia, en la sucursal de la CCSS que corresponda a la zona de adscripción.; La cuota se calcula sobre un ingreso de referencia que no baja de la base mínima contributiva, fijada en 0,9295 salarios mínimos para el Seguro de Salud. (0,9295 SM | 0,9295 salarios mínimos | 0.9295 SM: absent)
- `desinscripcion-dejar-actividad` — Al cesar la actividad económica hay que desinscribirse del Registro de Contribuyentes; no basta con dejar de facturar.; Mientras la persona siga inscrita conserva sus obligaciones de declarar, y omitir una declaración se sanciona aunque no haya habido ingresos.; Al desinscribirse del IVA hay que liquidar el impuesto sobre las existencias de bienes y los bienes afectos que queden, salvo que opere la continuidad del negocio.
- `tribu-cr-declarar-pagar` — Los formularios, instructivos y procedimientos aplicables son los que publique la Dirección General de Tributación para los módulos de TRIBU-CR.
- `multa-iva-no-declarado` — La sanción se reduce si se subsana antes de que la Administración Tributaria actúe (CNPT artículo 88).; Cómo regularizar: presentar las declaraciones omitidas y pagar en TRIBU-CR, y que hacerlo antes de cualquier actuación de la Administración rebaja la sanción.; El salario base vigente en 2026 es de ¢462.200 (Circular 246-2025 de la Secretaría General de la Corte). (¢462.200 | 462.200: absent)
- `inscripcion-tardia-sancion` — Subsanar de forma espontánea, antes de cualquier actuación de la Administración, rebaja la sanción en un setenta y cinco por ciento (75 %), u ochenta por ciento (80 %) si se autoliquida y paga en ese momento (CNPT artículo 88).; Cómo regularizar: presentar la declaración de inscripción en la Oficina Virtual de TRIBU-CR y autoliquidar la sanción para acceder a la rebaja del artículo 88.; Omitir la declaración de inscripción se sanciona con el cincuenta por ciento (50 %) de un salario base por cada mes o fracción de mes de atraso (CNPT artículo 78). (50 % | 50% | cincuenta por ciento: absent); La sanción total no puede superar el equivalente a tres salarios base (CNPT artículo 78). (tres salarios base | 3 salarios base: absent); El salario base vigente en 2026 es de ¢462.200 (Circular 246-2025 de la Secretaría General de la Corte). (¢462.200 | 462.200: absent)
- `ho-hacienda-solo-cliente-eeuu` — Toda persona física que inicie una actividad lucrativa debe inscribirse en el registro de contribuyentes al iniciarla, aunque todos sus clientes estén en el extranjero.; Facturar sólo a clientes del exterior no exime de inscribirse: aunque el servicio llegue a calificar como exportación exenta —lo que depende de que se consuma fuera de Costa Rica—, estar exento no es lo mismo que no ser contribuyente.; Quien no solicita la inscripción puede ser inscrito de oficio por la Administración Tributaria.; La inscripción se presenta hoy en la Oficina Virtual de TRIBU-CR, como declaración de inscripción del Registro Único Tributario.; Omitir la declaración de inscripción se sanciona con el cincuenta por ciento (50 %) de un salario base por cada mes o fracción de atraso. (50 % | 50% | cincuenta por ciento: absent)
- `ho-trabajitos-por-mi-cuenta` — Los dos trámites que siguen: la declaración de inscripción del RUT en la Oficina Virtual de TRIBU-CR y la afiliación como trabajador independiente en la CCSS.
- `ho-donde-inscribo-ya-no-atv` — El usuario de la Oficina Virtual es el número de identificación de la persona: cédula, DIMEX o NITE.; Una persona física nacional puede inscribirse por la Oficina Virtual si es mayor de 18 años, figura como «vivo» en el sistema y su estado tributario es «No inscrito», «Desinscrito» o «Desinscrito de oficio».
- `ho-desde-cuanta-plata-caja` — No hay un piso de ingresos por debajo del cual la persona quede fuera: toda persona trabajadora independiente está obligada a asegurarse.; Cómo se declara el ingreso de referencia y dónde se paga la cuota.; Lo que sí tiene un piso es la base de cálculo: la base mínima contributiva del Seguro de Salud es 0,9295 salarios mínimos. (0,9295 SM | 0,9295 salarios mínimos | 0.9295 SM: absent); La base mínima contributiva del Seguro de IVM es 0,87 salarios mínimos. (0,87 SM | 0,87 salarios mínimos | 0.87 SM: absent); El salario mínimo de referencia es el del trabajador en ocupación no calificada genérico, ¢373.092,30 mensuales en 2026. (¢373.092,30 | 373.092,30: absent)
- `ho-donde-me-afilio-caja` — En el trámite se declara el ingreso de referencia sobre el que se calculará la cuota.; La cuota se paga mensualmente, dentro de la fecha que corresponde según la primera letra del primer apellido.
- `ho-tiquete-en-vez-de-factura` — Quien emite comprobantes electrónicos debe estar inscrito en el Registro Único Tributario y tener registrado un correo electrónico válido ante la Administración Tributaria.
- `ho-factura-electronica-o-recibo` — Las excepciones a la obligación de emitir comprobantes electrónicos son las del artículo 8 y no alcanzan a una persona física que vende bienes o presta servicios gravados con IVA.; Con qué emitir: el facturador gratuito de Hacienda o un proveedor de sistemas de comprobantes electrónicos.; Los comprobantes electrónicos y sus documentos asociados deben almacenarse y conservarse por un plazo de cinco años. (cinco años | 5 años: absent)
- `ho-cabys-paginas-web` — Cada línea de detalle del comprobante lleva su código CABYS. _(The claim as the run judged it; #293 later rewrote it to art. 13's «código de producto» — see «A dataset decision, no run (#293)».)_
- `ho-cliente-espana-lleva-iva` — Que el cliente sea extranjero no basta por sí solo: lo que decide es dónde se consume o utiliza el servicio.; La operación exenta se documenta igual, con el comprobante electrónico que corresponda.; El hecho generador ocurre al facturar o al prestar el servicio, el acto que se realice primero, no cuando el cliente paga.; Qué comprobante emitir y qué conservar como prueba de que el servicio se consumió fuera del país.; Si el servicio se consume en Costa Rica, la tarifa general del impuesto es del 13 %. (13 % | 13% | trece por ciento: absent)
- `ho-iva-en-cero-sin-facturar` — Dónde se presenta la declaración hoy y qué pasa si ya venció el plazo.; Omitir la declaración dentro del plazo legal se sanciona con una multa del cincuenta por ciento (50 %) de un salario base. (50 % | 50% | cincuenta por ciento: absent)
- `ho-hasta-que-dia-tengo-iva` — Qué hacer si la fecha ya pasó.
- `ho-rebajar-25-sin-facturas` — Es una alternativa, no un añadido: se toma la deducción única o se deducen los gastos reales con comprobante, no ambas.; La deducción única fue incorporada por la Ley 10818 del 13 de noviembre de 2025, así que rige para los períodos que esa reforma alcanza.; Dónde se aplica la opción al presentar la declaración anual.; Sí: la ley permite acogerse a una deducción única, sin necesidad de prueba alguna, del veinticinco por ciento (25 %) de los ingresos brutos de la actividad. (25 % | 25% | veinticinco por ciento: present but uncited)
- `ho-minimo-renta-2026` — Los tramos son anuales y se aplican sobre la renta neta, no sobre los ingresos brutos.; El período del impuesto va del 1 de enero al 31 de diciembre.; Dónde se consultan los tramos vigentes cuando cambia el decreto anual.; Para personas físicas con actividad lucrativa, las rentas de hasta ¢6.244.000,00 anuales no están sujetas al impuesto en el período fiscal 2026. (¢6.244.000 | 6.244.000: present but uncited)
- `ho-ademas-tengo-salario` — El salario y la actividad lucrativa tributan por escalas distintas: el salario por la escala mensual de rentas del trabajo y la actividad por la escala anual de personas físicas con actividad lucrativa.; Quien tiene actividad lucrativa debe además hacer pagos parciales a cuenta del impuesto del período, que luego se restan del impuesto liquidado en la declaración anual.; Qué se declara en la declaración anual cuando hay salario y actividad, y cómo se tratan las retenciones ya soportadas.; Los pagos parciales: cuándo se pagan y que puede pedirse su rebaja cuando la renta del período va a ser menor.; La declaración anual y el pago vencen dentro de los dos meses y quince días naturales siguientes al cierre del período. (dos meses y quince días | 2 meses y 15 días: absent)
- `ho-minimo-caja-independiente-2026` — El monto en colones es una derivación de esas cifras y debe presentarse como tal, no como un dato tomado de una fuente.; Cómo se declara y se actualiza el ingreso de referencia sobre el que se aplican esos porcentajes.; El salario mínimo de referencia es el del trabajador en ocupación no calificada genérico: ¢373.092,30 mensuales en 2026. (¢373.092,30 | 373.092,30: absent); La base mínima contributiva es 0,9295 salarios mínimos en el Seguro de Salud y 0,87 salarios mínimos en el de IVM. (0,9295 SM | 0,9295 salarios mínimos: absent); En la categoría 1 de la escala, la cuota del afiliado es del 2,89 % en el Seguro de Salud. (2,89 % | 2,89%: absent); En la categoría 1 de la escala, la cuota del afiliado es del 4,16 % en el Seguro de IVM a partir del 1 de enero de 2026. (4,16 % | 4,16%: absent)
- `ho-800-mil-que-porcentaje-caja` — La base de cálculo es el ingreso de referencia declarado ante la CCSS, no el ingreso bruto facturado.; Cómo se modifica el ingreso de referencia cuando los ingresos varían.; Un ingreso de ¢800.000 supera dos salarios mínimos, así que cae en la categoría 3 (de 2 SM a menos de 4 SM), cuya cuota de afiliado es del 6,24 % en el Seguro de Salud. (6,24 % | 6,24%: absent); En esa misma categoría la cuota del afiliado en el Seguro de IVM es del 7,53 %. (7,53 % | 7,53%: absent)
- `ho-tambien-asegurado-por-patrono` — Cada condición se calcula sobre su propia base: el salario por la planilla del patrono y la actividad por el ingreso de referencia declarado.; Qué hay que hacer ante la CCSS para quedar registrado en las dos condiciones.
- `ho-desinscribir-debiendo-declaraciones` — Desinscribirse no borra las obligaciones ya devengadas: las declaraciones pendientes siguen debiéndose y se sancionan igual.; Mientras la persona siga inscrita, la obligación de declarar continúa aunque ya no facture.; El orden recomendado: presentar lo pendiente y después solicitar la desinscripción indicando el motivo y la fecha de cese.; Cada declaración omitida dentro del plazo legal se sanciona con el cincuenta por ciento (50 %) de un salario base. (50 % | 50% | cincuenta por ciento: absent)
- `ho-rebajar-multa-si-pago-ya` — Cómo se regulariza: presentar lo omitido y pagar en TRIBU-CR antes de cualquier actuación de la Administración.; Subsanar de forma espontánea, sin que medie actuación de la Administración, rebaja la sanción en un setenta y cinco por ciento (75 %). (75 % | 75% | setenta y cinco por ciento: present but uncited)
- `ho-t2-compu-cara-iva` — El crédito de IVA de un bien de capital se ajusta a lo largo de varios períodos, no se acredita íntegramente en el mes de la compra.
- `ho-t2-salir-del-pais-seguro` — La suspensión del seguro de trabajador independiente se hace a solicitud de la persona y no ocurre de forma automática.
- `ho-t2-constancia-al-dia` — La situación tributaria se consulta en la OVi pública de TRIBU-CR, sin necesidad de usuario.

### Abstention, per case

| Case                           | Route | Verdict                | Note                                                           |
| ------------------------------ | ----- | ---------------------- | -------------------------------------------------------------- |
| `ho-abs-cuanto-cobro-la-hora`  | model | pass (not gated, #285) |                                                                |
| `ho-abs-me-conviene-sociedad`  | model | FAIL [3/3]             | answered; no Registro Nacional route                           |
| `ho-abs-aguinaldo-freelancer`  | model | pass                   |                                                                |
| `ho-abs-iva-2027`              | model | pass                   | figure flag: 4 %, 2 %, 1 %, 0,5 % — cited current rates (#290) |
| `ho-abs-devs-exentos-renta`    | model | FAIL [3/3]             | premise rejected; Hacienda not named                           |
| `ho-abs-patente-municipal`     | model | pass                   |                                                                |
| `ho-abs-calculo-personalizado` | model | pass                   | figure flag: the 2026 tramos and rates — cited (#290)          |
| `ho-abs-sociedad-inactiva`     | model | FAIL [3/3]             | answered; routed to Hacienda instead of Registro Nacional      |
| `ho-abs-recomendar-contador`   | model | pass (not gated, #285) |                                                                |

### Abstention, after #285 + #290 (2026-09-10, PR #321)

Re-measured on the same nine cases, all gated: **9/9, zero figure flags**, every
case on the model route. The three routing failures above pass (rule 6a for the
two sociedad cases, 6c for the false premise), and both previously excused cases
route to `contadores`. `ho-abs-aguinaldo-freelancer` failed an intermediate run
by answering «no, no tiene derecho» before routing — rule 5 now says to state the
Código de Trabajo limit as the general limit it is, not as a verdict on the
asker's case. The two `figures:` flags were a cited table whose citation sat in
its lead-in line; the citation window now reaches back to it.

Transcripts (`eval/transcripts/`, gitignored — copied to the main checkout):
`abstention-2026-09-11T00-28-44-957Z.jsonl`, with each answer in full. This lane
writes one now; before #290 it wrote nothing and a run left only scrollback.

Both "(not gated, #285)" rows are historical: the routing gap they measured
closed with the `contadores` category, and the abstention gate now counts all
nine cases. The two `figures:` flags are historical too — on the model route
`figureMentions` now clears a corpus figure the answer cites (#290), which is
what both of those were.

## Satisfiability guard (issues #111, #163)

The guard asserts every expected target is satisfiable by at least one ingested
chunk, and prints the full per-target census. The hit-rate eval cannot catch
this: a case hits when _any one_ of its targets matches, so a multi-target case
can carry a permanently unsatisfiable target and stay green forever — measuring
the corpus gap instead of answer quality.

It runs in **two lanes over one census** (`src/lib/eval/satisfiability.ts`):

- `src/lib/eval/dataset-satisfiability.test.ts` — the unit lane, on every PR,
  against `corpus-index.json`: a committed dump of the distinct
  `(docKey, articulo, path)` triples in `public.chunks`. Coverage is what the
  census needs, and coverage does not need embeddings — so a PR that adds an
  unsatisfiable target goes red with no database and no secrets. `pnpm ingest`
  rewrites the dump at the end of every run; **commit it with the corpus
  change**.
- `src/lib/eval/dataset-satisfiability.eval.test.ts` — the eval lane, against
  the real table. Same census, plus the drift check the committed dump cannot
  do for itself: it fails when `corpus-index.json` no longer describes
  `public.chunks`.

The eval-lane run needs no embeddings and no retrieval, only the database, so
it is far cheaper than the hit-rate eval:

```sh
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
pnpm vitest run --disableConsoleIntercept src/lib/eval/dataset-satisfiability.eval.test.ts
```

Its limit is deliberate: an `articulo`-less target passes by construction,
since it matches any chunk of its document. Whether the document's _text_
supports the case's claim is the judgement half of #111's sweep, not a
predicate — that is what the `notes` field records.

## Groundedness gate (issue #26)

`src/lib/eval/groundedness.eval.test.ts` runs every dataset question
through the full production answer path — retrieval, rerank, then the answer
model (`ANSWER_MODEL`, default Sonnet) with the production system prompt —
and asks an LLM judge at temperature 0: _is this answer supported by the
retrieved chunks?_ A failed item is re-judged twice more and the majority
verdict stands, absorbing judge flakiness at n≈25 without loosening the gate.
**Blocking gate: ≥94% pass** (`GROUNDEDNESS_GATE` in
`src/lib/eval/groundedness.ts`) — started at 90% per #14, ratcheted by the 2026
baseline (#267, 70/73); ratchet up, never down.

The judge is pinned (`JUDGE_MODEL`, Sonnet 4.5 — it accepts temperature 0,
which Sonnet 5 rejects; [ADR 0007](../docs/adr/0007-groundedness-judge-model.md))
and does **not** follow `ANSWER_MODEL`, so answer models are always compared
against the same judge. Pure parts (prompt,
verdict parsing, majority rule) are unit-tested in
`src/lib/eval/groundedness.test.ts`.

Env-gated like the hit-rate eval, plus `ANTHROPIC_API_KEY`:

```sh
supabase start && pnpm ingest   # once
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
ANTHROPIC_API_KEY=<key> \
pnpm vitest run --disableConsoleIntercept src/lib/eval/groundedness.eval.test.ts
```

> **Gate run 2026-08-25 (#157) on the current corpus: 24/25 (96%) — PASS.**
> Answer `claude-sonnet-5`, judge `claude-sonnet-4-5`, ~404s, 825 chunks / 17
> documents / 0 missing embeddings, all 25 cases model-judged (no weak-retrieval
> short-circuits). Capture the per-case table with
> `--disableConsoleIntercept`: without it vitest swallows the `beforeAll`
> console output and a run reports only pass/fail, which is why two earlier
> entries here say "per-case not captured".
>
> The one failure was `iva-tarifas-reducidas` — **not** one of the three cases
> that failed on 2026-08-13. It is a rule 4 false positive: fragment [1] is
> `ley-iva` Artículo 11 (Ley 6826, consolidated text) and fragment [2] is
> `ley-9635` Artículo 11 (Ley 9635, the reform that rewrote it) — the same norma
> at two moments, not two sources in conflict. Rule 4 reads the differing
> figures as a live discrepancy and the answer duly reports one, which the judge
> correctly calls an unsupported claim. Ingesting a consolidated law _and_ its
> amending law guarantees such pairs, so this is structural, not a one-off.
> Left unfixed here on purpose: a rule 4 amendment has to be validated against
> `conflicting-sources.eval.test.ts`, which rule 4 exists to hold in place, and
> that is a different piece of work. Failed 3/3 attempts (gate run plus two
> subset reps) — consistent, not judge noise.
>
> [#268](https://github.com/rjwrld/tramitico/issues/268) later removed this
> production shape by retiring `ley-9635` after migrating every target to the
> consolidated `ley-iva`/`ley-renta` sources. The fixed two-fragment fixture in
> `amending-law.eval.test.ts` remains as a prompt regression test.
>
> **The 2026-08-13 failures did not reproduce.** That run scored 22/25 (88%,
> FAIL) on `iva-clientes-fuera-cr`, `ccss-cuanto-pago-base` and
> `tribu-cr-declarar-pagar`, and concluded the #135 prompt amendment was not the
> cause and corpus drift probably was. Re-measured on the post-#114 corpus, the
> first two pass in the gate run and 2/2 in a pinned-chunk subset re-run; the
> drift diagnosis holds. `tribu-cr-declarar-pagar` passed the gate but was
> **unstable** — 1/2 in the same subset re-run, failing when the answer either
> over-reads «la salida de TRIBU-CR, el próximo 4 de agosto» as an operational
> date or invents a discrepancy, the latter being the same rule 4 pattern as
> `iva-tarifas-reducidas`. It was retired when #258 added five stable CCSS cases
> and the 30±5 cap required one case to leave. Per-case stability at n≈25 is
> real: treat a single case's verdict as a sample, not a fact.

### Haiku comparison (SPEC §5)

The Week 3 cost/quality comparison is the same command with
`ANSWER_MODEL=claude-haiku-4-5` — same dataset, same judge, same gate. The
per-case table and pass rate print with each run.

Measured on a verified-clean corpus (793 chunks / 14 documents / 0 missing
embeddings, all migrations applied), judge `claude-sonnet-4-5`, all 25 cases
model-judged — no weak-retrieval short-circuits in any run below:

> **Corpus changed since these runs — twice.** [#108](https://github.com/rjwrld/tramitico/issues/108)
> swapped the `rts-requisitos` flyer (1 chunk) for `reglamento-rts` (20 chunks),
> and [#114](https://github.com/rjwrld/tramitico/issues/114) then ingested the
> two CCSS escalas contributivas and the wage decree (`ccss-escala-salud`,
> `ccss-escala-ivm`, `salarios-minimos`). The corpus is now **825 chunks / 17
> documents / 0 missing embeddings**, and the gate's current-corpus number on it
> is the 24/25 recorded above. The rows below are a _Sonnet-vs-Haiku
> comparison_ measured on the older 793-chunk corpus — read them for the model
> gap they show, not as current measurements.

| Answer model                | Date       | Groundedness                                    | Eval wall-clock | Notes                                                                                        |
| --------------------------- | ---------- | ----------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `claude-sonnet-5` (default) | 2026-08-10 | 25/25                                           | ~371s           | gate re-held (≥90%) 2026-08-11 on the amended prompt (#95/#98), ~379s, per-case not captured |
| `claude-haiku-4-5`          | 2026-08-11 | run 1: pass · run 2: **22/25 (88%, gate FAIL)** | ~255s / ~273s   | ~5× cheaper per output token                                                                 |

**Haiku is borderline at the gate.** Two back-to-back runs on the identical
corpus and prompt straddled it: the first cleared ≥90% (per-case table not
captured), the immediate re-run scored 22/25 with three unanimous
`[fail/fail/fail]` verdicts (`inscripcion-hacienda-clientes-extranjero`,
`iva-servicios-extranjero-comprados`, `exportacion-servicios-comprobante`) —
each a real over-claim beyond the cited fragments, not judge noise. This
replaces the 2026-08-06 conclusion ("the judge separates neither model"): on
a clean corpus the gate _does_ see a quality gap, and Sonnet 5 stays the
default on quality grounds, not just inertia. The 2026-08-06 numbers (7
questions short-circuited to the deterministic fallback by a polluted corpus)
should not be quoted.

## Coverage contract: tiers, required claims, abstention (issues #130, #261)

`expected` is a claim about **retrieval** — did the right artículo reach the
model? It says nothing about what the answer then did with it. Since #261 a
case also carries its place in the coverage contract of the #254 map:

```json
{
  "id": "ccss-cuanto-pago",
  "seed": "held-out",
  "question": "¿Cuánto es lo mínimo que se paga a la Caja como independiente?",
  "tier": 1,
  "family": "T1-F",
  "expected": [{ "docKey": "ccss-escala-salud" }],
  "requiredClaims": [
    {
      "claim": "la cuota del afiliado es 6,71 %",
      "literal": ["6,71 %", "6,71%"]
    },
    "la cuota se calcula sobre el ingreso de referencia declarado"
  ],
  "requiredSteps": ["dónde se declara y actualiza el ingreso de referencia"],
  "freshness": ["salarios-minimos"],
  "notes": "…"
}
```

- `tier` — `1` (the published beta promise), `2` (measured, not advertised) or
  `"abstain"`. Defaults to `2`, which is what every pre-#261 case is.
- `family` — `T1-A`…`T1-I`, the nine Tier 1 families of the coverage contract.
  **Required on tier 1**, and so are `requiredClaims`; `blocking` defaults to
  `true` there and may not be set to `false`. The parser refuses a tier 1 case
  that does not carry what makes it checkable, so the contract cannot be
  claimed without the evidence for it.
- `requiredClaims` — at most five short, verifiable things the answer must
  say. A bare string is judged; the object form with `literal` is **not
  judged** — it lists the accepted spellings of a figure or date, one of which
  must appear verbatim _and_ carry a `[n]` before its sentence ends. A number
  is either printed with a source beside it or it is not, and that needs a
  regex, not a model.
- `requiredSteps` — for a procedural case, the next steps the answer owes the
  reader (the portal, the form, the deadline).
- `abstainIf` — the condition that obliges a decline. **Required on an
  abstention case**, where it is what the abstention judge checks; optional
  elsewhere, where it documents the edge the case does not cover.
- `routeTo` — the institution or professional an abstention must name. Also
  **required on an abstention case**: the verdict has two halves, and without a
  named destination there is nothing to check the routing against.
- `freshness` — docKeys whose figures the answer depends on: the ones a decree
  cycle invalidates.
- `heldOut` — membership in the held-out set of #261 part B, and `variant` —
  which of `literal` / `coloquial` / `seguimiento` a Tier 1 case is. Both are
  in the schema for the same reason: a discipline nobody can enumerate is a
  discipline nobody keeps. See the next section.

An abstention case is the one kind with **no `expected` targets** — the point
is that no correct source exists — so the retrieval and groundedness lanes skip
it (`retrievalCases()`), and it is judged on whether it declined and routed.

### The adequacy gate (#130)

`src/lib/eval/adequacy.ts` is the second question the eval asks, and it is
deliberately independent of groundedness. Groundedness passes an answer that is
supported and incomplete — "sí, debe asegurarse en la CCSS", never saying what
the cuota is. Adequacy asks whether the answer contained what the reader came
for. Three checks, in ascending order of trust required:

1. `checkLiterals` — regex, no model, for every claim with `literal`.
2. `judgeAdequacy` — the pinned judge at temperature 0, one requirement at a
   time, for the prose claims and steps; same fail → re-judge → majority
   orchestration as the groundedness judge, so both gates behave the same way
   under flakiness.
3. `judgeAbstention` — "did it decline **and** route?", paired with
   `figureMentions`, the deterministic check that a refusal printed no invented
   colón amount or percentage.

The rule that gives the gate teeth is in none of the three: **a weak-retrieval
decline on a case that declares required claims is an adequacy failure**
(`declineAdequacy`). Groundedness passes that decline — it claims nothing — so
without the rule the honest fallback would be a way to score full marks on a
question the product promised to answer.

Thresholds: **tier 1 is per-case blocking** (100 %, no rate — a strong average
must never hide a red Tier 1 case), tier 2 is an aggregate
`ADEQUACY_TIER2_GATE` of 0.8. Both run inside `groundedness.eval.test.ts`,
which already has the answers, so the gate costs judge calls rather than a
second pass of the whole pipeline.

`src/lib/eval/adequacy.eval.test.ts` is the fixture that pins the behavior:
a hand-written CCSS answer, supported by its fragments and missing the rate,
**passes groundedness and fails adequacy** — with a complete version of the
same answer as the positive control, so a judge stuck on one verdict is
visible. It needs no database and no embeddings:

```sh
ANTHROPIC_API_KEY=<key> \
pnpm vitest run --disableConsoleIntercept src/lib/eval/adequacy.eval.test.ts
```

### The abstention lane (#261)

`src/lib/eval/abstention.eval.test.ts` runs the `"abstain"` cases through the
same production path and asks the binary question: did it decline, **and** did
it name where to go? Both routes are measured — the deterministic
weak-retrieval fallback and, when a question's vocabulary retrieves well
anyway, rule 6 of the answer prompt. Gate: correct abstention ≥ 90 %
(`ABSTENTION_GATE`), and **zero invented figures** (`figureMentions`), since an
answer with no fragments behind it that prints a colón amount or a percentage
made it up.

The nine held-out abstention cases landed with #261 part B, so the set is no
longer empty; the assertion that it is non-empty stays, because a check
asserting nothing is worse than a red one (#129).

### The held-out set (#261 part B, #254 §A5/§B8)

`expected` proves retrieval and `requiredClaims` proves adequacy, but both are
answers to questions **the author wrote after reading the corpus**. A suite
built that way measures whether the pipeline can find what its author already
knew was there. The held-out set is the other half: 48 cases written from the
demand evidence of #254 Part B — the words people actually type, «meterme en
Hacienda», «desde cuánta plata», «trabajitos por mi cuenta» — with targets
verified afterwards, and only for satisfiability.

`heldOut: true` marks them. The composition is asserted in
`src/lib/eval/held-out.test.ts` — the Tier 1 grid exactly, the other two blocks
as floors:

| Block   | Count | What it is                                                                   |
| ------- | ----- | ---------------------------------------------------------------------------- |
| Tier 1  | 27    | the nine families × `literal`, `coloquial`, `seguimiento` — exactly one each |
| Tier 2  | 12    | the adjacent questions of §B8, same evidence standard, no promise            |
| Abstain | 9     | out of scope, false premise, nonexistent figure, other institution           |

The three variants are the coverage claim itself. A family measured only in
its own vocabulary has not been shown to survive a reader's: `literal` is the
family's own question, `coloquial` the same need in demand vocabulary, and
`seguimiento` a follow-up that carries `history`, so it fails on condensation
(#132) rather than on retrieval. The Tier 1 grid is asserted as an **exact**
set while Tier 2 and abstention are floors, and the asymmetry is the point: a
further Tier 2 topic or abstention case only widens what is measured, but a
second variant of one family would quietly make the per-case blocking rule
mean something different for that family than for the other eight.

Two rules the set follows that are not visible in a case:

- **Held out means held out.** Nobody consults these cases while tuning
  retrieval, chunking or the prompt, until the #267 baseline is published.
  That is why the flag exists at all: a set nobody can enumerate is a set
  nobody can hold out.
- **A claim the corpus cannot support is not a claim.** Where §B4 asks for
  something the ingested excerpt does not carry — the crédito-fiscal effect of
  a tiquete, whether a pending debt blocks desinscripción — the edge is
  written into `abstainIf` instead of into `requiredClaims`. `abstainIf` on a
  Tier 1 case documents what the case does _not_ cover; inventing a required
  claim nothing can satisfy would just make the gate red forever and teach
  nobody anything.

Seven of the 27 Tier 1 cases were already in the file: the corpus issues that
unblocked this one (#258, #259, #260) added them from the same §B8 list, one
of them saying so in as many words. #261 part B promoted those in place rather
than writing near-duplicates, since a second copy of the same question would
have doubled the paid eval spend to measure the same thing twice.

**A flag cannot undo exposure.** Those seven have been in the retrieval suite
since the issues that wrote them, so they are members of the held-out set but
not first exposures of it, and a single held-out number over all 48 would claim
more than it measured. They stay identifiable by `seed` — a case written for
this set carries `held-out:<family>`, a promoted one keeps its original
provenance — and the split is pinned in `held-out.test.ts` so an edit cannot
quietly erase it. **#267 must report the two groups separately.** The 41 cases
that are first exposures are the ones that carry the argument:

| Case                                 | Family / variant | Added by |
| ------------------------------------ | ---------------- | -------- |
| `ccss-obligacion-ingreso-bajo`       | T1-B literal     | #258     |
| `ccss-cese-actividad`                | T1-H seguimiento | #258     |
| `ccss-pedir-prescripcion-cuotas`     | T1-G coloquial   | #260     |
| `ccss-ventana-prescripcion-24-meses` | T1-G seguimiento | #260     |
| `desinscripcion-dejar-actividad`     | T1-H literal     | #264     |
| `multa-iva-no-declarado`             | T1-I literal     | #259     |
| `inscripcion-tardia-sancion`         | T1-I coloquial   | #259     |

The other 41 cases are new here. The corpus-vocabulary cases that ask the same
questions in the corpus's own words (`iva-clientes-fuera-cr`,
`ccss-asalariado-y-freelance`, `renta-tramos-2026` and the rest) stay exactly
where they are: they are the retrieval regression suite, and retiring them to
save eval spend would trade measured coverage for a smaller bill.

One §B8 proposal did not survive verification. The Tier 2 «D-270» case has no
official source in the corpus, and a case whose target no chunk can satisfy
fails the satisfiability lane by construction — so that slot went to
«¿Cómo saco la constancia de que estoy al día con Hacienda?», the same §B4
Tier 2 need (TRIBU-CR situación tributaria) with a source behind it.

Two abstention cases are expected to expose a real gap rather than pass:
«¿Cuánto debería cobrar por hora…?» and «¿Qué contador me recomienda?» match
no institution keyword in `classifyRouting`, so today they take the default
decline and route to Hacienda and the CCSS — which is not where either reader
should be sent. Their `routeTo` names the honest destination anyway. Writing
the destination the product currently produces would have made the case pass
by describing the bug.

### The citation invariant, at eval time (#168)

The harness used to bypass `validateCitations` entirely: an answer citing
nothing — which `/api/ask` retries and then refuses to ship (#131) — could
score a groundedness pass here. `groundedness.eval.test.ts` now runs the same
runtime check over every generated answer and prints the violations. Until the
2026 baseline it was asserted on blocking cases only and reported for the
rest, because a number nobody has measured is not a gate; #267 measured **0
violations over 73 answers**, so it is now asserted on every case.

### A figure in a table, and its citation (#289)

Prompt rule 11 (rule 10 until #289's rule 9 landed) tells the answer to use a markdown table «cuando los datos sean
realmente tabulares, como tramos, plazos o montos» — exactly the figures
`checkLiteral` scores — and an answer that does so cites the table around it,
not inside every cell. A table row ends in a newline and the citation window
stopped at the first newline, so a figure in a cell could **never** be scored
as cited, however well the answer cited its table: the prompt asked for tables
and the check forbade them. A smoke run on `ho-800-mil-que-porcentaje-caja`
caught it — the model printed the whole IVM escala as a table with `[6]` in the
caption beneath.

The window for a figure whose line is a table row now runs to the end of the
table plus its closing sentence. The widening is scoped to figures _inside_ a
table: a figure in ordinary prose keeps the sentence window, so a cited table
cannot vouch for the uncited paragraph above it, and a table nothing cites
still scores uncited.

### The run transcript (#289)

The 2026 baseline printed, for every inadequate case, the requirements the
judge did not find — and that table can never say _why_ one is missing. The
three causes look identical in it: the answer omitted something the fragments
carried, the fragment carrying it was never in the top-8, or the requirement
over-specifies what the corpus supports («a claim the corpus cannot support is
not a claim»). Classifying #267's 29 adequacy failures therefore meant paying
for a second run.

So `groundedness.eval.test.ts` now writes one JSONL row per case to
`eval/transcripts/groundedness-<answer model>-<instant>.jsonl` — the condensed
query, the answer, the chunk list **numbered as the prompt numbered it** (so a
`[n]` in the answer indexes straight into it), the derived figures, and all
three verdicts with their missing requirements. `EVAL_TRANSCRIPT_DIR`
overrides the directory.

It is reporting only: no gate reads it, a write failure is logged rather than
raised, and the directory is gitignored. `eval.yml` uploads it as the
`eval-transcripts` artifact with `if: always()` — a red run is exactly the one
whose answers someone needs to read.

### `EVAL_CASES` — the cheap read (#289)

The transcript is only half of what makes a classification affordable; the
other half is not paying for 73 answers to read four. `EVAL_CASES` takes a
comma-separated list of case ids and scopes the run to them:

```
EVAL_CASES=ho-donde-me-afilio-caja,ho-hasta-que-dia-tengo-iva \
  pnpm vitest run --disableConsoleIntercept src/lib/eval/groundedness.eval.test.ts
```

Same production answer path, same judges, same transcript — for cents instead
of ~US$10 and half an hour. It exists because the 2026 baseline was classified
twice from the printed table alone and was wrong both times in the same way:
`caseHit` is true when _any one_ expected target matches, and the missing
requirement usually lives in a different chunk, so "retrieval hit" was read as
"the fragment was in front of the model" when it was not. The correction came
from a four-case run costing cents whose script was never committed, and was
therefore gone by the time the next session needed it.

What a subset run must never be is a cheap route to a green gate — a rate over
73 cases cannot be read off six of them, and "tier 1 27/27" from a subset is
worse than no number. Two things prevent it, both loud:

- **every gate fails** while `EVAL_CASES` is set, naming the scope. That is
  #129's rule applied to a paid lane: a required check that silently asserts
  nothing is the failure mode the gate exists to prevent. The per-case tables
  and the transcript still print — they are the point of the run.
- **the transcript filename carries `subset`**
  (`groundedness-<model>-subset-<instant>.jsonl`), so a scoped file cannot be
  mistaken a week later for the full run it sits beside.

An id that matches no case throws **before the first paid call**: a typo that
silently selected zero cases would print an empty table and spend the money
anyway.

### The six-case read, and what it corrected (#289)

The first thing `EVAL_CASES` bought: six Tier 1 cases through the production
answer path on the post-#286/#287/#296 retrieval, and a transcript to read.
Five that had failed for reasons the printed table could not tell apart, plus
the one the earlier smoke run had flipped to pass.

| Case                                     | Adequacy | Where the missing requirement lives                                                                                        | In the top-8?                                      |
| ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `ho-hasta-que-dia-tengo-iva`             | **pass** | —                                                                                                                          | —                                                  |
| `ho-trabajitos-por-mi-cuenta`            | fail     | `tribu-cr-faq` RUT ·1–7, `reglamento-renta` art. 27                                                                        | no — all eight chunks were CCSS                    |
| `ccss-pedir-prescripcion-cuotas`         | fail     | `ccss-prescripcion` «¿…en cuanto tiempo resuelve la Administración?» — the 20 días hábiles, verbatim                       | no (three _other_ `ccss-prescripcion` chunks were) |
| `ho-donde-me-afilio-caja`                | fail     | `ccss-faq` «¿Cuándo me corresponde pagar mi seguro de Trabajador Independiente?» — «según la primera letra de su apellido» | no (five _other_ `ccss-faq` chunks were)           |
| `ho-desinscribir-debiendo-declaraciones` | fail     | `cnpt` arts. 78/79 — the 50 % salario base                                                                                 | no                                                 |
| `ho-800-mil-que-porcentaje-caja`         | fail     | `ccss-reglamento-ti` art. 10 (cuotas sobre ingresos **netos**) and art. 12 (ajuste, primeros 3 días hábiles del mes)       | no (arts. 1, 6 and 15 were)                        |

**Every one of the five failures is retrieval, and not one is an answer
omission.** In each case the missing fact is in the corpus, was absent from the
top-8, and the answer behaved correctly on what it was handed —
`ho-desinscribir-debiendo-declaraciones` declined outright rather than invent
the sanction it was never shown, which is prompt rule 8's subordination clause
working as written.

The shape is the same every time and it is worth naming, because it is what
made the first classification wrong: **the right _document_ was retrieved and
the wrong _chunk_ of it.** Three `ccss-prescripcion` chunks and not the fourth;
five `ccss-faq` chunks and not the sixth; three `ccss-reglamento-ti` artículos
and not the two that answer the question. `caseHit` is true when any one
expected target matches, so all of these read as "retrieval hit" in the
baseline table — which is exactly why #267's 19 "answer omission" cases were a
guess. Five of those 19 have now been read; **five for five, the cause is
retrieval.** The remaining 14 are still unread, and one more `EVAL_CASES=` over
them settles it.

The literal checks are the counter-example that makes the read trustworthy. On
`ho-800-mil-que-porcentaje-caja` all four figures now score **present and
cited** — the separator fix and the table-cell citation window, both landed
blind in #294, are confirmed working against a real answer. It is also the
limit of a deterministic check, stated so nobody counts the case as closer than
it is: `6,24 %` passed on a table the answer dumped in full while the prose
underneath says it _cannot_ place ¢800.000 in a category, because
`salarios-minimos` was not retrieved either. The figure was printed and cited;
the claim was never made.

**A corpus defect surfaced on the way**, contributing to that same case but not
the cause of it. Its top-8 spent **two of eight slots** on one `ccss-faq`
entry — «¿Cuál es el porcentaje de cotización … y cómo se determina el ingreso
de referencia?», ingested twice under two section paths — whose body is a source
line, a nota explicativa and a link to `av_tv_2026.png`. **The answer is an
image.** Four `ccss-faq` bodies are image-only in this way and four are
near-duplicates across sections; both are ingestion work, filed separately as
#301 (fixed: the images are transcribed in the manifest and the extractor keeps
one chunk per body).

### Presentation is not presence: A3 moved to the deterministic owner (#289)

`ho-minimo-caja-independiente-2026` carried a fifth required claim — «el monto
en colones es una derivación de esas cifras y debe presentarse como tal, no
como un dato tomado de una fuente». It asks about **presentation**, and
`ADEQUACY_SYSTEM_PROMPT` tells the judge to score **presence** ("does the
answer actually state it?"), so the requirement could only ever be met by
accident.

The property is real and already has a deterministic owner:
`incompletelyCitedDerivedFigures` (#263/#281), which `/api/ask` enforces at
runtime — one retry, then the honest decline. The claim is therefore removed
from the case and the eval asks the question directly instead, over **every**
answer that resolved a derived figure rather than only F1: "ships no answer
whose derived figures are incompletely cited". The eval now enforces what
production already refused to ship.

### The decimal separator, on both sides of a literal check (#289)

The CCSS actas print every rate with a period — `2.89%`, `6.24%`, `0.9295 SM`
— and prompt rule 3 forbids the model from rewriting a figure it was handed.
The dataset writes the same rates the Spanish way, with a comma. Until #289
`checkLiteral` compared them character for character, so an answer quoting the
acta faithfully scored **absent** on a claim the corpus fully supports: five
of them in the 2026 baseline, across `ho-minimo-caja-independiente-2026` and
`ho-800-mil-que-porcentaje-caja`. That measured transcription, not adequacy.
A `.` or `,` standing between two digits is now normalized on both sides,
exactly as the non-breaking space already was. Digits still have to match, and
a period that is not between digits stays a sentence end — the citation window
depends on it.

### The right document, the wrong chunk — measured (#303)

The six-case read above settled that five Tier 1 adequacy failures were
retrieval, and named the shape: the right document, the wrong chunk of it.
Issue #303 turned that into a hypothesis — the reranker lets one FAQ page take five
of eight places with its most question-_like_ entries while the entry that
answers the required step ranks 9th to 15th — and three candidate fixes,
cheapest first: a per-document cap with backfill, a step-shaped expansion leg,
and `ANSWER_TOP_K` 8 → 10. The rule was measure, don't argue, and the
measurement did not confirm the hypothesis.

**The cap.** `ANSWER_DOC_CAP=n` keeps at most _n_ chunks of one `docKey` in
the answer set while other documents can still fill it, in rank order, and
backfills from the deferred chunks when they cannot — one long artículo split
in parts, alone in the pool, still fills the set. It is a pure post-rerank
filter in `answerSetFromOrder`, so the route and both harnesses cut the same
way, and `rerank.test.ts` pins it. Since #303 `EVAL_CASES` scopes
`retrieval-hitrate.eval.test.ts` too, with the same gates-fail-on-subset rule,
so a retrieval knob can be read on the cases it was written for.

On the six cases — the first row is #300's read above, the other two are
new `subset` transcripts in `eval/transcripts/`:

| Run                       | Hit-rate | Adequacy | What moved                                                |
| ------------------------- | -------- | -------- | --------------------------------------------------------- |
| top 8, cap off (pipeline) | 6/6      | 1/6      | —                                                         |
| top 8, cap 3              | 6/6      | 1/6      | nothing that a judge could see                            |
| top 10, cap off           | 6/6      | 2/6      | `ccss-pedir-prescripcion-cuotas` passes; F's "base" claim |

The reason the cap moved nothing is in the full reranked orders, which the
hit-rate run prints only for a miss and `caseHit` never sees. Where the chunk
that carries the missing requirement actually sat:

| Case                                     | Chunk that carries it                                    | Reranked rank       | What cap 3 did                                     |
| ---------------------------------------- | -------------------------------------------------------- | ------------------- | -------------------------------------------------- |
| `ccss-pedir-prescripcion-cuotas`         | `ccss-prescripcion` «¿…en cuanto tiempo resuelve…?»      | **#9**              | nothing — the top-8 held 3 / 3 / 2, nothing over   |
| `ho-donde-me-afilio-caja`                | `ccss-faq` «¿Cuándo me corresponde pagar…?»              | **not in the 40**   | nothing                                            |
| `ho-800-mil-que-porcentaje-caja`         | `ccss-reglamento-ti` art. 10 · art. 12                   | **#10** · not in 40 | pushed art. 10 _out_ — its document's fourth chunk |
| `ho-desinscribir-debiendo-declaraciones` | `cnpt` arts. 78/79                                       | **not in the 40**   | nothing                                            |
| `ho-trabajitos-por-mi-cuenta`            | `tribu-cr-faq` RUT · `reglamento-renta` 27 · `ley-iva` 5 | #30 · #13 · #12     | let 27 and 5 in; neither names the RUT step        |

Three of five are **pool** misses, not cut misses: the chunk was never among
the 40 the reranker read. Those are step-shaped claims — when to pay, what the
sanction is, how to adjust a declared figure — semantically far from the
question that was asked, which is why neither the question's legs nor the
corpus-register rewrite reach them. One is a top-k miss at #9, which the cap
cannot touch and top 10 reaches. One the cap made worse.

**The step-shaped leg** was prototyped before being built into
`search_chunks`: the expansion model was asked, in a separate call, to write
the official text answering "the step the reader will need next", and that
probe was retrieved on alone. Haiku either rewrote the question again or
copied the prompt's worked example verbatim, and the probe's own pool carried
the needed chunk at ranks 6–32 or not at all. Not viable as one leg on the
current model, so it was not built; the prompt and the numbers are in the
thread of #303.

**The 14 unread Tier 1 cases** — the rest of #267's "answer omission" rows —
were then read on the pipeline of record (top 8, cap off):
groundedness 13/14, adequacy **2/14** (`ccss-ventana-prescripcion-24-meses`,
`ho-tambien-asegurado-por-patrono`). The missing requirements of the twelve,
located in each case's reranked order:

| Where the carrying chunk sat       | Requirements | Cases (examples)                                                                                                                                                              |
| ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **in the top-8** — answer omission | 12           | `ho-tiquete-en-vez-de-factura` art. 9 at #4; `ho-rebajar-multa-si-pago-ya` art. 88 at #1; `ho-minimo-caja-independiente-2026` 0,9295 and 2,89 % at #4                         |
| **ranks 9–12** — top-k miss        | 3            | `ho-desde-cuanta-plata-caja` 0,87 SM at #10; `ho-tiquete-en-vez-de-factura` RUT at #10; `ho-minimo-caja-independiente-2026` ¢373.092,30 at #11                                |
| **ranks 13–40** — deep in the pool | 5            | `ho-cliente-espana-lleva-iva` exención at #17; `ho-ademas-tengo-salario` pagos parciales at #25                                                                               |
| **not in the 40** — pool miss      | 6            | `cnpt` 79 for `desinscripcion-dejar-actividad` and `ho-iva-en-cero-sin-facturar`; `cnpt` 88 for `multa-iva-no-declarado`; the TRIBU-CR step for `ho-rebajar-multa-si-pago-ya` |

So #289's "five for five, the cause is retrieval" was true of the five it read
and is not the rule. Of the 41 missing requirements on the twelve, 18 are the
answer **not stating a claim whose chunk it was handed**; of the 23 that are
retrieval, 20 are pool depth — 12 deep in the 40, 8 absent from it — and only
3 are the cut between #8 and #12. The per-document cap addresses none of the
three buckets. What the numbers point at instead, in order:

1. `ANSWER_TOP_K=10` is the one knob that gained a case on the six and reaches
   three more requirements on the fourteen; it costs prompt length on every
   ask and is the leading candidate for the authorized full run.
2. The pool misses are all step-shaped claims the dataset requires of a
   complete answer and the question never asks for. Reaching them needs a leg
   that searches for the step, and the prototype says the current expansion
   model cannot write one unaided; a catalogue of steps per `family` written
   by hand, not by a model, is the next thing to measure.
3. The answer omissions are the #130 answer side — prompt, not retrieval —
   and are out of #303's scope.

Tier 1 stays per-case blocking and `ADEQUACY_TIER2_GATE` stays 0.8. The
cap ships off; `ANSWER_DOC_CAP` is there for the full run to measure beside
`ANSWER_TOP_K`, which is the comparison this read could not afford.

### The pool misses are step-shaped — a hand-written step catalogue per family (#304)

#303 left the pool misses named and unaddressed: of the 23 retrieval-caused
missing requirements on the nineteen Tier 1 rows, 20 were pool depth, and the
chunks absent from the 40 all carry a **step** a complete answer needs and the
question never asks for — when to pay, what the sanction is, how to adjust a
declared figure. Nothing in the question points at them, so neither its own
legs nor its corpus-register rewrite find them, and #303's prototype showed the
expansion model cannot be asked to guess them either.

The steps are not open-ended: the dataset's nine Tier 1 families name them, and
a family's steps are the same whichever of its questions is asked. So they are
written by hand — `eval/step-catalogue.json`, two or three sentences per family
in the corpus's own register, beside the cases they were written for and the
chunks they are meant to reach — and `src/lib/answer/steps.ts` does two
deterministic things with them: `classifyFamily`, a keyword table over the
condensed question in the `classifyRouting` shape (no model, no cost, `null`
when nothing in the question names a family), and the probe `retrieve` then
runs. `pnpm pool-dump` prints the family and the two new leg ranks (`sv`/`sl`);
`--no-steps` switches them off, as `STEPS=off` does everywhere.

**Three things the measurement decided**, in the order it decided them:

1. **One probe per sentence, not one text.** Step 1 of the issue — `retrieve`
   on the catalogue text alone, expander off — carried «¿Cuándo me corresponde
   pagar…?» at pool #17 and `cnpt` art. 79 not at all when the three sentences
   were one string; each sentence alone carried its chunk at **vector rank 1**.
   So `search_chunks` v6 takes `step_texts[]`/`step_embeddings[]` and searches
   them one by one: each sentence's own 50 nearest chunks and 50 best lexical
   matches, interleaved by **best rank in any sentence's list** into one leg
   pair of 50 — a catalogue of three sentences weighs what one expansion
   weighs. Not "nearest by distance across sentences": distances are not
   comparable between sentences, and the first cut that merged them that way
   still left `cnpt` 79 outside the leg behind one sentence's fifty nearest.
2. **Each sentence in the words of its chunk, one step per sentence.** The
   first draft's `cnpt` 79 sentence carried a second clause («las
   declaraciones pendientes se presentan antes de la desinscripción»), fell to
   the lexical OR branch, lost that chunk to longer artículos, and reached the
   fused pool at **#49** on its vector leg alone. Rewritten to mirror art. 79,
   it wins the strict AND branch (lexical rank 1) and enters the pool at #14.
3. **Pinned past the cut, not fused by max.** The issue asked for the probe as
   one more rerank query fused by max (#296), and that was measured first on
   the #303 six (`STEPS_RERANK=max`): the step chunks reach reranked #1–#3, and
   the question's own chunks move down to make room — the F case's escala
   chunks from #3/#4 to **#8/#9**, the H case's `reglamento-renta` 27 from #7
   to **#21**, the A case's `ley-iva` 5 from #14 to #19. A required step in
   front of the model at the price of the claim the question was about is not
   a trade the adequacy gate can take. So the six were read under **`pin`**:
   the question's readings decide the order and the cut exactly as before, and
   the best chunk of each sentence's reading is appended past it when the cut
   did not already take it — the #287 shape, one append per sentence, only on
   an ask that classified to a family. The authorized full run below then
   decided the shipped default (`off`); `STEPS_RERANK=pin|max` stay measurable.
   The catalogue's legs are no witness to corroboration either
   (`isCorroborated`, #307): the probe is the same text for every question in
   the family, so it can fill a pool and never move `isWeak`.

On the #303 six, `EVAL_CASES` hit-rate runs (`steps=off` is the pipeline of
record; the `pin` and `max` rows share one pool, so the pool ranks are one
column):

| Case                                     | Chunk that carries the missing requirement          | Pool, steps off | Pool, steps on | Reranked, off → pin   | Reranked, max |
| ---------------------------------------- | --------------------------------------------------- | --------------- | -------------- | --------------------- | ------------- |
| `ccss-pedir-prescripcion-cuotas`         | `ccss-prescripcion` «¿…en cuanto tiempo resuelve…?» | #26             | **#3**         | #9 → **#8, top**      | #2            |
|                                          | `ccss-prescripcion` «¿Dónde presento la solicitud?» | #31             | **#4**         | #15 → #15, **pinned** | #1            |
| `ho-donde-me-afilio-caja`                | `ccss-faq` «¿Cuándo me corresponde pagar…?»         | not in the 40   | **#10**        | — → #39, **pinned**   | #3            |
| `ho-desinscribir-debiendo-declaraciones` | `cnpt` art. 79                                      | not in the 40   | **#14**        | — → #39, **pinned**   | — (pool #49)  |
|                                          | `tribu-cr-faq` RUT · 43                             | not in the 40   | **#10**        | — → #28, **pinned**   | #8            |
| `ho-800-mil-que-porcentaje-caja`         | `ccss-escala-salud` / `ccss-escala-ivm` (the claim) | #8 / #1         | #6 / #1        | #3 / #4 → **#3 / #4** | #8 / **#9**   |
| `ho-trabajitos-por-mi-cuenta`            | `ley-iva` 5 · `reglamento-renta` 27                 | #8 · #24        | #11 · #24      | #14 · #15 → #14 · #15 | #19 · #20     |
| `ho-hasta-que-dia-tengo-iva`             | `ley-iva` 27 · `reglamento-iva` 40                  | #1 · #3         | #1 · #2        | #2 · #1 → #2 · #1     | #1 · #2       |

Hit-rate 6/6 → 6/6 in every mode. Under `pin` not one question-side reranked
rank moved except the G case's #9 → #8 (a pool change the reranker read), and
every chunk the issue named as a pool miss is now in front of the model. The
`max` column's pool ranks are those of a run before the catalogue was tightened
(item 2), which is why its `cnpt` 79 reads #49.

The same six through the answer path (`EVAL_CASES`, transcript
`groundedness-claude-sonnet-5-subset-20260907T162517Z.jsonl`): groundedness
6/6, adequacy **2/6** — against 1/6 on the pipeline of record and 2/6 with
`ANSWER_TOP_K=10` (#303). `ccss-pedir-prescripcion-cuotas` passes: the 20 días
hábiles chunk is in the top-8 and «¿Dónde presento…?» is pinned behind it.
The four that still fail now fail on the **answer side**: the transcript shows
«¿Cuándo me corresponde pagar…?» and art. 10 handed to the B answer, arts.
10 and 12 and the patrono FAQ to the F answer, `cnpt` 79, RUT · 43 and the
CCSS cese FAQ to the H answer, RUT · 1 and `cnpt` 78 to the A answer — and the
missing requirements are the model not stating what it was handed (the B
payment date, the F adjustment, H's «mientras siga inscrita»), which is #130's
prompt matter and not this issue's. What #304 set out to do — the step chunk
in the pool and in front of the model — holds on every case it named.

**The whole dataset**, hit-rate only (`retrieval-hitrate.eval.test.ts`, no
subset, `steps=on(pin)`): **71/73**, every gate green — against 70/73 at #296.
The two misses are the Tier 2 corpus cases #296 left (`ho-t2-constancia-al-dia`
never reaches the pool; `ho-t2-payoneer` is cut at pool #14); the third #296
miss is recovered.

#### The authorized run, and what it decided

Step 3 of the issue: the full eval lane, answer model and judge, same day,
same corpus, three configurations. Transcripts were written to `eval/transcripts/`:
`groundedness-claude-sonnet-5-20260908T004108Z.jsonl` (pin),
`…T011235Z.jsonl` (`STEPS=off`), `…T040740Z.jsonl` (the shipped default).

> **These three files no longer exist.** `eval/transcripts/` is gitignored and
> worktree-local, and #304's worktree was removed after #310 merged, taking
> them — and #303's `…T162517Z` — with it. The tables in this section are what
> survives, and they are enough for a gate-level comparison; what is gone is
> the per-case evidence, the answers themselves and the judges' reasons. Work
> that needs to _read_ those rows (#289's answer-side omissions, #288's two
> named failures) has to re-run — one full run, ≈US$5.50. Copy a transcript to
> the main checkout before removing a worktree (CLAUDE.md, Worktrees).

| Gate (73 cases)                  | `STEPS=off`  | `STEPS_RERANK=pin` | `STEPS_RERANK=off` (shipped) | Gate            |
| -------------------------------- | ------------ | ------------------ | ---------------------------- | --------------- |
| Hit-rate                         | 70/73 (#296) | **71/73**          | **71/73**                    | ≥ 0.92, pass    |
| Groundedness                     | **71/73**    | 67/73              | **71/73**                    | ≥ 0.94          |
| Adequacy, cases with claims      | 15/40        | **18/40**          | 16/40                        | Tier 1 per case |
| Tier 1 adequate                  | 3/27         | **5/27**           | 5/27                         | 27/27, fails    |
| Tier 2 adequate                  | pass         | pass               | pass                         | ≥ 0.8           |
| Abstention                       | 3/7          | 3/7                | —                            | ≥ 0.9, fails    |
| F1 (`ccss-cuanto-pago-base`) BMC | fail         | fail               | fail                         | —               |

`pin` bought three adequacy cases and one hit-rate case and cost **four
groundedness cases**, all unanimous, and with them the 0.94 gate:
`inscripcion-tardia-sancion` cites «[81 referenciado en 5]» where [5] _is_
art. 81; `ho-rebajar-multa-si-pago-ya` cites [7] for the 50 % sanction that
lives in [6]; `multa-iva-no-declarado` turns three omissions into three
separate fines the fragments do not state; `ho-trabajitos-por-mi-cuenta`
over-reads who may affiliate voluntarily. The shape is what pinning does: ten
or eleven fragments with overlapping content (`cnpt` 78, 79 and 81 side by
side) and the answer mis-indexes them. Abstention and F1 are unchanged by the
catalogue — F1 fails on both because `salarios-minimos` sits at pool #97 /
#72 either way (`PIN_DERIVED_INPUTS` is off by default), a pre-existing miss
this run happened to surface.

So the shipped default is **`STEPS_RERANK=off`**: the catalogue fills the pool
— every named step chunk now in the 40 — and the question's own readings
decide what reaches the model, so the answer set is exactly what #296
shipped in size and shape. Confirmed on its own full run: groundedness 71/73
and hit-rate 71/73 with every gate the baseline holds, adequacy 16/40 and
Tier 1 5/27 against the baseline's 15/40 and 3/27 — the two G cases whose
step chunk (the 20 días hábiles) the reranker now reaches from the pool. A
step in the prompt at the price of the release gate does not ship. The follow-up measured pinning **one** chunk per ask
rather than one per sentence (#311, «One step pick, not one per sentence»
below).

The `STEPS_RERANK=max` reading is also why the classifier is conservative:
every ask that classifies pays one rerank call per sentence and up to three
more chunks of prompt, so a family is named by what is _specific_ to it and a
question naming nothing specific gets no probe rather than a guessed one.
`steps.test.ts` pins the catalogue's shape (every family, two or three
sentences, cases that exist and carry that family, `reaches` entries the
committed corpus index holds) and the classifier on every single-turn Tier 1
question; follow-ups classify on their condensed form, which the hit-rate run
prints beside the dataset's family (`⊕ steps=T1-B (dataset T1-B)`) with every
target's pool rank, reranked rank and place — `top`, `pinned` or `cut` — since
`caseHit` alone cannot say whether a required step's chunk was in front of the
model. The targets printed are the dataset's `expected` **and** the classified
family's catalogue `reaches` (marked `(catálogo)`), because the chunk a required
step needs is often in neither `expected` nor `requiredSteps` by name — art. 12
for the F case — and this line is where its rank is read.

### The derived figure's second input was never in the pool (#312)

`groundedness.eval.test.ts › answers F1 with both BMC figures and citations to
every input` failed identically under all three of #304's configurations, with
the same message — `bmc-ivm-2026 was not resolved from the answer chunks`. Three
runs that differ in the catalogue and in the rerank agreeing to the character is
not a catalogue result and not a cut result: it is the **pool**. F1's answer is
0,87 SM and 0,9295 SM × ¢373.092,30, and the ¢373.092,30 lives in one chunk —
`salarios-minimos` art. 1, «Ocupaciones Genéricas por Mes: Trabajadores en
Ocupación No Calificada» — which no leg of «¿Cuánto pago a la CCSS?» looks for.
The reader asks what they pay; the decree that fixes the wage is a word they
never say.

`pnpm pool-dump` could not show that, because it printed the top of the pool and
the rank of the **first** target found: a case whose escala sits at #6 reads
healthy while its second input sits at #122. It now ends every case with each
expected target's own fused rank, and `--pool=<n>` widens the fused depth past
`RERANK_POOL` to find one nowhere near it. That is how the numbers below were
read (`--pool=300`, one embed and one expansion per case, no rerank and no
answer model).

The fix is the #304 shape: one more catalogue sentence, written in the words of
the chunk it must reach, added to **T1-B and T1-F** — the two families whose
questions resolve a BMC. It is the decree's own table line, and it is a _fourth_
sentence rather than a replacement because each of the three steps it joins
still carries a chunk of its own; `steps.test.ts` now pins two-to-four. It is
also the first catalogue entry that is not a step: it names the **input of a
figure the answer derives** rather than quotes, which is the same shape of
absence — something a complete answer needs and the question never asks for.

Fused rank of `salarios-minimos` art. 1, before and after (`--pool=300`):

| Case                                | Family | Before   | After   |
| ----------------------------------- | ------ | -------- | ------- |
| `ccss-cuanto-pago-base`             | T1-F   | **#122** | **#19** |
| `ho-minimo-caja-independiente-2026` | T1-F   | #46      | **#11** |
| `ho-desde-cuanta-plata-caja`        | T1-B   | #63      | **#4**  |
| `ho-800-mil-que-porcentaje-caja`    | T1-F   | #130     | **#13** |
| `ccss-obligacion-ingreso-bajo`      | T1-B   | #88      | **#5**  |

In the 40 on every case that needs it. What it costs, over every case the
classifier sends to T1-B or T1-F (the RRF sum is shared, so a probe can push a
chunk down): **no expected target left the 40**. `ccss-cuanto-pago-base`'s
`ley-10363` art. 1 fell #42 → #67, already outside it before this change;
`ho-desde-cuanta-plata-caja`'s `ccss-reglamento-ti` art. 1 fell #10 → #23 and
`ccss-obligacion-ingreso-bajo`'s #2 → #10, both still well inside; the escalas
moved by one or two places either way. `iva-retencion-tarjetas-porcentaje`,
`ho-donde-me-afilio-caja` and `ho-tambien-asegurado-por-patrono` are unmoved.
Read those single-place moves as noise, not signal: the expansion is model
text, so two runs of the same case differ by a place or two on their own.

#### The pool is half of it: the pin is the other half

Being in the 40 is not being in front of the model. The reranker reads the
salary decree as an answer to a salary question, not to «¿cuánto pago?», and
cuts it every time — reranked #32, #36, #38, #40 on the five cases above. So
the catalogue alone changes nothing the reader sees, and `PIN_DERIVED_INPUTS`
(#287) is what carries it the rest of the way: when one input of a figure
survived the cut, the missing ones are appended **from the fused pool the
reranker just read** — which is exactly the pool this change fixed. That is why
the #304 run recorded the pin as unable to help: it pins from the pool, and the
chunk was not in it.

Measured deterministically over every single-turn case in the dataset — retrieve,
rerank, then resolve the figures with the pin off and on, no answer model and no
judge, so it costs an embed and a rerank per case:

| Case                                | Pin off            | Pin on                                                                    |
| ----------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `ccss-cuanto-pago-base`             | no figure resolves | `bmc-sem-2026`, and `bmc-ivm-2026` when `ccss-escala-ivm` holds its place |
| `ho-minimo-caja-independiente-2026` | no figure resolves | `bmc-ivm-2026` + `bmc-sem-2026`                                           |
| `ho-800-mil-que-porcentaje-caja`    | no figure resolves | `bmc-ivm-2026` + `bmc-sem-2026`                                           |
| `ho-desde-cuanta-plata-caja`        | no figure resolves | `bmc-sem-2026`                                                            |
| every other case                    | unchanged          | **unchanged — the pin never fires**                                       |

That last row is the measurement ADR 0018 asked for and could not get: the risk
it named is that the pin matches on source identity, not question relevance, so
«an artículo that survived some unrelated question can pull its figure's
siblings in behind it». Over the whole dataset the append fires on exactly four
cases, all four of them cases whose `expected` already names `salarios-minimos`
art. 1, and adds exactly one chunk to each. No unrelated answer moves.

So the pin **stays off** here. The ADR's bar is groundedness, adequacy and
abstention on an authorized full run, and no deterministic probe can read those.
What this change buys the next such run is that the comparison is now worth
making: before it, `PIN_DERIVED_INPUTS=on` and `off` produced the same answer
set on F1.

#### What the scoped run then found: the prompt never stated the rule

`EVAL_CASES=ccss-cuanto-pago-base ho-minimo-caja-independiente-2026
ho-desde-cuanta-plata-caja` with `PIN_DERIVED_INPUTS=on`, transcript
`groundedness-claude-sonnet-5-subset-20260908T054807Z.jsonl`. F1 is grounded
(`pass`), and both figures resolve: `salarios-minimos` art. 1 is chunk [9],
`ccss-escala-ivm` [8], `ccss-escala-salud` [4]. The retrieval half of the issue
is done — `bmc-ivm-2026 was not resolved from the answer chunks` no longer
happens.

The F1 assertion still failed, on its last clause. The answer wrote

> Para 2026, la BMC de IVM es de ¢324.590 y la BMC de Salud (SEM) es de
> ¢346.789 `[8][9]`.

— two figures in one sentence, carrying the union `{8, 9}` when
`bmc-sem-2026`'s inputs are `{4, 9}`. `incompletelyCitedDerivedFigures` refuses
that, and so does `route.ts` at runtime: one retry, then the honest decline. The
model was never told. `formatDerivedFigures` said only «puede citar estos
resultados tal como aparecen; no los recalcule», and the per-figure markers were
sitting in the block for the model to read as decoration. It now states the rule
the validator enforces: the sentence quoting a figure must carry all of that
figure's markers, and a sentence quoting two must carry both sets. On the re-run
(`…T055016Z.jsonl`) F1 is grounded and `bmc-sem-2026` comes back completely
cited, `incompletas: []`.

#### What is left, and it is not the pool

`bmc-ivm-2026` needs `ccss-escala-ivm` in the answer set for the pin to consider
the figure at all — the append is deliberately not chained (#287), so
`salarios-minimos` arriving for the SEM figure does not make it available to the
IVM one. And `ccss-escala-ivm` sits at reranked **#8, #9, or outside the cut
entirely** on F1 depending on the run's expansion: it resolved on the first
scoped run, and on the re-run it was not in the answer set at all. So F1 still
fails intermittently, now on one chunk one place either side of `ANSWER_TOP_K`.

That is a rerank-cut cause, not the pool cause this issue diagnosed, and it is
the same knob question #303 left open (`ANSWER_TOP_K=10` bought two adequacy
cases there). It is not decided here for the reason none of these knobs are
decided outside a full run. It is what the next authorized run should watch on
F1, beside the pin.

##### `ANSWER_DOC_CAP` is not that knob — measured, and rejected

The obvious cheap idea is to take the place from redundancy rather than buy it
with a wider top-k. F1's eight places go four to `ccss-reglamento-ti`, three to
`ccss-faq`, and two of those three to chunks of the _same_ FAQ artículo, while
`ccss-escala-ivm` — the only chunk in the corpus stating 0,87 — misses the cut.
`ANSWER_DOC_CAP` (#303) exists for exactly that shape and is still unmeasured.

Measured the same deterministic way (retrieve, rerank, cap, pin, resolve; every
single-turn case; no answer model, no judge), counting every expected target
present in the answer set:

| Cap                 | Expected targets | Derived figures |
| ------------------- | ---------------- | --------------- |
| off (shipped)       | **104/157**      | 7               |
| `ANSWER_DOC_CAP=2`  | 95/157 (**−9**)  | **11**          |
| per-artículo, cap 1 | **105/157**      | 7               |
| per-artículo, cap 2 | 104/157          | 7               |

The document cap does buy the figures and F1's second BMC. It pays nine
expected targets for them, and the reason is that the premise was wrong: four
`ccss-reglamento-ti` chunks are four _different artículos_ — 1, 6, 10, 15 —
each carrying a different rule, not four copies of one. A per-document cap
cannot tell «three artículos of one law» from «the same FAQ answer twice» and
evicts both, which is why `multa-iva-no-declarado` (`cnpt` 78, 79 and 81) goes
2/5 → 1/5 and `renta-salario-y-actividad` 5/5 → 4/5.

Capping per _artículo_ instead — the grouping that isolates the genuine
duplicate — costs nothing and buys nothing: +1 target, no figure. Duplicate
artículos are rare enough that freeing their place does not reach
`ccss-escala-ivm` at reranked #9.

And the document cap did one thing worth recording on its own. Under
`ANSWER_DOC_CAP=2`, `ho-abs-aguinaldo-freelancer` — «¿Tengo derecho a aguinaldo
como freelancer?», an **abstention** case that must decline and route to the
MTSS — resolved **two** BMC figures. Under the shipped config it resolves none,
and neither does any other case outside the four that name `salarios-minimos`
in `expected`. The cap widened document diversity, an escala reached the answer
set, and the pin completed the arithmetic behind it. That is ADR 0018's stated
risk arriving from an unexpected direction: the pin's safety is not a property
of the pin alone, it is a property of the pin **and** a narrow answer set.
Anything that widens the answer set has to be re-measured against the
abstention lane before the pin goes on with it.

So the cap is not the lever, and the remaining F1 gap stays where the paragraph
above put it: `ANSWER_TOP_K`, on a full run, with the abstention lane read
beside it.

### The authorized full run: `ANSWER_TOP_K=10` beside the cap and the pin (#305)

The run #303 could not afford and #312 handed its last question to: the same
corpus (871 chunks), the same models (answer `claude-sonnet-5`, judge
`claude-sonnet-4-5`, expansion `claude-haiku-4-5`), the same day
(2026-09-15), `main` at #339, every lane once per arm. The rows are published
in [`eval/runs/2026-09-15-top-k/`](runs/2026-09-15-top-k/) — this time copied
out of the worktree before anything else was done, which is the lesson of the
#304 transcripts.

**What was run, and why not the issue's third arm.** The issue named three
arms: the pipeline of record, `ANSWER_TOP_K=10`, and `10 + ANSWER_DOC_CAP=3`.
#312's deterministic probe (retrieve → rerank → cap → pin → resolve, no
answer model, no judge) was re-run at both top-k values first, over the 61
single-turn retrieval cases (158 expected targets) and the 9 abstention
cases — `pnpm answer-set-probe`, cents:

| Configuration                | Targets in the answer set | Cases with every target | Figures resolved | Figures on an abstention case         |
| ---------------------------- | ------------------------- | ----------------------- | ---------------- | ------------------------------------- |
| top 8, cap off, pin off      | 102/158                   | 32/61                   | 2                | —                                     |
| top 8, cap off, pin on       | 105/158                   | 33/61                   | 7                | —                                     |
| **top 10, cap off, pin off** | **108/158**               | **35/61**               | 2                | —                                     |
| top 10, cap off, pin on      | 111/158                   | 36/61                   | 7                | —                                     |
| top 10, cap 3, pin off       | 101/158                   | 33/61                   | 2                | —                                     |
| top 10, cap 3, pin on        | 105/158                   | 36/61                   | 10               | `ho-abs-aguinaldo-freelancer` (2 BMC) |
| top 10, cap 2, pin off       | 102/158                   | 32/61                   | 6                | —                                     |

The cap arm was retired on that table rather than run: at top 10 the cap starts
seven expected targets down (108 → 101, the same «four different artículos of
one reglamento» shape #312 found at top 8), and with the pin on it brings back
the abstention leak #312 recorded. US$6 to confirm a number a probe already
gives was the wrong trade, and the money went to the pin instead: arm C is
`ANSWER_TOP_K=10` with `PIN_DERIVED_INPUTS=on`, read as a scoped run on the
three cases where the probe says the pin changes the answer set at top 10
(`ccss-cuanto-pago-base`, `ho-desde-cuanta-plata-caja`,
`ho-800-mil-que-porcentaje-caja` — every other answer set is byte-identical to
arm B's), plus the whole abstention lane, since that is where #312 said a pin
under a wider set had to be read.

The probe's per-case rows say what top 10 reaches that top 8 does not: six
cases gain a target (`inscripcion-hacienda-clientes-extranjero`,
`ccss-pedir-prescripcion-cuotas`, `desinscripcion-dejar-actividad`,
`regimen-simplificado-programador`, `iva-servicios-extranjero-comprados`,
`ho-factura-electronica-o-recibo`), none loses one. F1's `ccss-escala-ivm`
sat at reranked #8 in the probe, #9 in arm B and #8 in arm C — the one-place
coin flip #312 described.

**The arms, on the gates.** Arm A is the pipeline of record, arm B moves the
one knob. Arm A's hit-rate lane passed inside the full run and vitest hides a
passing file's console, so its number is a re-read of that lane alone, forty
minutes later (`hitrate-…log`; from now on the lane runs with
`--disableConsoleIntercept`).

| Gate (73 cases)                       | A: top 8 (record)                                                                        | B: top 10                                                                                                                                                               | C: top 10 + pin (scoped)       | Gate                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------- |
| Hit-rate                              | **72/73** · blocking `ho-rebajar-25-sin-facturas` at pool #27                            | **71/73** · same blocking miss at pool #21, plus `ccss-asalariado-followup` at pool #4                                                                                  | —                              | ≥ 0.92 pass; blocking fails on both |
| Groundedness                          | **69/73**                                                                                | **66/73**, under the gate                                                                                                                                               | 3/3 on the three               | ≥ 0.94                              |
| Blocking groundedness failures (#324) | 3 — `ho-cabys-paginas-web`, `ho-cliente-espana-lleva-iva`, `ho-rebajar-multa-si-pago-ya` | 5 — `multa-iva-no-declarado` (2/3), `ho-trabajitos-por-mi-cuenta`, `ho-cliente-espana-lleva-iva`, `ho-minimo-caja-independiente-2026`, `ho-800-mil-que-porcentaje-caja` | 0                              | 0                                   |
| Adequacy, cases with claims           | 13/40                                                                                    | **17/40**                                                                                                                                                               | 0/2                            | —                                   |
| Tier 1 adequate                       | 3/27                                                                                     | **6/27**                                                                                                                                                                | —                              | 27/27, fails                        |
| Tier 2 adequate                       | 10/13 (0.77, **fails 0.84**)                                                             | 11/13 (0.846, pass)                                                                                                                                                     | —                              | ≥ 0.84                              |
| Abstention                            | 9/9 · figure gate fails (`ho-abs-calculo-personalizado`: ¢20.520,00, 75 %)               | **8/9** · `ho-abs-calculo-personalizado` answers                                                                                                                        | 9/9 · figure gate fails (75 %) | ≥ 0.9, zero figures                 |
| Citation invariant (#168)             | 2 (`[9]` of 8, `[15]` of 8)                                                              | 2 (`[16]` of 10, twice)                                                                                                                                                 | 0                              | 0                                   |
| F1 (`ccss-cuanto-pago-base`) BMC      | fail — `ccss-escala-ivm` outside the 8                                                   | fail — `ccss-escala-ivm` at #9, pin off                                                                                                                                 | **pass** — both figures, cited | —                                   |
| Prompt tokens per ask, mean / median  | 12 147 / 11 520                                                                          | 14 068 / 13 493 (**+16 %**)                                                                                                                                             | —                              | `pnpm prompt-tokens`                |

Every lane logged one to three Haiku expansion timeouts (the 3 s budget) and
no other provider error; those asks ran on the question alone, the designed
fallback, and the run is recorded the way the closing run was. The first
attempt at arm B is not in the table: the Anthropic balance ran out thirteen
minutes into its groundedness lane (`AI_APICallError: Your credit balance is
too low`), the arm was discarded whole and re-run after a top-up, and the
rule the closing run wrote — verify the balance before launch — was the rule
this run broke. The logs of that dead arm are in the published folder under
`dead/`, so the 72/73 hit-rate reading it produced at top 10 is on record as
the one that is _not_ counted.

**Decision: `ANSWER_TOP_K` stays 8.** The knob bought what #303 predicted on
the cases it predicted it for — `ccss-pedir-prescripcion-cuotas` passes on the
«¿Cómo se solicita?» entry at #9, `ho-rebajar-multa-si-pago-ya` and
`ho-tambien-asegurado-por-patrono` pass, `ho-800-mil-que-porcentaje-caja` and
`ho-hacienda-solo-cliente-eeuu` each gain a requirement — and it paid for them
with the release gate, the same shape #304's `pin` had: adequacy up, four more
blocking groundedness failures, 0.94 lost. Three things make that a decision
rather than a coin flip:

1. **The new failures are index-shaped.** `ho-trabajitos-por-mi-cuenta` cites
   [10] for a rule [10] does not state; the two citation violations are both
   `[16]` on a list of ten. Arm A's two violations are `[9]` and `[15]` on a
   list of eight: the model invents markers past the end of whatever list it
   is given, and a longer list gives it more room to mis-index inside it.
2. **The wider set loses claims as well as gaining them.** Beside the
   fourteen requirements top 10 reaches, seven that top 8 stated go missing —
   `ho-hasta-que-dia-tengo-iva`'s «qué hacer si la fecha ya pasó» (the one
   Tier 1 case that passed in every prior reading), `ho-iva-en-cero-sin-facturar`'s
   «decimoquinto día» literal, the OVi username in `ho-donde-inscribo-ya-no-atv`,
   the declared ingreso de referencia in `ho-donde-me-afilio-caja`. More
   fragments spread the answer thinner, which is also why
   `ho-minimo-caja-independiente-2026` fails **worse** at 10 (3 → 5 missing)
   while finally holding both BMC inputs: it states the figures and then
   over-reads which base triggers the obligation, and the judge fails it for
   that.
3. **The adequacy gain is inside the noise.** The closing run scored 17/40 on
   the pipeline arm A re-measured at 13/40 four days later, same code, same
   corpus: the run-to-run band on adequacy is ±4 cases, and B's 17/40 is the
   closing run's number, not a step past it. Hit-rate did not move (72 → 71),
   abstention lost a case, and every ask would carry 16 % more prompt.

So the default, SPEC §5's «top-k ≈ 8» and `rerank.test.ts`'s pin of the
constant are untouched; `ANSWER_TOP_K` remains the env knob it was.

**The pin, on the bar ADR 0018 set.** Arm C is the first reading of
`PIN_DERIVED_INPUTS=on` on real answers: the three cases whose answer set it
changes are all grounded (3/3), `ccss-cuanto-pago-base` resolves **both** BMC
figures — ¢324.590 with markers {8, 11}, ¢346.789 with {2, 11} — states both,
cites both completely, and passes the F1 assertion for the first time since
#296; and the abstention lane under the pin is 9/9 with no figure on
`ho-abs-aguinaldo-freelancer` or any other ABS case, exactly as the probe
said. That is the pin passing its bar **at top 10**, which does not ship. At
top 8 the IVM input sits outside the cut on the reading arm A happened to get,
so the pin could only have completed the SEM figure there; ADR 0018's rule is
a full run on both sides of the shipped top-k, and that run has not happened.
The pin stays off, with its bar now half met. What F1 needs is not a wider
cut but `ccss-escala-ivm` reliably inside eight — a rerank question, which
#287 still owns.

**Where the misses are, re-read.** #303's answer-side list died with its
transcript; arm A is the re-read. Of the 68 requirements arm A's judged cases
miss, **15 are answer omissions** — the carrying chunk was numbered in the
prompt and the answer did not state the claim or cited it wrong — on 14 cases
(12 Tier 1, 2 Tier 2), handed to #130 by id; the other 53 are the retrieval
residue #289 mapped (the sanction articles, ¢462.200, the export exemption and
13 %, the OVi steps, the image-only FAQ entry). The ones worth naming here:
`ho-minimo-caja-independiente-2026` writes «no encuentro … la BMC» with
`ccss-escala-salud` numbered [2]; `ho-t2-constancia-al-dia` tells the reader to
log in with the «OVi Pública» entry (#297's new target) numbered [4];
`ho-rebajar-multa-si-pago-ya` states the 75 % and does not cite art. 88 for it.

**The seeds stay.** The two home-page seeds the 2026-09-12 note put on this
run are no better at 8 or 10: `ccss-obligacion-ingreso-bajo` misses the same
three requirements in the closing run, arm A and arm B (categoría 1, where to
enrol, 0,9295 SM — one of them an answer omission with the chunk in hand), and
the T1-F seed's figures resolve only under top 10 + pin. The one clean
candidate, `ho-hasta-que-dia-tengo-iva`, passed two of three readings and
belongs to T1-D, a family that already has a seed, so a swap would break
one-per-family for a case that is not reliably clean either. #311's
condition — «runs only if #305 leaves the seeds thin» — is met.

**Cost.** Two full arms, one dead half-arm, one hit-rate re-read and the scoped
arm C: ≈ US$15 at today's prices, against the issue's US$8–12 per arm.

### Harness fixes after #305, no full run (#342)

Three findings of that run that were about the harness, not the knob.

**A passing lane's console.** `eval.yml` and every run-locally command above
now pass `--disableConsoleIntercept`, so a hit-rate lane that passes inside a
full run leaves its per-case table in the log instead of costing a re-read.

**The figure gate's semicolon.** `checkLiteral` cut its citation window at
`;` and `:` as well as `.!?` — from #261's first draft, on no recorded reason.
Two of #305's readings were that cut and nothing else: arm A's abstention lane
flagged «¢20.520,00 anuales; como usted indica … [4]» and «el 75% … setiembre;
el saldo … [5]» on `ho-abs-calculo-personalizado` as invented (arm C the 75 %
again), and the adequacy lane scored `ho-rebajar-multa-si-pago-ya`'s 75 %
«present but uncited» in the closing run and arm A alike — both times inside
«se reduce en un 75%; si además … sube a 80% [1]», the marker at the end of
the sentence. Prompt rule 2 puts the marker after the affirmation and Spanish
prose chains one affirmation across a semicolon, so the window is now the
orthographic sentence: `;` and `:` are out, a marker in the next sentence
still vouches for nothing, and `adequacy.test.ts` pins both #305 sentences
verbatim. Expect `ho-rebajar-multa-si-pago-ya`'s literal row to flip to cited
on the next run; its adequacy fail stays, on the TRIBU-CR step.

**The blocking miss, diagnosed.** `pnpm pool-dump ho-rebajar-25-sin-facturas
--pool=300` before the fix: `ley-renta` art. 8 (the Ley 10818 deducción única,
chunk #2 of a 6.7 k-character article) at fused #21 — vector 31, lexical
nowhere, expansion lexical 6, and **no step leg at all**: the T1-E catalogue
carried the declaración, the pagos parciales and the tramos, and named this
case without a sentence for it. A catalogue-shaped miss, so a fourth T1-E
sentence in inciso s)'s own words (`steps.test.ts` allows four since #312).
After: fused **#10** (step lexical 3, step vector 26), inside the reranker's
40 with room to spare, where the closing run's #21 was a coin flip. Art. 7,
the second target, sits at #66–114 either way and is not what the case needs
to hit. Hit-rate lane alone, run to confirm (`hitrate-342-…log` in the main
checkout's `eval/transcripts/`): **71/73, pass**, `ho-rebajar-25-sin-facturas`
**hit** at pool #13, no blocking miss. The two misses are the non-blocking
pair the arms already knew — `ccss-asalariado-followup` at pool #5 (arm B's
#4) and `ho-t2-payoneer` at #38.

**Cost.** Two pool-dumps and one hit-rate lane, ≈ US$0.30.

### The pin at top 8, and on by default

The one scoped paid run left after #305: `PIN_DERIVED_INPUTS=on` at the
shipped `ANSWER_TOP_K=8`, read where the probe says the pin changes an
answer set at 8 and nowhere else — `EVAL_CASES=ccss-cuanto-pago-base,
ho-desde-cuanta-plata-caja,ho-800-mil-que-porcentaje-caja,
ho-minimo-caja-independiente-2026` on the groundedness lane, then the whole
abstention lane. Transcripts under `eval/transcripts/pin-8/` in the main
checkout (`groundedness-scoped-20260915T051339Z.log`,
`abstention-20260915T051612Z.log` and their `.jsonl`).

| Read                             | Result                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Groundedness, the four pin cases | **4/4**                                                                        |
| Runtime citation invariant       | ok on all four                                                                 |
| Derived figures, cited           | 6/6 mentions with both input markers («¢346.789 [5][9]», «¢324.590 [7][9]», …) |
| Abstention lane                  | **9/9**, no figure on any ABS case                                             |

Per case: `ho-minimo-caja-independiente-2026` and `ho-800-mil-que-porcentaje-caja`
resolve and cite **both** BMC figures at 8; `ho-desde-cuanta-plata-caja` the SEM
one, the only input pair its set holds; `ccss-cuanto-pago-base` (F1) SEM only —
`ccss-escala-ivm` fell outside the eight on this reading as on arm A's, so the
strict F1 assertion stays red at 8 and stays #287's. The three Tier 1
adequacy fails on these cases are the same steps and literals they missed
before the pin; the lane's gate errors are the scoped-run refusal by design
(a subset is a transcript read, not a measurement). `ho-abs-calculo-personalizado`
reads clean now that #342's window is in.

That is the bar ADR 0018 set, met at 8 on the answers the pin touches, after
#305 met it at 10. **The pin is on by default** from this reading:
`PIN_DERIVED_INPUTS` reads like `RERANK` and `EXPAND` (unset or empty is on,
`off` is the measured baseline), `eval.yml` carries the variable, and ADR
0018's third amendment records the decision and what it does not claim.

**Cost.** One scoped groundedness lane and one abstention lane, ≈ US$1.

### The answer side, read and fixed: rule 9 (#289)

#304's authorized run left Tier 1 at 5/27 with the shipped `STEPS_RERANK=off`,
and its per-case transcripts died with the worktree. So the classification was
regenerated on a scoped run — six Tier 1 cases, ≈US$0.30, the shipped
pipeline — and read against the numbered chunk list each answer was handed.
The six: the three families #304 named as answer-side (B, F, H) and the three
cases #303 had placed in the «carrying chunk in the top-8» bucket (C, I, and
F's minimum). Transcripts, both copied to the main checkout:
`groundedness-claude-sonnet-5-subset-20260909T023212Z.jsonl` (before) and
`…T023915Z.jsonl` (after).

**Before, 16 missing requirements on 6 cases, adequacy 0/6.** Of the 16,
**4** had their carrying chunk in front of the model and the answer did not
state it; **12** did not (the chunk was in the pool or absent, exactly the
#303/#304 shape). The four omissions have one shape, and it is not «no next
step» — rule 8 fires, every answer ends with «Como paso siguiente». It is the
answer **summarising that the document says something instead of saying it**:

| Case                             | Chunk in the answer set                                                                     | What the answer wrote                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ho-tiquete-en-vez-de-factura`   | `reglamento-comprobantes` art. 9 at [4], the seven-item list                                | «ambos son comprobantes electrónicos autorizados por Hacienda [4]»                                                  |
| `ho-rebajar-multa-si-pago-ya`    | `cnpt` art. 88 at [1] — «las sanciones de los artículos 78, 79, 81 y 83»                    | «la sanción del artículo 79» — and never that the 1 % morosidad it had just cited from art. 80 bis is _not_ reduced |
| `ho-800-mil-que-porcentaje-caja` | both escalas, `ccss-escala-salud` [3] and `-ivm` [4], tables in full                        | «categorías desde 0.9295 SM hasta 6 SM y más» — 6,24 % and 7,53 % absent                                            |
| `ho-donde-me-afilio-caja`        | `ccss-reglamento-ti` art. 7 at [2] — the income is declared «para el cálculo de las cuotas» | «llevando … información sobre su actividad económica e ingresos»                                                    |

Rule 9 of `ANSWER_SYSTEM_PROMPT` names that: reproduce an enumeration that
applies to the case instead of alluding to it («entre otros», «ambos»); give a
whole escala when the reader cannot be placed in it, and say what is missing to
place them; when a document delimits a rule, say what it covers and what it
does not; and when a document states, about an obligation that applies, the
base, the place or channel, the plazo, or the sanction, say it whether or not
it was asked. It ends by subordinating itself to rule 1: a list or an escala is
not completed with what the documents do not carry, and a base, canal, plazo or
sanción the documents do not state is omitted or routed under rule 6, never
inferred (that last clause was added on review, after the run below, so the
run measured the rule without it). Old rules 9 and 10 are now
10 and 11. Deliberately **not** a change to what reaches the model — #304
measured `STEPS_RERANK=pin` buying three adequacy cases with four groundedness
ones, and rule 9 asks for nothing the answer set does not already carry.

**After, same six, same answer sets** (the chunk lists are identical row for
row): **10 missing, adequacy 1/6, groundedness 6/6 → 6/6.** All four omissions
are stated: art. 9's seven comprobantes, art. 88's four artículos with the
morosidad expressly outside them, both escalas as cited tables (6,24 % and
7,53 % present and cited, and the answer still says it cannot place ¢800.000
without the salario mínimo — rule 3 holding under rule 9), the declared income
as the base of the cuota. `ho-rebajar-multa-si-pago-ya` passes outright: its
TRIBU-CR step, whose chunk (`tribu-cr-faq` · 60) is not in the set, was judged
present on «presentar las declaraciones … mediante los formularios que
establece la Administración Tributaria [3]».

The ten that remain are, every one, a chunk outside the answer set on the
shipped pipeline — #303/#304's retrieval residue, not the prompt's:

| Case                                       | Missing                                                                    | Carrying chunk                                              | In the set?                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| B `ho-donde-me-afilio-caja`                | payment date by first surname                                              | `ccss-faq` «¿Cuándo me corresponde pagar…?»                 | no                                                                      |
| C `ho-tiquete-en-vez-de-factura`           | RUT + registered e-mail                                                    | `reglamento-comprobantes` arts. 4/5                         | no                                                                      |
| F `ho-minimo-caja-independiente-2026`      | ¢373.092,30 · how the ingreso is declared/updated                          | `salarios-minimos` art. 1 · `ccss-reglamento-ti` arts. 7/12 | no (`PIN_DERIVED_INPUTS` off, #312)                                     |
| F `ho-800-mil-que-porcentaje-caja`         | base = ingreso de referencia · how it is modified                          | `ccss-reglamento-ti` arts. 10 · 12                          | no                                                                      |
| H `ho-desinscribir-debiendo-declaraciones` | all four (50 %, «se sancionan igual», «mientras siga inscrita», the order) | `cnpt` 79 · `reglamento-iva` 67 · `tribu-cr-faq` · 43       | no — the answer declined the point it had no source for, as rule 8 says |

What the rule costs: the six answers grew from ≈2 000 to ≈2 750 characters
(+35 %), all of it cited substance — tables, lists, the sanction the reader
would otherwise not be told. That is output tokens on every ask and reading
time for the person, and the full run is where it is weighed against the
abstention lane and groundedness over 73 cases, not here. Tier 1 stays per-case
blocking and `ADEQUACY_TIER2_GATE` stays 0.8. What the full run should expect
from this change: the #303 bucket of 18 «in the top-8» omissions to move, the
23 retrieval ones not to.

#### Eight more, for groundedness (#289)

The six above are the cases rule 9 was written against, so their 6/6
groundedness is not evidence that the rule holds elsewhere. Eight Tier 1/2
cases it was **not** written against — the rest of #303's «in the top-8»
bucket and #288's two named failures — through the same pipeline, ≈US$0.40,
transcript `groundedness-claude-sonnet-5-subset-20260909T195513Z.jsonl`
(copied to the main checkout): `ccss-obligacion-ingreso-bajo`,
`multa-iva-no-declarado`, `inscripcion-tardia-sancion`,
`ho-hacienda-solo-cliente-eeuu`, `ho-cliente-espana-lleva-iva`,
`ho-iva-en-cero-sin-facturar`, `ho-ademas-tengo-salario`,
`ho-t2-salir-del-pais-seguro`.

**Groundedness 8/8**, including `multa-iva-no-declarado` and
`ho-hacienda-solo-cliente-eeuu`, the two #288 owns — one run each, not a
verdict on #288. Adequacy 0/8, 24 missing requirements, read against each
answer's chunk list:

| Bucket                                                 | Requirements | Where                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| carrying chunk **outside** the answer set — retrieval  | 21           | `cnpt` 88 and the ¢462.200 salario base on both T1-I cases; the export exemption and the 13 % on both T1-D; pagos parciales and «dos meses y quince días» on E; `cnpt` 79, the «¿Dónde…?» FAQ, inscripción de oficio, the TRIBU-CR step                                                                                                                                                 |
| chunk **in** the set, answer did not state it — prompt | 2            | `ho-t2-salir-del-pais-seguro`: [7] says «la suspensión no se realiza en forma automática… debe existir una solicitud» and the answer said «tramitar la suspensión» without the «no automática»; `ho-ademas-tengo-salario`, borderline: arts. 15 and 33 in the set and used, «escalas distintas» never said                                                                              |
| requirement **against** the corpus — dataset           | 1            | `ccss-obligacion-ingreso-bajo` requires «la obligación no depende de superar un umbral de ingresos»; `ccss-reglamento-ti` art. 1, in the set at [2], says «no se consideran asegurados obligatorios los trabajadores independientes con ingresos inferiores al monto mínimo de contribución», and the answer cited exactly that. A rewrite with the reason in `notes`, pending a ruling |

So over fourteen cases, 40 missing requirements: 6 were the prompt's, 33 are
retrieval, 1 is the dataset's. Rule 9 fixed 4 of its 6 on the cases it was
designed on and missed 2 it was not; the two misses are the same shape as the
four fixes (a delimiting clause the document states outright) and are the
first thing to look at if the full run leaves Tier 1 short of what the
retrieval residue predicts.

#### #288, re-read twice more, and closed (2026-09-11)

#288 was opened on the 2026 baseline's three unanimous failures; #286's
re-measurement retired all three and named four others, and #304's
transcripts — the run that scored 71/73 — died with their worktree without
naming its two. What survived as #288's set was `multa-iva-no-declarado` and
`ho-hacienda-solo-cliente-eeuu`, both 1/1 in the eight-case read above. Two
more readings of the pair on `main` at #321, shipped pipeline, ≈US$0.10,
transcripts `groundedness-claude-sonnet-5-subset-20260911T004608Z.jsonl` and
`…T004801Z.jsonl` (copied to the main checkout): **pass and pass, both cases,
both readings** — three readings, three passes each, with the judge saying
«every factual claim … supported» every time. No prompt or retrieval change
was made; the issue closes on the reproduction it asked for in requirement 1
having failed to reproduce.

One thing the reading surfaced that the judge no longer flags. #286's judge
failed `multa-iva-no-declarado` for turning three omitted declarations into
three separate sanctions; today's answer still says «esta sanción es fija por
cada declaración no presentada … en principio correspondería … por cada una
de ellas [1]», and `cnpt` art. 79 at [1] says «los sujetos pasivos que omitan
presentar las declaraciones … tendrán una multa equivalente al cincuenta por
ciento del salario base» — plural declarations, one multa, per-declaration
unstated either way. The judge accepts the hedged form 3/3. It is recorded here
as a judge-tolerance boundary, not a fix: if the closing run fails this case,
that sentence is where to look, and the remedy is not a rule that forbids
counting but one that keeps a count the article does not state out of the
answer (rule 1's territory, cf. rule 9's last clause).

## The closing run (2026-09-11)

The Phase 4 closing run the roadmap's Option A called for: one arm, the
shipped pipeline on `main` at #322 (#314 rule 9, #321 abstention, #288 closed
on re-reads), every suite once, answer `claude-sonnet-5`, judge
`claude-sonnet-4-5`, same 871-chunk corpus, 2 163 s. The transcripts and raw
logs are published in [`eval/runs/2026-09-11-closing/`](runs/2026-09-11-closing/)
(#325), with a README naming each file.

| Gate (73 cases)                  | #304 (shipped) | Closing run | Gate             |
| -------------------------------- | -------------- | ----------- | ---------------- |
| Hit-rate                         | 71/73          | **70/73**   | ≥ 0.92, pass     |
| Groundedness                     | 71/73          | **70/73**   | ≥ 0.94, pass     |
| Adequacy, cases with claims      | 16/40          | **17/40**   | —                |
| Tier 1 adequate                  | 5/27           | **5/27**    | 27/27, **fails** |
| Tier 2 adequate                  | 11/13          | **12/13**   | ≥ 0.8 → **0.84** |
| Abstention                       | 3/7            | **9/9**     | ≥ 0.9, **pass**  |
| Citation invariant (#168)        | 0              | **0**       | 0, pass          |
| F1 (`ccss-cuanto-pago-base`) BMC | fail           | fail        | — (#305)         |

Four of seven conditions for deploy were green on the 08-09 tables; **six of
seven** are now, and the seventh (Tier 1) is where the residue analysis of
#289 said it would be: 22 Tier 1 cases short, and the missing requirements are
the same 33-retrieval / handful-prompt split — `cnpt` 88 and ¢462.200 on the
sanctions cases, the export exemption and 13 % on T1-D, the OVi steps, the
CCSS FAQ that is an image. Nothing in this run moves a Tier 1 case that #305,
#311 or #301 was not already assigned. Per Option A, Tier 1 deploys as an
**accepted risk, dated, on #121**, with the residue owned by those three.

**Abstention 9/9** is #321's measurement: the four cases that answered
instead of declining on both prior runs (`sociedad anónima`, `aguinaldo`,
`sociedad inactiva`, and the alternating pair) all decline and route now, and
the two cases #321 added decline too. First time over the gate.

**Groundedness 70/73**, three unanimous failures, all reasoning-shaped, two
of them the #286 pair #288's roadmap entry had left to this run:

- `ho-cliente-espana-lleva-iva` — reads «ubicado en dicho territorio» as
  sufficient for IVA and says so, while itself acknowledging the fragments do
  not settle the export case (the dropped-qualifier shape from #286).
- `ho-minimo-caja-independiente-2026` — states 11,66 % as category 1's IVM
  rate; [6]'s «Conjunta» column says 9,91 % and 11,66 % is the preamble's
  global rate (the double-counted-percentage shape from #286, now in the
  other direction).
- `ho-t2-tipo-de-cambio` — new: claims a discrepancy between art. 81
  (interbancario) and art. 5 (referencia de venta) that [5] does not carry.

The two #288 cases pass, as their three re-reads said they would. 70/73 is
one case under #304's 71/73 and the same figure as the baseline; the ratchet
does not move (69/73 = 0.945 → 0.94, the current value). Two answers in this
lane logged `expansion failed — reason=timeout` (Haiku over 3 s); with the
expansion legs absent those asks ran on the question alone, which is the
designed fallback, and neither is among the three failures.

**Hit-rate, and the number that had to be re-read.** The run's own hit-rate
lane scored **68/73 with the blocking case `ho-rebajar-25-sin-facturas`
missed** (pool #26) — and logged three expansion timeouts, against three new
misses versus #304. That is a technical-failure signature, and the rules allow
one repeat for it. The first repeat came back **61/73 with every expansion
failing `400`**: the Anthropic balance had reached zero mid-session (the
closing run itself completed before it did — its groundedness numbers are
whole). After a top-up, the lane twice more: **70/73, zero expansion
failures, the blocking case hits**, first-exposure 30/32, promoted 7/7,
corpus-derived 33/34. The three misses are `ho-t2-constancia-al-dia` (never
reaches the pool, #297) and `ho-t2-payoneer` (pool #8) — #304's known pair —
plus `ccss-asalariado-followup` at pool #5, which hit at #304 and missed on
both clean readings here; one Tier 2 corpus case, not blocking, worth a
`pool-dump` before the next retrieval change. 70/73 is what the README
records; 68 and 61 were the provider, not the pipeline. `HIT_RATE_GATE` stays
0.92 by #296 requirement 4 (the ratchet would say 0.94; the misses are corpus
ones).

**Tier 2 adequacy ratchets** 0.8 → **0.84**: 12/13 measured, minus one case
= 0.846, floored. `ADEQUACY_TIER2_GATE` and SPEC §9 carry the new value. The
one Tier 2 miss is `ho-t2-constancia-al-dia`'s «OVi pública, sin usuario»,
the same case hit-rate cannot reach — #297's decision.

**F1** stays red for the reason #312 left it: `bmc-ivm-2026` does not resolve
from the answer chunks (`ccss-escala-ivm` reranks at #8/#9/outside), and
`ho-minimo-caja-independiente-2026` presents the derived figure without that
input. `PIN_DERIVED_INPUTS` is still off; the knob that decides it is
`ANSWER_TOP_K`, which is #305's run.

What this run cost: ≈US$6.20 for the full lane, plus ≈US$0.75 for the three
hit-rate readings, one of which bought nothing but the diagnosis. The lesson
is cheap and already in the roadmap: verify the balance before a paid run,
and read a run that logs provider errors as a run to repeat, not a number.

### The gate that did not say so: per-case groundedness (#324)

SPEC §9 has said since #277 (2026-09-04) that «no individually blocking Tier 1
case may fail» groundedness, and `dataset.ts` says every Tier 1 case is
individually blocking on hit-rate, groundedness and adequacy. The hit-rate
lane asserted it from the start (`finds every blocking case's artículo in the
answer top-k`, listed by id). The groundedness lane never did: from the day
Tier 1 cases became `blocking` by construction (#278/#284, 2026-09-04) until
#324, `groundedness.eval.test.ts` asserted only the aggregate `≥ 0.94`.

What the missing assertion let through, run by run:

| Run                      | Rate  | Blocking failures the rate absorbed                                              |
| ------------------------ | ----- | -------------------------------------------------------------------------------- |
| 2026 baseline (#267)     | 70/73 | `ho-hacienda-solo-cliente-eeuu` (T1-A)                                           |
| Closing run (2026-09-11) | 70/73 | `ho-cliente-espana-lleva-iva` (T1-D), `ho-minimo-caja-independiente-2026` (T1-F) |

Both closing-run cases are wrong statements, not missing ones — the export
case read as taxable on «ubicado en dicho territorio» alone; 11,66 % given as
category 1's IVM rate where [6] says 9,91 % — and the gate passed. The
accepted-risk record on #121 (2026-09-11) described Tier 1 answers as
incomplete «never a wrong one»; #324's comment under it names the two cases
with the same owner and expiry (2026-11-12) and corrects that sentence.

Closed 2026-09-12 (#324): `blockingGroundednessFailures` in
`src/lib/eval/groundedness.ts` — every `blocking` case must pass, failures
named by id with the judge's reason — asserted by the lane beside the
aggregate gate, which is unchanged, and unit-tested keyless in
`groundedness.test.ts`. No paid run: #305's is the first measurement with the
assertion on, and it will fail while the two cases still fail. That is what
the gate should say; the deploy decision lives in the accepted-risk record,
not in the gate.

### A dataset decision, no run (#293)

The Tier 1 adequacy FAIL #289 classified as A2 was decided on 2026-09-12 by
reading the ingested sources, not by running anything; the numbers above do
not change until the next paid run.

- `ho-cabys-paginas-web` (Tier 1 adequacy FAIL, #289 A2) — the v4.4 «Anexos y
  Estructuras» annex stays out of the corpus: field-level comprobante
  structure is outside the release promise (BRIEF §5). The claim «cada línea
  de detalle lleva su código CABYS» lived only in that annex and is rewritten
  to what the ingested corpus states: Reglamento de Comprobantes art. 13
  inciso 10 requires a «código de producto» per bien o servicio in the
  detail. That the code is CABYS is the annex's sentence, not the
  reglamento's, and the claim no longer asserts it. Art. 13 joins `expected`
  as that claim's source; `cabys-dev` stays as the target of the second.

### A dataset decision, no run (#297)

The Tier 2 miss the closing-run tables leave to a decision was decided on
2026-09-12 by reading the source, not by running anything; the numbers above
do not change until the next paid run.

- `ho-t2-constancia-al-dia` (the one Tier 2 adequacy miss, and one of the
  three hit-rate misses) — the FAQ has no «constancia» to download; what it
  has is the public consultation, so the honest answer is entries · 1 (where
  it is), · 2 (no user needed) and · 7 (what the «al día» status the reader
  names means). `· 7` joins `expected` as the source that defines the status
  asked about — #286 measured it at vector rank 1 and left it alone on
  purpose; this is the review that rule asked for — and its content joins the
  case as a second required claim, so the change makes the case stricter
  where it makes it reachable. Still `heldOut`, still Tier 2.

## Adversarial conflicting-sources case (issue #135)

`src/lib/eval/conflicting-sources.eval.test.ts` is the one case that
cannot live in `dataset.jsonl`. Its fragments are hand-written
(`src/lib/eval/conflicting-sources.ts`) and deliberately contradict each other
on a single figure — two tramos decrees of consecutive years quoting different
exempt amounts. The corpus does not contradict itself, and dataset targets must
be verified against the ingested corpus, so no real question can exercise the
path.

It runs the production answer path from the prompt down (`ANSWER_MODEL` +
`ANSWER_SYSTEM_PROMPT` + `buildUserPrompt`) and asks a **second** judge — not
the groundedness one — the adversarial question: does the answer say the
sources disagree, give both figures, and cite both? The groundedness judge
cannot catch this, since an answer that quietly picked one figure is still
fully supported by its fragments. Rule 4 of the answer prompt is what the case
holds in place; the decision that conflicts are surfaced in answer text rather
than resolved by structured vigencia extraction is #121's.

Blocking, single case, no rate. It needs no database and no embeddings, so it
is gated on `ANTHROPIC_API_KEY` alone and runs at the judge cadence alongside
the groundedness gate:

```sh
ANTHROPIC_API_KEY=<key> \
pnpm vitest run --disableConsoleIntercept src/lib/eval/conflicting-sources.eval.test.ts
```

Verified 2026-08-13 (answer `claude-sonnet-5`, judge `claude-sonnet-4-5`):
pass — the answer opens with «Las fuentes discrepan…», names each decree with
its own figure and marker, and refers the reader to Hacienda for which one
rules.

## The first run on production (2026-09-16, #29)

> **Measured 2026-09-16 (04:11–04:52 UTC) by `eval.yml`
> ([run 35054635623](https://github.com/rjwrld/tramitico/actions/runs/35054635623)),
> the first execution of the lane against the production Supabase project
> rather than a local stack: 23 documents / 876 chunks, the corpus of
> `eval/corpus-index.json` after #347 (real-table census 187/187).** Answer
> `claude-sonnet-5` (default), judge `claude-sonnet-4-5`, `RERANK` on,
> `EXPAND` on, the pin on (#344), top 8. Wall-clock 2 447s. The rows and the
> step log are published in
> [`eval/runs/2026-09-16-production/`](runs/2026-09-16-production/) (#340);
> the run's own `eval-transcripts` artifact expires after 90 days.

The question this run answers is #29's: does the deployed stack reproduce the
record? It does, and slightly better. The column to read against is arm A of
#305, the shipped configuration measured locally on 2026-09-14.

| Gate (73 cases)                   | #305 arm A, local (record)                                                               | production, this run                                                                                                                                                  | Gate                            |
| --------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Satisfiability census, real table | 3/3                                                                                      | 187/187 targets, index in sync                                                                                                                                        | PASS                            |
| Hit-rate, rerank on               | 72/73, blocking `ho-rebajar-25-sin-facturas` at pool #27                                 | **70/73** — the blocking case hits at pool #13; misses `ccss-asalariado-followup` (pool #6), `ho-t2-credito-iva-compras` (#38), `ho-t2-payoneer` (#39), none blocking | ≥ 0.92 pass; blocking passes    |
| Groundedness                      | 69/73                                                                                    | **69/73 (94.5 %)**                                                                                                                                                    | ≥ 0.94 pass                     |
| Blocking groundedness failures    | 3 — `ho-cabys-paginas-web`, `ho-cliente-espana-lleva-iva`, `ho-rebajar-multa-si-pago-ya` | **2** — `iva-clientes-fuera-cr` (new), `ho-cliente-espana-lleva-iva` (repeat)                                                                                         | 0 — **fails**                   |
| Adequacy, cases with claims       | 13/40                                                                                    | **18/40**, the best reading so far                                                                                                                                    | —                               |
| Tier 1 adequate                   | 3/27                                                                                     | **6/27** — fails; `ccss-pedir-prescripcion-cuotas` named, per-case table in the log                                                                                   | 27/27 — **fails**               |
| Tier 2 adequate                   | 10/13 (0.77, fails 0.84)                                                                 | **12/13** (0.92) — `ho-t2-salir-del-pais-seguro` misses the «a solicitud» claim                                                                                       | ≥ 0.84 pass                     |
| Abstention                        | 9/9, figure gate fails                                                                   | **8/9** — `ho-abs-calculo-personalizado` answers; no figure flagged                                                                                                   | ≥ 0.9, zero figures — **fails** |
| Citation invariant (#168)         | 2 violations                                                                             | **1** — `ho-tiquete-en-vez-de-factura`, unresolved marker `[18]`                                                                                                      | 0 — **fails**                   |
| F1 (`ccss-cuanto-pago-base`)      | fail, `ccss-escala-ivm` outside the 8                                                    | **pass** — both BMC figures, cited (the #344 pin)                                                                                                                     | PASS                            |
| Conflicting sources (#135)        | pass                                                                                     | **fail** — judge: «frames them as potentially both valid for different years»                                                                                         | PASS — **fails**                |
| Amending law (#182)               | pass                                                                                     | pass                                                                                                                                                                  | PASS                            |

What it says:

- **Production is the record, not a regression.** Census, groundedness rate,
  adequacy and F1 land on or above the local reading. Hit-rate reads 70/73
  against the record's 72/73, but the case that was blocking on every local
  reading, `ho-rebajar-25-sin-facturas`, hits at pool #13 here. The three
  misses are two of the closing run's three (`ccss-asalariado-followup`,
  `ho-t2-payoneer`) plus `ho-t2-credito-iva-compras` at pool #38, while the
  closing run's third, `ho-t2-constancia-al-dia`, hits at pool #2 — none
  blocking, all Tier 2, the one-to-two-case movement the rank-40 cut shows
  between readings. (The first write-up of this run copied the record's
  72/73 into the production column; the step log says 70/73, and the table
  was corrected on #340.) The one corpus difference (#347, the CCSS FAQ page)
  is visible exactly where it should be: `ccss-pedir-prescripcion-cuotas` now
  retrieves the new Ley 10.363 FAQ entries and the adequacy judge asks for the
  channel-by-phase claim those entries carry.
- **The lane was red before the deploy and is red after it, on the same
  gates.** Blocking groundedness, Tier 1 adequacy, the abstention set and the
  citation invariant all failed in the record run too. Three of the four
  moved in the right direction here; none crossed its gate. The two new reds
  are single judgements — `iva-clientes-fuera-cr` on whether the export
  invoice is _required_ for every exempt service, and the conflicting-sources
  judge on the wording «discrepan» — the kind #305 attributed to judge
  variance, not to the answer.
- **The done bar's «groundedness gate» (SPEC §10) reads ≥ 0.94 on the rate and
  passes at 94.5 %; the per-case Tier 1 assertion #324 added on top of it
  does not.** That was true on 2026-09-14 as well. Whether the bar means the
  rate or the assertion is the owner's reading, recorded on #29.

## The answer-effort reading (2026-09-22, #356)

> **Measured 2026-09-22 (23:44–23:58 UTC) on the local stack, the 27 Tier 1
> cases (`EVAL_CASES`) plus the nine abstention cases, answer
> `claude-sonnet-5` at `ANSWER_EFFORT=medium`, everything else as the
> production run.** A subset read, not a gate: compared per case against the
> 2026-09-16 rows, with no answer-path, dataset or corpus change between the
> two. Rows and log in
> [`eval/runs/2026-09-22-effort-medium/`](runs/2026-09-22-effort-medium/).

Why it ran: a production pass over the nine seed prompts found three of them
waiting 20–32 s for their first text delta. `claude-sonnet-5` thinks
adaptively when a request omits `thinking`, at effort `high`, and streams no
reasoning text, so the reasoning is silence before the answer.
`pnpm answer-latency-probe` confirmed it: the default spent 800–2 300
reasoning tokens on five of nine prompts (first text 11–28 s, median total
20.2 s, worst 41.8 s); `medium` spent none (first text ~1.2 s, median 13.1 s,
worst 19.6 s). `ANSWER_EFFORT` now reaches the route and every eval lane that
writes an answer.

| Read (27 Tier 1 + 9 abstention) | production, 2026-09-16 (default) | `medium`, this run |
| ------------------------------- | -------------------------------- | ------------------ |
| Tier 1 grounded                 | 25/27                            | 24/27              |
| Tier 1 adequate                 | 6/27                             | 4/27               |
| Requirements missed, total      | 43                               | 45                 |
| Citation-invariant violations   | 1                                | **0**              |
| Abstention                      | 8/9                              | **9/9**            |
| Answer characters, total        | 66 686                           | 57 445             |

What it says:

- **No regression the reading can separate from noise.** Adequacy moves by
  ±4 on an identical pipeline; 6 → 4 is inside it, and no case gained or lost
  more than one requirement except by judge wording. Groundedness trades
  cases: `medium` fixes `ho-cliente-espana-lleva-iva` (blocking in the
  production run) and `ho-rebajar-25-sin-facturas`, and fails three.
- **The three new groundedness fails.** `ho-rebajar-multa-si-pago-ya` gives a
  reason the fragments do not state — the same case failed the #305 arm A
  reading on the default, so it flips between readings. `ho-minimo-caja-independiente-2026`
  is a judgement on framing. `ho-800-mil-que-porcentaje-caja` is a real
  error: the chunk writes `₡746,186.000` and the answer rendered it
  `₡746.186.000`. It is the one to watch on the next full run.
- **T1-F's derived figures are not an effort question.** The probe's T1-F
  repeat left the BMC figures (`bmc-ivm-2026`, `bmc-sem-2026`) incompletely
  cited on 5/5 drafts at `medium` _and_ 3/5 at the default, with two more
  default drafts failing the marker check — no reasoning tokens in any of
  them.

Decision (#356): ship `ANSWER_EFFORT=medium`. The #352 re-run then measures
it as production runs it.

## The derived-figure check read a table row as a quote (2026-09-23, #403)

> **Measured 2026-09-23 on the local stack carrying #401's corpus, the T1-F
> seed prompt only, answer `claude-sonnet-5` at `ANSWER_EFFORT=medium`, ten
> drafts per side, no judge.** Rows in
> [`eval/runs/2026-09-23-t1f-derived-check/`](runs/2026-09-23-t1f-derived-check/).

The reading above left T1-F refused on most local drafts at any effort, and
production passing it. The two were not on the same corpus: production still
holds the 2026-09-16 ingest (876 chunks, 91 `ccss-faq`, no image
transcription), local holds #401's (873, 88, and the `av_tv_2026.png` escala
tables as text). `--keep-text` showed what the refused drafts wrote:

- **Every BMC sentence was completely cited** — «la base mínima contributiva
  de IVM para 2026 es de ¢324.590 [7][9], y la de Salud (SEM) es de ¢346.789
  [4][9]», on all ten drafts.
- **Every draft also copied the FAQ's escala table**, whose categoría 1 row
  reads «hasta ¢324.590,999», cited to the FAQ under the table. The check
  found figures by prefix, read that row as an uncited BMC quote, and refused
  the draft — 7/10.
- **The three that passed wrote ₡**, which the check did not read at all.

Fix: a quote is the figure as a whole number (ADR 0018, «What counts as a
quote»), and ₡ reads as ¢; F1's «both BMC figures quoted» assertion reads a
quote the same way (`quotesDerivedFigure`). Replayed, the ten refused-side
drafts — both figures resolved — pass 10/10. Ten fresh drafts pass 10/10, but
read only half of it: that retrieval left `ccss-escala-ivm` outside the top 8
(the reranker question #287 owns), so only `bmc-sem-2026` resolved, quoted
completely cited on all ten («¢346.789 [6][9]», one of them with ₡). #403's
bar was ≥ 9/10. A second fresh ten, with both figures resolved: 10/10
pass, nine of them quoting both figures («¢324.590 [7][9]», «¢346.789
[4][9]», one with ₡) and one quoting neither. F1 on the next full
run is the other half.

Not covered: a draft that copies the FAQ's en-US digits for the figure itself
(«¢324,590») is still not read as a quote — none of the thirty did.

Production still has to take #401's ingest; this change should reach it first.

### The FAQ escala in Costa Rican notation (2026-09-24, #407)

After #401's corpus reached production, the live T1-F answer copied the FAQ
escala as «hasta ₡346.789.999» — 346 million in Costa Rican notation. The
image prints its colón bounds in US notation («₡346,789.999»), the
transcription kept them, and the model swapped the thousands comma but kept
the `.999`. The same shape is the `ho-800-mil-que-porcentaje-caja` error in
the reading above. The transcription now writes them in Costa Rican notation,
value for value, and a manifest guard refuses a US-notation amount. Five fresh
T1-F drafts all copy «hasta ₡346.789,999», none misread. Rows in
[`eval/runs/2026-09-24-faq-cr-notation/`](runs/2026-09-24-faq-cr-notation/).

## One step pick, not one per sentence (2026-09-24, #311)

> **Measured 2026-09-24 on the local stack carrying #408's corpus, answer
> `claude-sonnet-5` at `ANSWER_EFFORT=medium`, judge `claude-sonnet-4-5`, two
> arms the same night.** Rows in
> [`eval/runs/2026-09-24-pin1/`](runs/2026-09-24-pin1/).

#304's `STEPS_RERANK=pin` bought three adequacy cases and lost the
groundedness gate with them: ten or eleven overlapping fragments, and the
answer mis-citing them. #311 measures the smallest version of the same move.
`STEPS_RERANK=pin1` makes `pin`'s picks and appends only **one**: the
highest-scoring pick the cut did not already take, so the prompt grows by one
fragment. #304's transcripts are gone, and the pipeline has moved since
(#401/#408 corpus, #403, `ANSWER_EFFORT=medium`), so the shipped default was
re-run beside it instead of read off #304's table.

| Gate                             | #304 `off` | #304 `pin` | `off`, today | `pin1`, today | Gate          |
| -------------------------------- | ---------- | ---------- | ------------ | ------------- | ------------- |
| Hit-rate                         | 71/73      | 71/73      | 71/73        | 71/73         | ≥ 0.92, pass  |
| Groundedness                     | 71/73      | 67/73      | **64/73**    | **67/73**     | ≥ 0.94, fails |
| Adequacy, cases with claims      | 16/40      | 18/40      | 16/40        | **18/40**     | —             |
| Tier 1 adequate                  | 5/27       | 5/27       | 5/27         | **7/27**      | 27/27, fails  |
| Tier 2 adequate                  | pass       | pass       | 11/13        | 11/13         | ≥ 0.8, pass   |
| Abstention                       | —          | 3/7        | 9/9          | 8/9           | ≥ 0.9         |
| Derived figures completely cited | —          | —          | red          | **green**     | none uncited  |

`pin1` appended a chunk on 60 of the 73 asks (61 classified to a family; on
one, every pick was already in the cut). The per-case read:

- **Gained where the append carries the missing requirement.**
  `multa-iva-no-declarado` goes grounded and adequate with `cnpt` 88 appended.
  It was one of `pin`'s four groundedness failures in #304.
  `inscripcion-tardia-sancion` goes adequate on the same chunk (the art. 88
  rebaja). `ccss-reglamento-ti` 12 appended takes
  `ho-800-mil-que-porcentaje-caja` to grounded and adequate, and
  `ho-minimo-caja-independiente-2026` and `ho-tambien-asegurado-por-patrono`
  to adequate.
- **Lost, and not on the appended fragment.** Four answers are newly
  ungrounded (`factura-primera-cabys`, `ho-desinscribir-debiendo-declaraciones`,
  `ho-t2-hosting-extranjero`, `ho-t2-salir-del-pais-seguro`). None of the
  judges' reasons cites [9], the appended fragment. The one that could be
  pin-shaped is `ho-desinscribir-debiendo-declaraciones`: an over-reading
  («sí puede desinscribirse aunque tenga declaraciones pendientes») beside the
  appended `cnpt` 79. `ho-tambien-asegurado-por-patrono` fails in both arms;
  under `pin1` it mis-cites [10], which is `salarios-minimos`, the
  derived-input pin, not `pin1`'s.
- **Noise.** The two arms' answer sets differ on 67 of 73 cases, not only by
  the append: the expansion rewrite is a model call and moves the pool from
  run to run, and adequacy moves ±4 on an identical pipeline. A +3/+2 at the
  gate is inside that. The per-case read is what says the mechanism holds:
  `pin`'s failures were the answer mis-indexing the extra fragments, and
  here no new failure cites the one extra fragment.
- The abstention case that flipped (`ho-abs-me-conviene-sociedad`) classifies
  to no family, so `pin1` did not change what it was handed.

**Decision: the default stays `off`.** #311's rule was to ship only if
groundedness stays ≥ 0.94 _and_ adequacy beats 16/40. Adequacy does (18/40);
groundedness does not (67/73 = 0.918). What the run adds is that the shipped
default is itself at **64/73**, down from 71/73 at #304, and neither arm
controls that: `ccss-ventana-prescripcion-24-meses` infers today's date,
`iva-servicios-extranjero-comprados` cites a «[49]» that is an artículo
number, the escala answers copy category bounds. That regression belongs to
#352's red gates and comes first. `pin1` stays measurable
(`STEPS_RERANK=pin1`) as the first thing to re-read once the baseline is back
over 0.94. On this run it beat `off` on every gate it moved.

**The harness.** `pin1`'s first groundedness lane died 26 minutes in. A judge
wrote a complete verdict followed by text carrying a brace, and
`parseJudgeVerdict`'s greedy first-`{`-to-last-`}` match spanned both.
`JSON.parse` threw inside `beforeAll` and took the whole lane with it.
`adequacy.ts` had already fixed that shape with `firstJsonObject`; the
groundedness and abstention parsers now use it too. The re-run's first attempt
then ran the Anthropic balance dry. **Cost:** ≈US$6 for the `off` arm, ≈US$5
for the lane that crashed, ≈US$4–5 for the attempt the balance ended, ≈US$5
for the lane that counted, and cents for a three-case smoke read in between.

## Groundedness back over the gate (2026-09-24, #352)

> **Measured 2026-09-24 on the local stack after `pnpm ingest ccss-faq`,
> answer `claude-sonnet-5` at `ANSWER_EFFORT=medium`, judge
> `claude-sonnet-4-5`, production knobs.** Rows in
> [`eval/runs/2026-09-24-352/`](runs/2026-09-24-352/).

#311's `off` arm put the shipped pipeline at groundedness **64/73**, under
the 0.94 gate and down from 71/73 at #304. Its nine ungrounded answers had
three shapes:

- **The escala bounds, read a thousand times too large.** #408 had written
  them `₡746.186,000`, and two T1-F answers still copied «₡746.186.000»
  (`ho-800-mil-que-porcentaje-caja`, `ho-tambien-asegurado-por-patrono`). The
  three decimals read as thousands exactly as the US notation had. The
  transcription now writes each bound as whole colones: «de ₡746.186 a menos
  de ₡1.492.370», and «₡2.238.555 o más» for the top category. These are the
  same ranges, and each lower bound is the exclusive upper of the category
  below. The manifest guard refuses any decimal part.
- **A marker the model never closed.** `iva-servicios-extranjero-comprados`
  wrote «[1] [3] [49 tomando base…». With no `]`, the invariant read 0
  violations and the renumbering left it alone, so the route would have shown
  «[49» to a reader instead of retrying. `validateCitations` now reads an
  unclosed `[n` (a bare integer, then space or the end of the text) as an
  unresolved marker, which the route already retries once and then declines.
- **Over-readings and judge wording.** Among them is the date case
  (`ccss-ventana-prescripcion-24-meses` says the window «ya venció»; true
  today, but no fragment carries today's date). It was read before changing
  anything.

**The scoped read** (the nine plus `ho-desde-cuanta-plata-caja`, ≈US$0.70):
8/10 grounded. Both escala answers copy «₡746.186» and «₡1.492.370», and
`ho-800-mil-que-porcentaje-caja` is also adequate. The date case passed as
written, so the prompt was not given a date on one reading's evidence. The
two that still fail are judge-side: `multa-iva-no-declarado` (whether the
art. 79 fine applies per omitted declaration, which the dataset's own claims
for `ho-desinscribir-debiendo-declaraciones` assert) and
`ho-minimo-caja-independiente-2026` (BMC wording).

**The full lane** (≈US$6):

| Gate                             | `off`, #311 (baseline) | This run             | Gate                |
| -------------------------------- | ---------------------- | -------------------- | ------------------- |
| Hit-rate                         | 71/73                  | 71/73                | ≥ 0.92, pass        |
| Blocking cases in the top-k      | pass                   | **red**              | all                 |
| Groundedness                     | 64/73                  | **70/73**            | ≥ 0.94, **pass**    |
| Blocking cases grounded          | red (2)                | red (1)              | 0 failing           |
| Adequacy, cases with claims      | 16/40                  | 13/40                | —                   |
| Tier 1 adequate                  | 5/27                   | 4/27                 | 27/27, fails        |
| Tier 2 adequate                  | 11/13                  | 9/13                 | ≥ 0.84, **fails**   |
| Abstention                       | 9/9, figure gate red   | 9/9, figure gate red | ≥ 0.9, zero figures |
| Citation invariant               | 0                      | 1                    | 0                   |
| Derived figures completely cited | red                    | red                  | none uncited        |

What moved, and what did not:

- **Groundedness 64 → 70/73, the aggregate gate green.** The three that fail
  are `multa-iva-no-declarado` (the per-declaration reading again, blocking),
  `ho-minimo-caja-independiente-2026` (the BMC figures against the derived
  ones) and `renta-declaracion-plazo` (a Régimen Simplificado fragment cited
  for the general rule).
- **The red rows that are not this change.** `ho-factura-electronica-o-recibo`
  sits at pool #2 in both runs and was reranked out of the top 8 this time,
  which is expansion variance on a comprobantes question. The five adequacy
  flips (`ho-rebajar-multa-si-pago-ya`, three Tier 2 losses, one Tier 2 gain)
  are on cases neither the escala nor the markers touch, inside the ±4 an
  identical pipeline moves. The invariant's one violation is a _closed_
  «[47]» on an 8-chunk answer (`ho-cliente-espana-lleva-iva`), an artículo
  number written as a marker. The route retries it.
- **Still #352's.** The blocking `multa-iva-no-declarado` reading, the
  abstention figure gate (`ho-abs-calculo-personalizado` again, now
  «¢41.040,00»), `ho-desde-cuanta-plata-caja`'s IVM BMC quoted without
  every input marker (red in both runs; the route refuses that draft), Tier 1
  adequacy, and the artículo-number-as-marker shape.

Production takes the corpus change with the owner-run `pnpm recrawl
ccss-faq`; the invariant change ships with the deploy.

### The 23 Tier 1 misses, classified (2026-09-24, #352 req. 1)

> **Read from the committed rows, no run.** Source:
> [`groundedness-…-20260924T081540Z.jsonl`](runs/2026-09-24-352/groundedness-claude-sonnet-5-effort-medium-20260924T081540Z.jsonl),
> the full lane above. Every missing requirement was read against the
> numbered chunk list its answer was handed, and a chunk outside that list
> was looked up in the local corpus (which production matches).

Tier 1 was 4/27 on that run. 22 cases failed the adequacy judge. The 23rd,
`ho-minimo-caja-independiente-2026`, passed the judge and missed two
literals. Together they have 54 missing requirements. A requirement that was
half stated or half carried is split into two rows, so the table below has 62. The buckets are #289's, plus one for requirements the answer does state:

- **retrieval**: the corpus carries it, but no chunk in the answer set does.
- **prompt**: a chunk in the answer set carries it, and the answer does not
  state it.
- **corpus**: no document carries it, or a document says less than the
  requirement asks for.
- **judge/literal**: the answer states it. Either the judge missed it, or
  the literal check does not accept the spelling the answer used.

| Case                                       | Missing | retrieval | prompt | corpus | judge/literal | What carries it (or why nothing does)                                                                                                                                                                                                                    |
| ------------------------------------------ | ------: | --------: | -----: | -----: | ------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `ho-hacienda-solo-cliente-eeuu`          |       2 |         2 |        |        |               | `tribu-cr-faq` Declaraciones del RUT · 2 (OVi, TRIBU-CR) · `cnpt` 78 (50 % per month)                                                                                                                                                                    |
| A `ho-trabajitos-por-mi-cuenta`            |       1 |         1 |        |        |             1 | Hacienda half: `tribu-cr-faq` RUT · 2. The CCSS half is stated                                                                                                                                                                                           |
| A `ho-donde-inscribo-ya-no-atv`            |       2 |         2 |        |        |             1 | `tribu-cr-faq` OVI · 1 (username = cédula/DIMEX/NITE) · RUT · 10/13/14 (the data the declaration asks for). The path is stated                                                                                                                           |
| B `ccss-obligacion-ingreso-bajo`           |       3 |         1 |      2 |        |               | prompt: `ccss-escala-salud` at [5], the note «la primera categoría es exclusivamente para…» and «0.9295 SM». retrieval: `ccss-faq` «¿Dónde me corresponde realizar el trámite de afiliación?»                                                            |
| B `ho-desde-cuanta-plata-caja`             |       3 |         1 |        |        |             2 | literal: the answer writes «0,9295 × ¢373.092,30» and «0,87 × …» (the derived figure's formula), and the check wants «0,9295 SM». retrieval: `ccss-reglamento-ti` 7/10 · `ccss-faq` «¿Dónde puedo pagar mi seguro?»                                      |
| B `ho-donde-me-afilio-caja`                |       1 |         1 |        |        |               | `ccss-faq` «¿Cuándo me corresponde pagar…?» (day by first surname)                                                                                                                                                                                       |
| C `ho-tiquete-en-vez-de-factura`           |       3 |         1 |      2 |        |               | prompt: `reglamento-comprobantes` 9 at [4], cited and the list not given; the «autorizado» status from [3]/[4]. retrieval: `reglamento-comprobantes` 4 (RUT + valid email)                                                                               |
| C `ho-factura-electronica-o-recibo`        |       2 |         2 |        |        |             1 | `reglamento-comprobantes` 16 (facturador gratuito) · 22 (cinco años). The provider half is stated                                                                                                                                                        |
| C `ho-cabys-paginas-web`                   |       1 |           |        |      1 |               | The BCCR catalogue URL is only in the manifest's `source.catalog` metadata, never in chunk text                                                                                                                                                          |
| D `ho-cliente-espana-lleva-iva`            |       5 |         4 |      1 |      1 |               | prompt: `ley-iva` 3 at [2] (hecho generador, «el acto que se realice primero»). retrieval: `ley-iva` 8, `reglamento-iva` 11, `reglamento-comprobantes` 2 inc. 14, `ley-iva` 10 (13 %). corpus: proof of consumption abroad                               |
| D `ho-iva-en-cero-sin-facturar`            |       2 |         2 |        |        |               | `tribu-cr-res-0011-2025` 2 (TRIBU-CR) + `cnpt` 79/88 · `cnpt` 79 (50 %)                                                                                                                                                                                  |
| E `ho-rebajar-25-sin-facturas`             |       2 |         1 |      1 |      1 |               | prompt: `ley-renta` 8 s) at [2] carries «Ley N° 10818 del 13 de noviembre de 2025». retrieval: the channel (`tribu-cr-res-0011-2025` 2). corpus: where in the return the option is chosen                                                                |
| E `ho-minimo-renta-2026`                   |       2 |         1 |        |      1 |               | retrieval: `ley-renta` 4 (1 Jan–31 Dec). corpus: where the tramos are published. The URL is only in the manifest                                                                                                                                         |
| E `ho-ademas-tengo-salario`                |       5 |         4 |      1 |        |               | prompt, borderline as in #289: both escalas at [1]/[3], «escalas distintas» never said. retrieval: `ley-renta` 22 (×2), 24 · `reglamento-renta` 26/28/30                                                                                                 |
| F `ho-800-mil-que-porcentaje-caja`         |       1 |         1 |        |        |               | `ccss-faq` «¿Cómo procedo si mis ingresos han variado?»                                                                                                                                                                                                  |
| F `ho-minimo-caja-independiente-2026`      |       2 |           |      2 |        |               | `salarios-minimos` 1 at [7] (¢373.092,30) · escalas at [3]/[5] (0.9295 SM, 0.87 SM). The answer gives only the derived ¢346.789/¢324.590                                                                                                                 |
| F `ho-tambien-asegurado-por-patrono`       |       1 |           |      1 |        |               | `ccss-reglamento-ti` 1 at [4] (the salary side) beside art. 10 at [7]. The answer puts all ¢800.000 on the TI escala                                                                                                                                     |
| G `ccss-pedir-prescripcion-cuotas`         |       3 |         3 |        |        |             1 | `ccss-prescripcion` Guía «¿Cómo se solicita…?» / «¿Dónde presento…?» (the channel per phase, cobros@ccss.sa.cr). The recrawled `ccss-faq` Ley 10.363 entry on where to file was not in the set. judge: the step's plazo half is stated (20 días hábiles) |
| H `desinscripcion-dejar-actividad`         |       2 |         2 |        |        |               | `ley-iva` 27 (the duty lasts until desinscripción) + `cnpt` 79 · `reglamento-iva` 67 (existencias)                                                                                                                                                       |
| H `ho-desinscribir-debiendo-declaraciones` |       4 |         2 |        |      2 |               | retrieval: `ley-iva` 27 · `cnpt` 79. corpus: no document says that desinscripción leaves accrued obligations in place, or that pending declarations are filed first                                                                                      |
| I `multa-iva-no-declarado`                 |       3 |         3 |        |        |             1 | `cnpt` 57 (interest) · 88 · `salario-base-2026`. judge: the 80 bis half of the first claim is stated                                                                                                                                                     |
| I `inscripcion-tardia-sancion`             |       3 |         3 |        |        |               | `cnpt` 88 (×2, the second with `tribu-cr-faq` RUT · 2) · `salario-base-2026`                                                                                                                                                                             |
| I `ho-rebajar-multa-si-pago-ya`            |       1 |         1 |        |        |             1 | The substance is stated. The channel is not: TRIBU-CR (`tribu-cr-res-0011-2025` 2) against the answer's «portal de Hacienda»                                                                                                                             |
| **Total**                                  |  **54** |    **38** | **10** |  **6** |         **8** | 62 rows                                                                                                                                                                                                                                                  |

What it says:

- **Retrieval is most of it: 38 of 62 rows.** In 13 cases retrieval is the
  only cause, not counting the judge/literal halves. The same documents keep
  going missing: `cnpt` 79 or 88 in five cases, the TRIBU-CR channel
  (`tribu-cr-faq` RUT · 2, `tribu-cr-res-0011-2025` 2) in six, a `ccss-faq`
  entry on affiliation, payment or changing the declared income in four, and
  `salario-base-2026` in both T1-I cases that ask for it. Almost every
  carrying chunk is in the case's own `expected` list, or is the article one
  of those points to. That is #287's territory and the step catalogue's, not
  the prompt's.
- **The prompt misses 10 rows over 7 cases. Three are one shape: a derived
  figure quoted without what it was derived from.** The derived-figure block
  gives the model «¢346.789 (0,9295 × ¢373.092,30)». The answers quote the
  colones and drop «0,9295 SM», «0,87 SM» and the ¢373.092,30 salario mínimo
  (`ho-minimo-caja-independiente-2026` ×2, `ccss-obligacion-ingreso-bajo`).
  `ho-desde-cuanta-plata-caja`'s two literal rows are the same shape from the
  other side: the answer copies the formula's spelling, «0,9295 × …», which
  the literal check does not accept. The other seven are rule 9's shape
  again: a cited list not given (art. 9) and a status it implies, a delimiting
  clause not stated (categoría 1's exclusivity, hecho generador, two escalas,
  the salary side), and the Ley 10818 note.
- **Six rows the corpus cannot satisfy as written.** The CABYS and tramos
  «where to look it up» steps point at URLs that exist only in manifest
  metadata. `ho-desinscribir-debiendo-declaraciones` asserts two things no
  document says: that desinscripción leaves accrued obligations in place, and
  that pending declarations are filed first. The T1-D and T1-E steps ask for
  proof of consumption abroad and for form mechanics that the corpus does not
  describe. Each needs a dataset ruling or a new source; the prompt cannot fix
  them. The dataset is unchanged here.
- **A perfect prompt would lift two cases.** Only
  `ho-minimo-caja-independiente-2026` and `ho-tambien-asegurado-por-patrono`
  have no retrieval or corpus row. The other 21 do. Tier 1 27/27 cannot be
  reached from the answer side.

### Three prompt rules, not yet measured (#352 req. 3, 4 and the blocking case)

Both are read from the same run and changed with no paid call. The req. 5
re-run is what measures them.

- **No arithmetic on the asker's data.** `ho-abs-calculo-personalizado`
  declined the liquidación and gave the escala with its citation. Then it
  wrote «con dos hijos … ¢41.040,00 en total»: the cited ¢20.520,00 per
  hijo, times the asker's own count. No document carries ¢41.040,00, so the
  figure gate counts it as invented. Rule 3 now says a document's figure is
  not operated with the person's data (multiplied by their hijos, added to
  their income, taken off their tax). The figure is given as the documents
  give it. Placing the person in a tramo or categoría is comparison, not
  arithmetic, and stays allowed: `ho-800-mil-que-porcentaje-caja` requires
  it, and rule 9 gives the escala so the reader can be placed in it. Rule 6c
  now says a liquidación personalizada is declined even when the documents
  carry every tarifa, tramo and monto in it, «ni siquiera en parte».
- **The marker is the document's number, never an artículo's.**
  `ho-cliente-espana-lleva-iva` wrote «[6][47]». `reglamento-iva` art. 47
  was at [5] in its 8-chunk set. Rule 2 now says the bracket number is the
  document's position in the list, never the number of an artículo, ley or
  decreto, and gives the art. 47 example. The citation retry note says the
  same, so the one retry the route allows names the mistake.

- **No count of a sanction the documents do not state.**
  `multa-iva-no-declarado` is the one blocking groundedness failure left.
  `cnpt` art. 79 gives «una multa equivalente al cincuenta por ciento (50%)
  del salario base» to whoever omits «las declaraciones», and says nothing
  about how it is counted. The judge failed «se aplica por cada declaración
  omitida» 3/3 on the scoped read, and «multa fija … no se calcula por cada
  mes» 3/3 on the full lane. It rejects a count in either direction. The
  hedged «en principio … por cada una» passed 3/3 on 2026-09-09/11. The
  dataset's «Cada declaración omitida…» wording on this case and on
  `ho-desinscribir-debiendo-declaraciones` is on literal-typed claims, which
  the judge never reads (`adequacy.ts`), so only «50 %» is scored. The owner
  ruled for a prompt fix: rule 9's closing clause now says a sanction is
  stated as the document gives it, never counted «por cada declaración, por
  cada período o una sola vez» unless the documents say so, and a question
  spanning several periods is told that the documents do not specify the
  count and is referred on under rule 6. The dataset and the judge are
  unchanged.
