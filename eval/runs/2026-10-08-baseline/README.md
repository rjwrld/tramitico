# The baseline full lane, 2026-10-08 (#511)

The measurement the Phase 2 tickets of map #497 (#507, #508, #509, #510) are
read against. It is one run of `pnpm test:eval` on main at 66a2cf9, with a
three-case smoke first. The setup was `claude-sonnet-5-5` at
`ANSWER_EFFORT=low` (production's value), judge `claude-sonnet-4-5`, and
condensation and expansion on `claude-haiku-5-5` (#496). Every other knob was
at its code default, which is production's: `STEPS=on STEPS_RERANK=pin1
EXPAND=on RERANK=voyage PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8
ANSWER_DOC_CAP=off`. The rewrites were live (no `EVAL_REWRITES`). The shared
local stack held the 873-chunk corpus after #520's re-ingest of six SINALEVI
documents (PR #524), which matches main's `eval/corpus-index.json` (PR #533).
The census read 278/278 targets satisfiable.

Main at that commit carries, beyond the 2026-10-02 lane:

- #496: Haiku 5.5 rewrites;
- #500: the false-absence detector and its zero gate;
- #502: the robustness block;
- #503: six routed abstentions and `t2-inscripcion-dimex`;
- #474: groundedness as a tracked count, and blocking cases on 2 of 3 answers;
- #505 and #518: fiscal-year withholding;
- #499: knob validation.

It does not carry #508, #509, #510 or #519. Those changes are deliberately
measured after this run.

| File                                          | What it is                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `smoke-groundedness-…T015516Z.log` · `smoke/` | The three-case smoke: 3/3 grounded, no rerank reading lost (of 17), no provider error. Gates fail by design. |
| `low-…T015633Z.log` · `low/`                  | The full run, 30.5 min: the groundedness (101 rows) and abstention (15 rows) transcripts.                    |

The smoke cases were `ccss-cuanto-pago-base`, `ho-ademas-tengo-salario` and
`ho-iva-en-cero-sin-facturar`. The logs' paths to the checkout are replaced
with `<worktree>`. Nothing else is edited.

**No provider error.** The run logged no 429, 5xx or overloaded response, and
no rerank reading was lost: 0 of 41 in the abstention lane, 0 of 527 in the
hit-rate lane, 0 of 522 in the groundedness lane. Two small-model calls hit
the client-side timeout, and each ask fell back as production does:

- One query expansion: `expansion failed — reason=timeout`. The 2026-10-02
  run logged one too.
- One condensation, in the groundedness lane. `ccss-asalariado-followup` was
  retrieved and answered on its raw follow-up, «¿Y si también soy
  asalariado?», and that answer is one of the two the judges failed. In the
  hit-rate lane the same case condensed normally.

Neither is a provider error, so the run is recorded.

## Gates against the 2026-10-02 lane

| Gate                                           | 2026-10-02 (ADR 0023) | This run          | Read                                                                         |
| ---------------------------------------------- | --------------------- | ----------------- | ---------------------------------------------------------------------------- |
| Groundedness, judges' first verdict (#474)     | 68/73                 | **72/74**         | green (floor 64); beats the baseline, held at 68 (no ratchet, below)         |
| Blocking cases, 2 of 3 answers (#474)          | red (1)               | **red (1)**       | `ho-trabajitos-por-mi-cuenta`, by #500's override, not the judges; 0 re-asks |
| False corpus-absence claims (#500)             | not gated yet         | **4**             | red by design: #507's starting point, see below                              |
| Tier 1 requirements stated                     | 70/116                | **86/116**        | green (floor 66); +16, past the ±4 noise; held at 70 (no ratchet, below)     |
| Tier 1 cases fully adequate (reported)         | 6/27                  | 7/27              | reported, not gated                                                          |
| Tier 2 adequate ≥ 84%                          | 10/13                 | **12/14**         | green (85.7%)                                                                |
| Citation invariant                             | 0                     | 0                 | green                                                                        |
| Derived figures completely cited; F1 both BMCs | green                 | green             | green                                                                        |
| Abstention ≥ 90%                               | 9/9                   | **14/15**         | green; `ho-abs-iva-2027` fails (3/3 judges)                                  |
| `ho-abs-iva-2027` requirement (#502)           | —                     | 0/1               | todo until #507 and #508: no «artículo 10» in the answer                     |
| Hit-rate ≥ 92%                                 | green                 | **68/74 (91.9%)** | **red**, by a fraction of one case                                           |
| Every blocking case hits                       | green                 | **red (1)**       | `ho-desinscribir-debiendo-declaraciones`, run-to-run variance, see below     |
| Never weak on a legitimate question            | green                 | green             |                                                                              |
| Robustness block, hit (#502)                   | —                     | **25/27**         | sets `ROBUSTNESS_HIT_BASELINE` = 25 (floor 23)                               |
| Conflicting sources, amending law, census      | green                 | green             | census 278/278                                                               |

The vitest summary was 2 files failed, 6 passed. Of 40 tests, 4 failed, 33
passed, 1 was skipped and 2 were todos (the robustness gate, armed by this
PR, and the `ho-abs-iva-2027` requirement).

### Groundedness

The judges failed two of the 74 answers outside the block:

- `cabys-desarrollo-software`, 3/3, `contradiction`: the answer writes the
  CABYS code with its trailing zeros (8314300000000), and the fragment
  writes it without them.
- `ccss-asalariado-followup`, 3/3, `inference`: answered on the
  uncondensed follow-up after the timeout above.

The failure labels (#474, recorded, not gated) were contradiction 1 and
inference 2, the second inference being the block's `rb-corto-cuanto-es-iva`.
By exposure, the groundedness lane read first-exposure 30/32, promoted 7/7 and
corpus-derived 32/35.

### False absence claims: #507's starting point

The groundedness lane made four false absence claims, and the abstention lane
made none:

| Case                             | Absent, says the answer | Sentence                                                                                                                                                  |
| -------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iva-ajuste-bien-de-capital`     | salario base            | «Los documentos no traen el monto del salario base, así que debe confirmarlo con Hacienda.»                                                               |
| `ho-trabajitos-por-mi-cuenta`    | BMC                     | «Los documentos oficiales no traen el valor actual de la BMC, ni el portal o formulario específico para inscribirse en Hacienda.»                         |
| `ho-t2-panaderia-simplificado`   | salario base            | «Los documentos oficiales no traen el valor de un salario base en colones, ni el procedimiento para solicitar la inscripción en el régimen, ni el canal…» |
| `rb-seguimiento-de-cuanto-multa` | salario base            | «Los documentos no traen el monto del salario base ni dicen cuántos meses cuenta la omisión en su caso.»                                                  |

#511's comments expected about 7 groundedness cases, two of them blocking,
from the detector's backtest of the 2026-10-02 answers. This run has 4 cases
(3 outside the block), and one is blocking: `ho-trabajitos-por-mi-cuenta`,
which the judges passed. Its false claim fails the case outright, since the
override wins over the 2-of-3 rule. That claim is the whole blocking red. Of
the backtest's eight answers, `iva-ajuste-bien-de-capital`,
`ho-trabajitos-por-mi-cuenta` and `ho-t2-panaderia-simplificado` repeat here.
In this run, 9 of 100 answers open with an absence claim (reported, not
gated), and in the abstention lane 11 of 15 declines do, as declines should.

### Tier 1: +16 on an unchanged prompt

`pnpm requirement-coverage` reads 70/116 off the 2026-10-02 transcript and
86/116 off this one (free), so the gain is in the answers, not in the scoring.
The answer prompt has not changed since that lane. What has changed is
#496's rewrites, #505's and #518's withholding of out-of-period figures, and
#520's re-ingest, which repaired joined words in the chunks literal checks
read. This run does not isolate the cause.

The gain is spread across cases. These partial cases moved:

| Case                              | 2026-10-02 | This run |
| --------------------------------- | ---------- | -------- |
| `ccss-obligacion-ingreso-bajo`    | 1/5        | 4/5      |
| `ccss-pedir-prescripcion-cuotas`  | 2/5        | 4/5      |
| `ho-factura-electronica-o-recibo` | 1/4        | 3/4      |
| `ho-tiquete-en-vez-de-factura`    | 1/4        | 3/4      |
| `ho-trabajitos-por-mi-cuenta`     | 1/4        | 3/4      |
| `ho-ademas-tengo-salario`         | 1/6        | 2/6      |
| `ho-donde-inscribo-ya-no-atv`     | 2/4        | 3/4      |
| `ho-iva-en-cero-sin-facturar`     | 2/4        | 3/4      |

The missing requirements are still mostly where-and-how content: TRIBU-CR
and OVi steps, CCSS channels, and how to regularize. The log's `missing:`
lists name each one.

**No ratchet.** ADR 0023's rule, «a lane that beats it moves the baseline
up», would raise Tier 1 to 86 and groundedness to 72. The owner held both
(2026-10-08), so `TIER1_REQUIREMENT_BASELINE` stays at 70 and
`GROUNDEDNESS_BASELINE` at 68, for four reasons:

- it is one lane;
- the Tier 1 +16 is unexplained, since the answer prompt had not changed;
- the pipeline changes again before #512 (Track 2 and #507);
- #512's two final lanes re-set both baselines.

This run's 72/74 and 86/116 are recorded as #511's reading.

### Hit-rate: red by a fraction, and the blocking miss is variance

68 of 74 is 91.9%, so the 92% gate needed 69. The misses, with each target's
pool rank:

- `iva-tarifa-general`: not in the pool;
- `ccss-asalariado-followup`: pool #27;
- `ho-desinscribir-debiendo-declaraciones`: pool #8;
- `ho-t2-credito-iva-compras`: pool #13;
- `ho-t2-hosting-extranjero`: pool #12;
- `ho-t2-payoneer`: pool #11.

#502's Haiku 5.5 probe arm, one day earlier, missed `iva-tarifa-general`,
`ho-t2-credito-iva-compras`, `ho-t2-autorizar-contador` and `ho-t2-payoneer`
(69/73). The colloquial misses on Haiku 5.5 rewrites are #509's.

`ho-desinscribir-debiendo-declaraciones` is the blocking hit miss. Its
`reglamento-renta` Artículo 27 was reranked out of the hit-rate lane's top 8.
But the groundedness lane's own retrieval of the same case, minutes later, put
that artículo in the answer set: same stack, a different live expansion. That
is run-to-run variance on Haiku 5.5's expansion, not an effect of the
re-ingest.

### Robustness block

Each lane printed the block's line:

- **Hit-rate: 25/27.** It misses `rb-pill-retroactivo` (target at pool #8,
  reranked #12) and `rb-corto-cuanto-es-iva`, whose seed
  `iva-tarifa-general` misses too. This sets `ROBUSTNESS_HIT_BASELINE = 25`.
  #502's two probe arms read 24 and 25.
- **Groundedness: 25/27.** It misses `rb-corto-cuanto-es-iva`, whose answer
  says the documents carry no single rate, and `rb-seguimiento-de-cuanto-multa`
  (a false absence claim).
- **Adequacy: 0 of 7 Tier 1 block cases adequate, 24 of 37 requirements
  stated.**

### Routed cases and the two #508 cases

The six routed abstentions (`abs-pasaporte-renovar`, `abs-dimex-sacar`,
`abs-residencia-permanente`, `abs-ins-riesgos-trabajo`,
`abs-licencia-conducir`, `abs-patente-comercial`) all pass, each on the
model path. None took weak retrieval, so the deterministic routed decline
is still unexercised by any lane. `t2-inscripcion-dimex`, the case that must
not route, hits at pool #1, is grounded and is Tier 2 adequate.

`ho-abs-calculo-personalizado` and `ho-abs-sociedad-inactiva` both pass on
main, on the model path. Their 3/3 failures in #508's scoped abstention lane
therefore belong to #508's branch, not to main.

### Rerank drops

There were none. 1,090 rerank readings across the three lanes came back
whole. This is the pipeline production has run since #498 put the rerank
back on 2026-10-07.

## The `RERANK=off` probe arm: what production lost before #498

Production served the fused-only order from 2026-09-15 until #498 restored
the rerank on 2026-10-07. This arm asks what that order cost. It ran after
the lane, with the owner's OK: `RERANK=off pnpm answer-set-probe` over every
retrieval and abstention case, with live rewrites, on the same stack and the
same day. That is retrieval and rewrites only, with no answer model and no
judge.

| File                             | What it is                                                   |
| -------------------------------- | ------------------------------------------------------------ |
| `probe-rerank-off-…T030553Z.log` | its output: no provider call lost, no condensation fell back |
| `probe-rerank-off.json`          | every case's pool, order and answer set                      |

**The comparison.** The on side is this lane's hit-rate read, which uses
production's route configuration (`top8/capoff/pinon`). The off side is the
probe under the same configuration. Each side ran its own live expansion, so
part of every delta below is expansion noise. The lane's blocking miss shows
how much: it hits under `off`.

| Under `top8/capoff/pinon`            | Rerank on (the lane) | `RERANK=off` (probe) | Δ      |
| ------------------------------------ | -------------------- | -------------------- | ------ |
| **Tier 1 targets in the answer set** | **62/93**            | **58/93**            | **−4** |
| Tier 1 cases holding every target    | 12/27                | 11/27                | −1     |
| Every target outside the block       | 135/193              | 116/193              | −19    |
| Cases that hit, outside the block    | 68/74                | 64/74                | −4     |
| Robustness block hits                | 25/27                | 21/27                | −4     |

- **Tier 1 lost little, net.** The −4 is 9 targets lost and 5 gained across
  12 cases, and every Tier 1 case kept at least one target.
  - Lost: `multa-iva-no-declarado` −2, and −1 each in
    `desinscripcion-dejar-actividad`, `ho-trabajitos-por-mi-cuenta`,
    `ho-desde-cuanta-plata-caja`, `ho-factura-electronica-o-recibo`,
    `ho-minimo-renta-2026`, `ho-ademas-tengo-salario` and
    `ho-rebajar-multa-si-pago-ya`.
  - Gained: `ho-desinscribir-debiendo-declaraciones` +2, and +1 each in
    `ccss-pedir-prescripcion-cuotas`, `ho-hacienda-solo-cliente-eeuu` and
    `ho-iva-en-cero-sin-facturar`.
- **The loss was in Tier 2 and in depth.** Without the rerank, seven cases
  that hit lost every target: `tribu-cr-declarar-pagar`,
  `iva-credito-fiscal-compras`, `renta-bruta-que-incluye`,
  `renta-pagos-parciales-retenciones`, `iva-facturas-en-dolares`,
  `iva-ajuste-bien-de-capital` and `ho-t2-compu-cara-iva`, all Tier 2.
  Three cases gained a hit: `ho-desinscribir-debiendo-declaraciones`,
  `ccss-asalariado-followup` and `ho-t2-hosting-extranjero`. Outside the
  block, 19 targets left the answer sets.
- **The short wording lost most.** In the block, four cases miss off that
  hit on:
  - «¿Cuánto pago como independiente?», #490 item 1, as it reproduced in
    production;
  - «cuanto pago a la ccss como trabajador independiente»;
  - «¿tasa del IVA?»;
  - «como hago mi primera fatura electronica».

  «¿cuánto pago a la caja?» takes the weak decline, as it did in #502's
  probe. `rb-pill-retroactivo` goes the other way: it hits off and misses
  on.

## Cost

There is no console figure. The estimate is built from the transcript's own
token counts: the answer prompts sum to 1.49 M input tokens (`pnpm
prompt-tokens`, free), and the answers wrote 115 k output tokens.

| Step                                                          | ≈US$    |
| ------------------------------------------------------------- | ------- |
| Balance check (one-token Haiku call)                          | 0.00    |
| Smoke (3 answers, judges, rewrites, rerank)                   | 0.20    |
| Groundedness lane: 101 answers                                | 3.10    |
| Groundedness lane: 106 judge calls, adequacy and label judges | 4.70    |
| Abstention lane (15 answers and judges)                       | 1.20    |
| Conflicting sources, amending law                             | 0.15    |
| Voyage embeddings and 1,090 rerank readings; Haiku rewrites   | 0.75    |
| `RERANK=off` probe arm (embeddings, Haiku 5.5 rewrites)       | 0.05    |
| **Total**                                                     | **≈10** |

The robustness block and #503's cases are 34 more answered cases than the
2026-10-02 lane, whose cost was about US$7, so #511's US$7.50 estimate was
written before them.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
