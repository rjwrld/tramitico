# Today's date in the answer prompt, 2026-09-29 (#455)

The evidence for #455: `pnpm answer-replay` of the
[#451 low arm](../2026-09-29-451/low/)'s Tier 1 rows,
`ANSWER_MODEL=claude-sonnet-5-5 ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`,
on the branch's prompt: the user prompt carries «Fecha de hoy en Costa Rica: 29
de septiembre de 2026.», and rule 3 lets a documented date be compared with it.
Every row records `generation.today = "2026-09-29"`. Owner-approved, ≈US$3.60
in all (estimated).

The control is [#454](https://github.com/rjwrld/tramitico/issues/454)'s r3
replay, whose prompt is main's (3a96f8a differs from it only in a doc comment):
Tier 1 72/116, grounded 27/27. Its transcript is not in the repository.

| File                   | Prompt                                                 | What it is                                                                                                         |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `r1.log` · `r1/…jsonl` | date line + rule 3 carve-out (87fd1e2)                 | All 27 Tier 1 rows: 75 of 116 requirements (r3 72), grounded 23/27 (r3 27/27), citation invariant 0.               |
| `r2.log` · `r2/…jsonl` | same                                                   | r1's four ungrounded rows and `ccss-ventana-prescripcion-24-meses` again: 4/5 grounded.                            |
| `r3.log` · `r3/…jsonl` | + the carve-out compares only a written date (41b7f55) | The four date rows: 4/4 grounded, each states whether a documented date has passed, or that the documents lack it. |

## The date rows

| Row                                  | 454 r3 (no date)                            | 455 r1                                                                                          | 455 r3 (shipped wording)                                                                                                       |
| ------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ho-hasta-que-dia-tengo-iva`         | misses «Qué hacer si la fecha ya pasó»      | 3/3: «el plazo del 15 de septiembre para declarar agosto ya pasó»                               | 3/3: «la declaración de septiembre de 2026 vence el 15 de octubre de 2026, y ese plazo todavía no ha pasado»                   |
| `ho-iva-en-cero-sin-facturar`        | misses the TRIBU-CR / late-filing claim     | «el plazo vence el 15 de octubre, que todavía no ha pasado»; still misses TRIBU-CR              | the same statement; still misses TRIBU-CR (not a date matter)                                                                  |
| `ho-rebajar-25-sin-facturas`         | grounded                                    | «El plazo de setiembre de este año ya pasó.» — wrong: the último día hábil is 30 Sept           | no date claim; says the documents do not say from which period Ley 10818 applies                                               |
| `ccss-ventana-prescripcion-24-meses` | «no puedo confirmarle si hoy sigue abierta» | «más de tres años después de la firma … ya venció con cualquier fecha de publicación razonable» | «Los documentos oficiales no traen la fecha de entrada en vigor … no puedo decirle con base oficial si esa ventana ya terminó» |

`ccss-ventana`'s requirement («terminó el 8 de mayo de 2025») cannot be met from
its chunks: they carry the law's signing date, not its vigencia, and the end
date is vigencia + 24 months. r1 and r2 got there by elapsed-time reasoning
from an assumed publication date, which #455 keeps forbidden. That is what the
r3 wording («Compare solo fechas que los documentos escriben: no suponga una
fecha que no traen ni razone sobre el tiempo transcurrido desde otra …») stops.
The row needs the vigencia date in the corpus, not a prompt change.

## Groundedness

r1's four ungrounded rows were not about dates: `ccss-obligacion-ingreso-bajo`
read «no implica que pueda asegurarse» as its opposite, `multa-iva-no-declarado`
drew a judge objection to «multiplicar … corresponde a Hacienda»,
`ho-tambien-asegurado-por-patrono` gave a 4,33 % Salud rate where the escala's
category 3 says 6,24 %, and `ho-rebajar-25-sin-facturas` was faulted on how it
grouped the 25 % deduction's beneficiaries. In r2 the first three pass;
`ho-rebajar-25` fails again, on another wording point — it also failed in the
#451 r2 and r3 replays. Read as one run, r1 with r2's re-answers is 26/27, within
the replay's noise of r3's 27/27.

The r3 wording was measured on the four date rows only. Its effect on the other
23 Tier 1 rows is unmeasured.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
