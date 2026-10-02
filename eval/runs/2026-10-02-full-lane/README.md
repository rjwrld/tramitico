# The full four-lane run on main, 2026-10-02

One owner-approved run of `pnpm test:eval` on main at 3615566, about US$7. That
commit carries #463 (citation clauses), #464 (the Costa Rica date), #467
(`rerankOptionsFor`), #468 (lost rerank readings counted), #469 (#458, a derived
figure's amount once, its label after) and #471 (#460, `pin1` ranks its fresh picks
by the question). It is the measurement the gate decision is written against
(the ADR that follows this run). The setup was `claude-sonnet-5-5` at
`ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, and the local stack holding the
873-chunk ingest. Every retrieval setting matched #451's run: `STEPS=on
STEPS_RERANK=pin1 EXPAND=on RERANK=voyage PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8
ANSWER_DOC_CAP=off`, with live rewrites (no `EVAL_REWRITES`).

| File                                          | What it is                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `smoke-groundedness-…T181848Z.log` · `smoke/` | The three-case smoke: 3/3 grounded, no rerank reading lost (of 17), no provider error. Gates fail by design.   |
| `low-…T182015Z.log` · `low/`                  | The full run: the groundedness and abstention transcripts. No rerank reading lost (of 377), no provider error. |

The logs' paths to the checkout are replaced with `<worktree>`. Nothing else is
edited. One query expansion timed out (`expansion failed — reason=timeout`) and
the ask fell back to the unexpanded query, as production does. #451's run logged
one too. It is not a provider error, so the run is recorded.

## Gates against #451's lane

| Gate                                                                   | #451 (2026-09-29) | This run          | Read                                                                                         |
| ---------------------------------------------------------------------- | ----------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| Groundedness ≥ 94%                                                     | 69/73 (94.5%)     | **68/73 (93.2%)** | red, one case under                                                                          |
| Every blocking case grounded                                           | red (1 case)      | **red (1 case)**  | `ho-800-mil-que-porcentaje-caja`, see below                                                  |
| Tier 1 requirements ≥ 80 of 116                                        | 77                | **70**            | red; −7, past the ±4 run-to-run noise                                                        |
| Tier 2 adequate ≥ 84%                                                  | 12/13             | **10/13**         | red                                                                                          |
| Citation invariant                                                     | 0                 | 0                 | green                                                                                        |
| Derived figures completely cited                                       | red               | green             | green (#458's gate)                                                                          |
| Abstention                                                             | 9/9, figure red   | 9/9, 0 figures    | green on both tests                                                                          |
| Hit-rate, conflicting sources, amending law, satisfiability, retrieval | 4 files ran       | green             | the files passed; vitest hides a passing file's console, so their numbers are not in the log |
| Rerank readings lost                                                   | not counted yet   | 0 of 377          | the #466 line, as expected                                                                   |

### The blocking red is model variance on an unchanged chunk

`ho-800-mil-que-porcentaje-caja` failed 3/3 judges. The objection is to one
sentence citing [3], `ccss-escala-ivm`: «Además, el Estado como tal aporta 1.75%
adicional en IVM [3]», followed by the remark that the sources don't say how this
reconciles with the 11,66% global. [3] is the same chunk at the same position
as in #451, which passed. #460 changed this case's pin from `ccss-reglamento-ti`
Artículo 12 to Artículo 10. That is chunk [9], and the judges accepted the
sentences it backs (ingreso neto, documentos de respaldo). The other eight
chunks are identical to #451's. #451's blocking red was a different case
(`ccss-obligacion-ingreso-bajo`), which passes here.

The four non-blocking ungrounded answers are `regimen-simplificado-programador`
(3/3), `comprobantes-factura-vs-tiquete` (3/3), `inscripcion-tribu-cr` (2/3) and
`iva-servicios-extranjero-comprados` (2/3). In the last one, the pinned chunk is
not among the fragments the judges objected to.

### Tier 1, case by case

Six of 27 Tier 1 cases state every requirement in both runs, but not the same
six. `ccss-ventana-prescripcion-24-meses` (#456's TRANSITORIO V),
`ho-hasta-que-dia-tengo-iva` and `ho-rebajar-multa-si-pago-ya` now pass.
`ho-cobrar-8-anos-atras-caja`, `ho-desde-cuanta-plata-caja` and
`ho-tambien-asegurado-por-patrono` now miss one requirement each: where to file,
how to declare and pay, and what to do at the CCSS. The −7 is spread across
partial answers. The missing requirements are mostly where/how content
(TRIBU-CR/OVi steps, CCSS channels, the 50% omission fine), which is the pattern
#449 first found on 5.5. Of #460's three predicted losses, all three still fail
here, as they did in #451. The log's `missing:` lists name what each one lacks.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
