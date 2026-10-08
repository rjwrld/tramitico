# The two final lanes, 2026-10-08 (#512)

The measurement that re-sets the tracked baselines (ADR 0023 and its #474
amendment), after map #497's Phase 2 landed. It is two runs of
`pnpm test:eval`, serial, on main at b8d8667, with a three-case smoke first.
The setup is #511's: `claude-sonnet-5-5` at `ANSWER_EFFORT=low` (production's
value), judge `claude-sonnet-4-5`, and condensation and expansion on
`claude-haiku-5-5`. Every other knob was at its code default, which is
production's: `STEPS=on STEPS_RERANK=pin1 EXPAND=on RERANK=voyage
PIN_DERIVED_INPUTS=on PIN_CROSS_REFERENCES=on ANSWER_TOP_K=8
ANSWER_DOC_CAP=off`. The rewrites were live (no `EVAL_REWRITES`). The shared
local stack held the 873-chunk corpus after #530's re-ingest, which matches
main's `eval/corpus-index.json` (PR #544). The census read 278/278 targets
satisfiable in both lanes.

Main at that commit carries, beyond #511's lane (66a2cf9): #507 (the prompt
sees only part of the documents; rule 7), #508 (cross-reference pins), #509
(rate anchors), #510, #519 (knob validation), #529 (overridden figures
withheld), #530 (`reglamento-iva`'s Artículo 25, re-ingested) and #536/#543
(scoped lanes, the held-out guard).

| File                                          | What it is                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `smoke-groundedness-…T060319Z.log` · `smoke/` | The three-case smoke: 3/3 grounded, no rerank reading lost (of 19), no provider error.                 |
| `lane1-…T060441Z.log` · `lane1/`              | Lane 1, 58 min: the groundedness (101 rows; one carries two re-asks) and abstention (15 rows) records. |
| `lane2-…T070310Z.log` · `lane2/`              | Lane 2, 30 min: the groundedness (101 rows) and abstention (15 rows) records.                          |

The smoke cases were #511's: `ccss-cuanto-pago-base`,
`ho-ademas-tengo-salario` and `ho-iva-en-cero-sin-facturar`. The logs' paths to
the checkout are replaced with `<worktree>`. Nothing else is edited. The
transcripts are also copied to the main checkout's
`eval/transcripts/2026-10-08-final-512/`, as the next `answer-replay` input.

**No provider error.** Neither lane logged a 429, 5xx or overloaded response.
Lane 1 had two client-side timeouts, and each fell back as production does:
one query expansion (`expansion failed — reason=timeout`, as in #511 and the
2026-10-02 lane), and one step-leg rerank reading
(`iva-retencion-tarjetas-porcentaje(step:timeout)`, 1 of 572), so that case
was answered on its fused order for the step leg. Lane 2 had none. No
condensation timed out in either lane, so #511's `ccss-asalariado-followup`
fallback did not recur, and it is grounded in both. Lane 1 took 58 minutes
against lane 2's 30 and #511's 30.5. Nothing in its log explains it beyond
slower calls.

## Gates

| Gate                                           | #511 (one lane)  | Lane 1           | Lane 2       | Read                                                     |
| ---------------------------------------------- | ---------------- | ---------------- | ------------ | -------------------------------------------------------- |
| Groundedness, judges' first verdict (#474)     | 72/74            | **73/74**        | **73/74**    | baseline re-set to **73** (floor 69)                     |
| Blocking cases, 2 of 3 answers (#474)          | red (1)          | **red (1)**      | **green**    | `multa-iva-no-declarado`, 2 of 3; see below              |
| False corpus-absence claims (#500)             | 4                | **0**            | **0**        | green: #507's prompt holds on full lanes                 |
| Tier 1 requirements stated                     | 86/116           | **78/116**       | **79/116**   | baseline re-set to **78** (floor 74)                     |
| Tier 1 cases fully adequate (reported)         | 7/27             | 4/27             | 5/27         | reported, not gated                                      |
| Tier 2 adequate ≥ 84%                          | 12/14            | **12/14**        | **13/14**    | green                                                    |
| Citation invariant                             | 0                | 0                | 0            | green                                                    |
| Derived figures completely cited; F1 both BMCs | green            | green            | green        | green                                                    |
| Abstention ≥ 90%                               | 14/15            | **14/15**        | **15/15**    | green; lane 1 fails `ho-abs-calculo-personalizado`       |
| `ho-abs-iva-2027` requirement (#502)           | 0/1              | 0/1              | 0/1          | not armed: no «artículo 10» in either answer             |
| Hit-rate ≥ 92%                                 | 68/74 (red)      | **72/74**        | **73/74**    | green (97.3%, 98.6%)                                     |
| Every blocking case hits                       | red (1)          | green            | green        |                                                          |
| Never weak on a legitimate question            | green            | green            | green        |                                                          |
| Robustness block, hit (#502)                   | 25/27            | **27/27**        | **27/27**    | baseline raised to **27** (floor 25)                     |
| Conflicting sources, amending law, census      | green            | green            | green        | census 278/278                                           |
| vitest                                         | 2 failed, 6 pass | 1 failed, 7 pass | **8 passed** | lane 2 is the first all-green full lane since 2026-09-24 |

### How the baselines were set

Each tracked baseline is the lower of the two lanes, which both reached: the
point of two lanes is that one can't separate a change from answer variance.
Groundedness reads 73 in both, Tier 1 78 and 79, and the robustness block 27
in both. The false-absence gate stays at zero, which both lanes met. The
margins are unchanged (4, 4 and 2), so a lane now fails at groundedness ≤ 68,
Tier 1 ≤ 73 or robustness ≤ 24.

The hit-rate gate stays at 0.92. Both lanes clear it with room, but the ratchet
rule's «measured minus one case» (0.95) would move a gate #511 failed by a
fraction of one case on the strength of these two lanes alone. #512 does not
re-set it.

### Tier 1: about half of #511's +16 holds

| Read                                | Tier 1 / 116 |
| ----------------------------------- | ------------ |
| 2026-10-02 lane (the held baseline) | 70           |
| #511's lane, prompt unchanged       | 86           |
| #507's replays (control, round 1)   | 78, 85       |
| **#512 lane 1, lane 2**             | **78, 79**   |

The two lanes agree within one requirement, so 78–79 is the pipeline's level
on main: +8 over 70, past the ±4 noise, and 7–8 under #511's 86. #511's lane
looks like the top of the spread rather than a level, but two lanes don't
settle which of #507, #508 and #509 moved what. #507's round-1 replay at 85
did not carry to a full lane. The misses are still where-and-how: TRIBU-CR
and OVi steps, CCSS channels, and how to regularize (each lane's `missing:`
lists).

### Groundedness and the blocking red

The judges failed one of 74 answers in each lane:

- Lane 1: `multa-iva-no-declarado`, 3/3, `inference`. The answer computes the
  artículo 79 fine (¢231.100) and then says «Las fuentes no dicen si esa multa
  se aplica por cada declaración omitida o una sola vez cuando se omiten
  varias». The derived figure it cites is labelled «por cada declaración
  tributaria omitida». The first re-ask failed the same way, and the second
  passed, so the case fails on 2 of 3. Lane 2's answer makes the same hedge
  («Las fuentes no dicen cómo se cuenta esa multa cuando se omiten varios
  períodos seguidos») and the judges passed it. It is the 2026-09-25 lane's
  «art. 79 count» again. #500's detector does not catch it, since it's about a
  rule, not an artículo or a listed figure.
- Lane 2: `exportacion-servicios-comprobante`, fail/pass/fail, `inference`.
  It's a strict call on the export invoice's use, which the fragment defines
  but doesn't spell out for exempt exports.

In the block, lane 1 fails `rb-pill-impuesto-renta` (`contradiction`: «el
Código de Trabajo no aplica a independientes», in no fragment). Lane 2 fails
`rb-corto-tramos-renta` («Como usted trabaja por cuenta propia» on a question
that says no such thing) and `rb-spanglish-invoice` (a strict call). The
block's groundedness reads 26/27 and 25/27.

**The labels against a human read (#474).** Of the five distinct cases above,
the label matches the read on four: `rb-pill-impuesto-renta` is a real error
and `contradiction`, and the three `inference` calls in lane 2 are defensible
readings or an assumption about the user. On `multa-iva-no-declarado` it
doesn't. Both of its failing answers are labelled `inference`, but the hedge
denies what the cited figure states, which is a real error. Four of five is
not enough to gate on, so the label stays recorded only.

### False absence claims: zero on both lanes

Neither lane made a false absence claim, in groundedness or in abstention
(#511's lane made four). #507's rule 7 holds on the full pipeline, and rule
6c with it: `ho-abs-iva-2027` declines the 2027 rate («Los documentos
oficiales no traen ninguna cifra para 2027») and states the cited 13 %. In
both lanes it still names no «artículo 10», so its requirement reads 0/1 and
the assertion stays a todo. Answers that open with an absence claim
(reported): 8/103 and 9/101 in groundedness, and 11/15 and 10/15 declines.

### Abstention

Lane 1 fails `ho-abs-calculo-personalizado` (3/3). The answer declines the exact
figure, then sets out the tramos table and the credits, and never sends the
reader to Hacienda or a contador. Lane 2 passes it. #508's scoped lane failed
the same case 3/3, and #511's lane passed it, so it is a case on the edge
rather than one that broke.

All 15 abstentions in both lanes took the model path (`route: "model"`). The
deterministic routed decline is still unexercised by any lane, as in #511.
None of the six routed cases has a question that takes weak retrieval.

### Hit-rate

Lane 1 misses `ho-t2-credito-iva-compras` (not in the pool) and
`ho-t2-autorizar-contador` (pool #2, reranked out). Lane 2 misses only
`ho-t2-credito-iva-compras`. `iva-tarifa-general`, which missed in #511 and in
#502's probe, hits in both: #508's and #509's `ley-iva` artículo 10 reaches
the answer set. The robustness block hits 27/27 in both lanes, up from 25.

### Rule 3: `rb-seguimiento-de-cuanto-multa` computes with the reader's data

#507's carry-over asked whether this recurs. It does, in both lanes: «Como
usted habla de un año sin registrarse, la multa mensual llegaría al tope antes
de completar los doce meses» (lane 1), «En su caso, trabajando un año sin
inscribirse, la sanción por mes o fracción de mes ya habría llegado al tope»
(lane 2). Both judges passed it. It has its own issue.

## Cost

There is no console figure. The estimate scales #511's breakdown by the
transcripts' own token counts. The answer prompts sum to 1.64 M and 1.66 M
input tokens (`pnpm prompt-tokens`, free), against #511's 1.49 M, since #508's
pins add fragments. The answers wrote 128 k and 125 k output tokens.

| Step                                                       | ≈US$    |
| ---------------------------------------------------------- | ------- |
| Balance check (one-token Haiku call)                       | 0.00    |
| Smoke (3 answers, judges, rewrites, rerank)                | 0.20    |
| Lane 1: 101 answers and 2 re-asks                          | 3.50    |
| Lane 1: judges, adequacy and label judges                  | 4.80    |
| Lane 1: abstention, fixtures, embeddings, rerank, rewrites | 2.10    |
| Lane 2: 101 answers                                        | 3.40    |
| Lane 2: judges, adequacy and label judges                  | 4.70    |
| Lane 2: abstention, fixtures, embeddings, rerank, rewrites | 2.10    |
| **Total**                                                  | **≈21** |

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
