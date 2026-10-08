# Rate questions reach their rate sources, 2026-10-07 (#509)

`pnpm answer-set-probe` reads (retrieve → rerank → cap → pin, no answer
model, no judge) on the shared local stack carrying the 873-chunk ingest,
with `RERANK=voyage STEPS=on STEPS_RERANK=pin1` exported, so every read is
production's retrieval. The baseline is #502's two arms
([`../2026-10-07-502-robustness/`](../2026-10-07-502-robustness/)), the same
stack and knobs before this change. Every number is under the route's
configuration, `top8/capoff/pinon`. A case **hits** when one of its
`expected` targets is in the answer set.

The change has three parts: the lexical leg drops question words and retries
as typed when that comes back weak (`src/lib/retrieval.ts`), two catalogue
sentences (T1-F's escalas, T1-D's `ley-iva` art. 10), and three expansion
prompt rules (7: a future figure gets the rule in force, never a refusal;
8: casual wording is translated to the situation a norm regulates; 9: no
heading over a list of neighbouring topics).

## Files

The prompt moved during the work, so each file names the prompt it ran on.
"Rule 9 (first)" also said «Redacte la regla misma: cada oración con sujeto y
verbo»; the shipped rule 9 drops that clause (below).

| File                             | Model     | Prompt          | What it is                                                                                                                                 |
| -------------------------------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `smoke-haiku-5-5*`               | Haiku 5.5 | rule 9 (first)¹ | 20 cases: `ho-t2-*`, the rate cases, `ho-abs-iva-2027`                                                                                     |
| `probe-haiku-5-5*`               | Haiku 5.5 | rule 9 (first)  | Full arm, no strip retry yet                                                                                                               |
| `probe-haiku-4-5*`               | Haiku 4.5 | rule 9 (first)  | Full arm, no strip retry yet. **Lost 54 of 573 rerank readings to Voyage 429s on 21 cases**                                                |
| `rerun-haiku-4-5*`               | Haiku 4.5 | rule 9 (first)  | Those 21 cases plus `rb-pill-primera-factura`, paced (`PROBE_CASE_MS=3000`), with the retry: 0 lost                                        |
| `rerun-haiku-5-5*`               | Haiku 5.5 | rule 9 (first)  | `rb-pill-primera-factura`, with the retry                                                                                                  |
| `replay-502-rewrites-haiku-5-5*` | —         | #502's rewrites | `EVAL_REWRITES`: #502's 5.5 expansions through the new retrieval, on the 24 cases the live arm moved. Isolates the strip and the catalogue |
| `tier1-haiku-5-5-r2*`            | Haiku 5.5 | rule 9 (first)  | Second live read of the 27 Tier 1 cases                                                                                                    |
| `variant-no-rule9-haiku-5-5*`    | Haiku 5.5 | no rule 9       | Nine cases                                                                                                                                 |
| `variant-final-rule9-haiku-5-5*` | Haiku 5.5 | **shipped**     | The same nine cases                                                                                                                        |
| `final-haiku-5-5*`               | Haiku 5.5 | **shipped**     | 50 cases: Tier 1, `ho-t2-*`, the acceptance and robustness cases this issue names                                                          |

¹ Rules 7 and 8 quoted «va a ser» and «se rebaja» in the smoke, wordings of
held-out questions; they were reworded before the full arms, which also
discarded a first 5.5 arm stopped at 20 cases.

Two free-text files beside them:

- `pool-dump-no-expansion.txt`: `pnpm pool-dump --no-expansion` on the
  short wordings and their seeds, after the strip and the catalogue
  (embeddings only).
- `catalogue-check-502-rewrites-haiku-{5-5,4-5}.txt`: #418's check, below.

**After every read here**, rule 8 gained one sentence (orchestrator review):
when the reader names no institution, the model neither picks one nor asks,
and rule 5 governs. It is unmeasured by a paid read. On the recorded
rewrites, every Haiku 5.5 rewrite of `inscripcion-tardia-sancion` names both
the CCSS and Hacienda. `ho-t2-constancia-al-dia`, whose reader names
Hacienda, names Hacienda alone on every recorded read, #502's included,
except the smoke, which on rules 7 and 8's earlier wording added a CCSS
sentence. The Haiku 4.5 arm wrote
`inscripcion-tardia-sancion`'s expansion as a question: «No puedo redactar la
respuesta sin saber ante cuál institución se inscribió tarde…». The case still
hit, from its own legs and the catalogue's. That rewrite is what the sentence
is for.

## #418's check: no blocking target leaves the pool

Every blocking case (the 34 Tier 1 cases and the canary), on #502's own
query and expansion for each model, retrieved to the fused 40 twice: once
with `main`'s catalogue and once with this branch's, embeddings memoised so
that only the catalogue sentences differ (a one-off `retrieve` script,
embeddings only). The files list each T1-D and T1-F case's target ranks under
both.

- **Haiku 5.5's rewrites: 0 blocking targets leave the 40.**
- **Haiku 4.5's rewrites: 1.** `ho-cliente-espana-lleva-iva`'s
  `reglamento-comprobantes` art. 2 sat at the pool's last place, #40, and
  falls just outside; the same case gains another target at #9.
- The escala sentence lifts the escala target of
  `ho-minimo-caja-independiente-2026` and `ho-800-mil-que-porcentaje-caja`
  from #8–15 to #2 on both rewrites.

The live reads below lose some blocking targets from the _answer set_ against
#502 (on the final read `ho-cabys-paginas-web` art. 13,
`ho-factura-electronica-o-recibo` art. 22, `desinscripcion-dejar-actividad`
RUT·31) and gain others. With the expansion held fixed, the catalogue
check and the replay show the strip and the catalogue removing none of them.
They come with the expansion's text, inside #457's ±4 band.

## Acceptance, on the shipped prompt (`final-haiku-5-5`)

| Case                                                                   | Rate sources in the answer set                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `rb-pill-cuanto-pago-independiente` «¿Cuánto pago como independiente?» | `ccss-escala-salud`, `ccss-escala-ivm`, `salarios-minimos` art. 1 |
| `rb-corto-tasa-iva` «¿tasa del IVA?»                                   | `ley-iva` art. 10                                                 |
| `rb-corto-cuanto-pago-caja` «¿cuánto pago a la caja?»                  | both escalas and `salarios-minimos` art. 1; **no longer weak**    |
| `rb-pill-retroactivo` «¿Me pueden cobrar retroactivo?»                 | hit (`ley-10363` art. 2)                                          |
| `ho-abs-iva-2027`                                                      | `ley-iva` art. 10 in the set; the expansion no longer refuses     |

| Read                 | Tier 1 hits | Tier 1 targets in the set | `ho-t2-*` |
| -------------------- | ----------- | ------------------------- | --------- |
| #502, Haiku 5.5      | 27/27       | 63                        | 9/12      |
| #502, Haiku 4.5      | 27/27       | 61                        | 12/12     |
| **final, Haiku 5.5** | **27/27**   | **64**                    | **10/12** |

No Tier 1 case loses its hit. `ho-t2-*` misses on the final read:
`ho-t2-credito-iva-compras` (missed on every 5.5 run, #496 included) and
`ho-t2-payoneer`. `rb-tilde-inscribirme-afuera` missed there and hit on the
`variant-final-rule9` read of the same prompt.

## Both rewrite models, full arms (first rule 9)

The full arms ran before the strip retry and the rule 9 fix. Both count the
`rerun-*` re-read of `rb-pill-primera-factura` (weak in the arm, a hit with
the retry), and the 4.5 arm the paced re-read of its 21 cases.

| Arm       | Outside the block | Block | `ho-t2-*` | Tier 1 targets |
| --------- | ----------------- | ----- | --------- | -------------- |
| Haiku 5.5 | 69/73             | 26/27 | 10/12     | 59             |
| Haiku 4.5 | 71/73             | 26/27 | 11/12     | 65             |

`ho-t2-*` on Haiku 4.5 lost `ho-t2-credito-iva-compras` (below). On Haiku
5.5, `ho-t2-autorizar-contador` and `ho-t2-payoneer` gained their hit, and
`ho-t2-compu-cara-iva` missed with its expansion call timed out.

## What each part did

- **The strip and the catalogue lose nothing on their own.** With #502's own
  5.5 expansions replayed, the 24 cases the live arm moved come back
  identical except two gains: `iva-tarifa-general` and
  `rb-corto-cuanto-pago-caja`. So every loss in the live arms is the
  expansion's text.
- **The strip's one regression, fixed by the retry.** Without «cómo»,
  «¿Cómo emito mi primera factura?» took the strict AND branch and matched
  one uncorroborated chunk, so the ask turned weak on both models. A weak
  result is now searched again as typed (`retrieve`); the re-reads hit.
- **The T1-D sentence is a trade.** Replaying #502's rewrites without it,
  `ley-iva` art. 10 is in the answer set of none of `iva-tarifa-general`,
  `rb-corto-cuanto-es-iva` and `ho-abs-iva-2027` on either model; with it,
  all three. It also pushes `ley-iva` art. 21 out of the fused pool on
  `ho-t2-credito-iva-compras` (4.5's rewrite: #30 → out), the chunk #418's
  rejected T1-D sentence pushed out. That case is Tier 2 and not blocking,
  and Haiku 5.5 never hit it.
- **The first rule 9 cost a blocking case.** «Redacte la regla misma» made
  5.5 state the conclusion («las rentas de fuente extranjera no se
  encuentran sujetas») where `ho-hacienda-solo-cliente-eeuu` asks about
  inscription, and its targets fell out of the set on two live reads of two;
  #502's rewrites replayed still hit. Without rule 9 the case hits but
  `ho-t2-autorizar-contador` and `ho-t2-payoneer` miss again. The shipped
  rule 9 keeps the ban on lists of neighbouring topics and drops the clause.

## Cost

Estimated **≈US$1.35**. No console figure was read, so this is not an
exact figure; the Anthropic and Voyage consoles have it.

- Voyage rerank (`rerank-2.5-lite`, US$0.02/M tokens): about 2,150 readings
  at ≈20k tokens each (40 chunks of ≈420 tokens plus the query per chunk) ≈
  US$0.86. The logs count 2,041; the discarded 20-case arm and the
  single-case replays add the rest.
- Haiku 4.5 (US$1/M in, US$5/M out): about 150 calls of ≈2k tokens in and
  150 out ≈ US$0.39.
- Haiku 5.5 (US$0.10/M in, US$0.50/M out): about 300 calls, including the
  `pool-dump` diagnostics ≈ US$0.08.
- Voyage embeddings, and the replays that isolated the T1-D sentence: about
  US$0.02.
