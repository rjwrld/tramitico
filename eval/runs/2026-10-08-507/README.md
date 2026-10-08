# Fragments, not the corpus: the prompt replays (2026-10-08, #507)

#507 rewrites rules 3, 7 and 9 of the answer prompt. The model is told it sees
only some parts of the official documents, never the whole collection. It
never writes that a document, artículo, rate or figure is missing, and a datum
it cannot see goes to rule 9's closing referral («confírmelo con Hacienda»).
This directory measures that change with fixed-chunk replays (`pnpm
answer-replay`) of #511's groundedness transcript,
[`2026-10-08-baseline/low/groundedness-…-20261008T022706Z.jsonl`](../2026-10-08-baseline/low/),
recorded after #520's re-ingest, so its chunk ids match the local stack.

Setup: `claude-sonnet-5-5` at `ANSWER_EFFORT=low`, the adequacy judge
`claude-sonnet-4-5`, and `--no-groundedness` on every replay (the acceptance
reads the detector and Tier 1, and the groundedness judge would double the
cost). The control ran from the main checkout on main at 66a2cf9, whose prompt
is origin/main's. Round 1 ran from this branch at 83075d8. The merge of #508–#510 and #519
that followed changed retrieval, not the answer prompt, and replays hold the
chunks fixed.

| File                                       | What it is                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `control-tier1-…T032840Z.log` · `control/` | main's prompt, the 27 Tier 1 rows                                                  |
| `control-trust-…T032840Z.log` · `control/` | main's prompt, the 3 flagged rows outside Tier 1                                   |
| `r1-tier1-…T033752Z.log` · `r1/`           | #507's prompt, the 27 Tier 1 rows                                                  |
| `r1-trust-…T033752Z.log` · `r1/`           | #507's prompt, the 3 flagged rows and the 6 non-Tier 1 rows that opened on absence |
| `r1-abstention-iva-2027-…T033752Z.log`     | #507's prompt, `ho-abs-iva-2027` through the scoped abstention lane                |

`ho-abs-iva-2027` cannot be replayed: abstention rows carry no chunks. It ran
through `EVAL_CASES=ho-abs-iva-2027` on the abstention lane, so its retrieval
is live, not fixed. The lane's gates fail by design on a subset. The logs'
checkout paths are replaced with `<worktree>`. Nothing else is edited.

**No provider error.** No replay logged a 429, 5xx or overloaded response, and
the abstention case lost none of its 5 rerank readings. Every answer finished
on `stop`, and the citation invariant and derived figures had no violation.

One round was enough, so there is no round 2.

## False absence claims: 4 → 0

| Row (tier)                                  | Lane (#511) | Control replay | Round 1 |
| ------------------------------------------- | ----------- | -------------- | ------- |
| `ho-trabajitos-por-mi-cuenta` (1, blocking) | 1 (BMC)     | 1 (BMC)        | 0       |
| `iva-ajuste-bien-de-capital` (2)            | 1           | 0              | 0       |
| `ho-t2-panaderia-simplificado` (2)          | 1           | 1              | 0       |
| `rb-seguimiento-de-cuanto-multa` (block)    | 1           | 2              | 0       |
| the other 26 Tier 1 rows                    | 0           | 0              | 0       |
| `ho-abs-iva-2027` (abstention)              | 0           | —              | 0       |
| **Total**                                   | **4**       | **4**          | **0**   |

The control replay reproduces the claims on the same chunks with main's
prompt (4 claims in 3 of the 4 rows), so the zero is not a replay artefact.
In the control, the BMC and salario base claims read as before: «Los
documentos oficiales no traen el monto en colones del salario base, así que no
puedo darle la cifra final.» In round 1 the same rows give the figure's rule
with its citation and refer for the amount: «La multa por omitir la
inscripción es del cincuenta por ciento (50%) de un salario base por cada mes
o fracción de mes […] [1].» and «El monto en colones del salario base vigente
confírmelo con Hacienda.» Two of the four (`iva-ajuste-bien-de-capital`,
`rb-seguimiento-de-cuanto-multa`) say that confirmation twice, which rule 9
asks them not to; it is a repetition, not an absence claim.

`ho-abs-iva-2027` passes the judge and its #502 requirement (13 % and art.
10, cited, never denied): «No puedo decirle cuál será la tasa del IVA en 2027:
ninguna fuente oficial puede dar una cifra futura, y los documentos oficiales
solo dicen lo que rige hoy», followed by «La tarifa general del impuesto es
del trece por ciento (13%) [2].» The lane failed it 3/3 and read the
requirement 0/1. Its retrieval was live, so this is one draw with no control,
and #508 owns the cross-reference that puts art. 10 in front of the model.
The pass is narrower than it reads: the answer names «artículo 10» only in
the ICT transitorio sentence («pasaron a la tarifa general del artículo 10 de
la Ley … [4]»), not in the 13 % one. So the lane's assertion stays a todo
(owner, 2026-10-08), and #512's full lane, on the pipeline with #508 and #509
merged, reads it and arms it if it passes on the claim itself.

**What the zero does not show.** Rule 7's example of the right sentence is
the salario base, which three of the four flagged rows named, so part of the
4 → 0 is the prompt fixing the sentence it quotes. The BMC row
(`ho-trabajitos-por-mi-cuenta`) and `ho-abs-iva-2027` (art. 10) have no
example of their own and made no claim either. #512's final lanes read the
whole set on live retrieval.

## Openings (rule 9, reported, not gated)

| Rows                     | Lane (#511) | Control replay | Round 1 |
| ------------------------ | ----------- | -------------- | ------- |
| 27 Tier 1                | 3           | 4¹             | 2       |
| 9 trust and opening rows | 6           | —              | 3       |
| `ho-abs-iva-2027`        | 1           | —              | 1       |

The openings left say a procedure or a code is not in the documents, not an
artículo or a listed figure, so the detector does not count them as false:
`ho-cabys-paginas-web` (the CIIU 4 code), `ho-desinscribir-debiendo-declaraciones`
(whether Hacienda allows it), `factura-electronica-v44` and
`factura-primera-cabys` (a step-by-step for the portal), and
`ho-t2-constancia-al-dia` (a procedure by that name). `ho-abs-iva-2027`'s
opening is the honest decline of a future figure that rule 6c asks for. The
6 → 3 on the non-Tier 1 rows is read against the lane, not a control replay.

¹ Main's `answer-replay` has no openings line, so the control's figure is
read off its transcripts' `checks.absence.opening`.

The remaining openings are absence claims in rule 7's spirit, outside its
list and the detector's: a step-by-step for the portal is a procedure, and the
corpus may truly lack one. They are left for a follow-up, not a second round.

## Tier 1: no regression detected

| Reading                         | Tier 1 requirements stated |
| ------------------------------- | -------------------------- |
| #511's lane (the recorded side) | 86/116                     |
| Control replay, main's prompt   | **78/116**                 |
| Round 1, #507's prompt          | **85/116**                 |

Round 1 is within ±2 of the lane's reading (−1). Against the control replay it
reads +7, across six cases, none lower: `ho-factura-electronica-o-recibo` +2,
and +1 each in `ccss-pedir-prescripcion-cuotas`, `ccss-obligacion-ingreso-bajo`,
`inscripcion-tardia-sancion`, `ho-tiquete-en-vez-de-factura` and
`ho-hasta-que-dia-tengo-iva`. That is the direction a regression check does not
fail on, and it is no target either (ADR 0023): the tracked baseline stays 70.
The control's own 78, eight below the lane on the same chunks and the same
prompt, says that one replay of this transcript moves more than ±2, so this
check cannot resolve ±2 with one replay a side, and the +7
is read as noise, not as a gain.

**Signed off** (owner, 2026-10-08): the +7 on the control replay is within
the intent of ±2, since no case went down and ADR 0023 forbids tuning toward
a number. There is no second control replay.

## Cost

There is no console figure. 66 answers wrote 71.5 k output tokens, on prompts
of about 15 k input tokens each with the system prompt cached.

| Step                                              | ≈US$     |
| ------------------------------------------------- | -------- |
| Balance check (one-token Haiku call)              | 0.00     |
| Control: 30 answers and adequacy judges           | 1.30     |
| Round 1: 36 answers and adequacy judges           | 1.55     |
| Round 1: `ho-abs-iva-2027` scoped abstention lane | 0.10     |
| **Total**                                         | **≈3.0** |

The groundedness rows embed the text of the retrieved chunks, which are
excerpts of official public documents of the Government of Costa Rica
(Hacienda, CCSS, SINALEVI, BCCR). Those excerpts are outside the repository's
Apache-2.0 license; see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md). The
answers are model output about public law and contain no user data.
