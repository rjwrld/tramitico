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
the production retrieval path — fused pool of 30, Voyage rerank, top-8 — and
gates on hit-rate, the blocking canary, and the weak-retrieval threshold. It is
env-gated: skipped without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and real
embeddings; CI runs it once those secrets exist (see `.github/workflows/ci.yml`).

Run locally:

```sh
supabase start && pnpm ingest   # once
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
pnpm vitest run src/lib/eval/retrieval-hitrate.eval.test.ts
```

`RERANK=off` measures the fused-only baseline; the per-case table (pool rank,
top score) prints with the run. Since #286 the retrieval a case runs is also
the _expanded_ one — a Haiku rewrite of the question into corpus register,
fused as two further legs — so a run without `ANTHROPIC_API_KEY` measures a
different search than a run with one. `EXPAND=off` opts out explicitly, and is
what to set when comparing against a pre-#286 number.

For a single case, `pnpm pool-dump <case id> …` prints the top of the fused
pool with every leg's rank and the expansion that produced it — the diagnostic
#286 was written with, and the cheapest way to tell a chunk problem from a
register problem (one embed per case, no answer model).

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
  Tier 1 case without `blocking: true`). The weekly `eval.yml` cron will be
  red until then — that is the pressure, not a defect.

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
them, so an expansion can only add candidates: both expansion arguments
default to null and reproduce v4 row for row, which is what `EXPAND=off` and
every keyless lane get.

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
(`ho-trabajitos-por-mi-cuenta`, 3 → 7): the "can only add" property holds
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
**and** its expansion (`rerankQuery`, rerank.ts). Both, not the expansion
alone: the rewrite is a probe and the question is what the reader asked, and
dropping the question costs a case the reader's own words carry.

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
prompt.

**Two blocking cases remain**, and neither is #286's:
`ho-donde-inscribo-ya-no-atv` (a `seguimiento` case — it fails on the
condensation, and its pool rank 7 has not moved) and the regression above.

Reproduce any of this with `pnpm pool-dump <case id> …`, which prints the top
of the fused pool with all four leg ranks (`--no-expansion` for the v4 pool).

### Retrieval, groundedness and adequacy, per case

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
- `ho-cabys-paginas-web` — Cada línea de detalle del comprobante lleva su código CABYS.
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
pnpm vitest run src/lib/eval/dataset-satisfiability.eval.test.ts
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
pnpm vitest run src/lib/eval/groundedness.eval.test.ts
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
pnpm vitest run src/lib/eval/adequacy.eval.test.ts
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

Prompt rule 10 tells the answer to use a markdown table «cuando los datos sean
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
pnpm vitest run src/lib/eval/conflicting-sources.eval.test.ts
```

Verified 2026-08-13 (answer `claude-sonnet-5`, judge `claude-sonnet-4-5`):
pass — the answer opens with «Las fuentes discrepan…», names each decree with
its own figure and marker, and refers the reader to Hacienda for which one
rules.
