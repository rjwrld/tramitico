# Wave D's full lane, 2026-10-09 (#497)

The one full lane map #497's Wave D called for, after its fixes landed. It is
one `pnpm test:eval` on main at 3455dd5, with a three-case smoke first. The
setup is #512's: `claude-sonnet-5-5` at `ANSWER_EFFORT=low` (production's
value), judge `claude-sonnet-4-5`, and every other knob at its code default,
which is production's. That now includes `PIN_NAMED_SOURCES=on` (#566) and
#563's widened false-absence detector, which counts #547's count hedges. The
shared local stack held the 873-chunk corpus, and the census read 278/278
targets satisfiable.

Main at that commit carries, beyond #556's lane (ddfb9a1): #560 (the routed
cases measure the model's routing, #549), #564 (the Tier 1 misses split by
cause, #554), #566 (a source the question names, #559), #563 (#547's count
hedge joins the false-absence zero, #558), #565 (the production canary, #551)
and #567 (the prompt's words and a first-person refusal out of the answer,
#557).

| File                                          | What it is                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `smoke-groundedness-…T001802Z.log` · `smoke/` | The three-case smoke: 3/3 grounded, no false absence claim, no rerank reading lost (of 19).    |
| `lane-…T001903Z.log` · `lane/`                | The lane, 1781 s: the groundedness (101 rows; two carry two re-asks) and abstention (15 rows). |

The run went from the main checkout, so the logs' paths to it read
`<main-checkout>`. Nothing else is edited. The transcripts are also in the main
checkout's `eval/transcripts/2026-10-09-497-wave-d/`.

**It ran to the end.** No stall, no 429, 5xx or overloaded response, no
timeout, and no rerank reading lost (0 of 42 in abstention, 560 in hit-rate,
587 in groundedness). vitest: 1 failed | 39 passed | 1 skipped, in 1 failed |
7 passed files. The one failure is the abstention figure gate, below.

## Smoke

`factura-primera-cabys`, `multa-iva-no-declarado` and `ccss-cuanto-pago-base`:
3/3 grounded, 0 false absence claims, Tier 1 5/5. #559's fix works:
`cabys-dev` is in `factura-primera-cabys`'s answer set, and the answer gives the
code («el código es el 8314300000000, "Servicios de diseño y desarrollo de
software originales", con IVA de 13% [11]») where #556's lane opened with «no
encuentro base oficial» about CABYS. The lane's row of the case does the same,
with six codes. Both rows still open with an absence claim, now about the
portal's step-by-step («Los documentos oficiales no traen el paso a paso del
portal»), which is reported, not gated.

## Gates

| Gate                                           | #512 lane 1 · lane 2 | This lane     | Read                                                                  |
| ---------------------------------------------- | -------------------- | ------------- | --------------------------------------------------------------------- |
| Groundedness, judges' first verdict (#474)     | 73/74 · 73/74        | **71/74**     | green (baseline 73, fails ≤ 68)                                       |
| Blocking cases, 2 of 3 answers (#474)          | red (1) · green      | **green**     | both blocking first-verdict fails passed both re-asks                 |
| False corpus-absence claims (#500, #547)       | 0 · 0                | **0** · **0** | green, groundedness · abstention                                      |
| Reader's case worked out (#546, reported)      | —                    | 0 · 0         | reported, not gated                                                   |
| Tier 1 requirements stated                     | 78 · 79              | **88/116**    | green (baseline 78, fails ≤ 73); **not ratcheted**, owner decision    |
| Tier 1 cases fully adequate (reported)         | 4/27 · 5/27          | 10/27         | reported, not gated                                                   |
| Tier 2 adequate ≥ 84%                          | 12/14 · 13/14        | **13/14**     | green; fails `tribu-cr-declarar-pagar`                                |
| Citation invariant                             | 0 · 0                | 0             | green                                                                 |
| Derived figures completely cited; F1 both BMCs | green · green        | green         | green                                                                 |
| Abstention ≥ 90%                               | 14/15 · 15/15        | **15/15**     | green                                                                 |
| Abstention invents no figure while declining   | green · green        | **red (1)**   | `ho-abs-devs-exentos-renta`, «13%»; see below                         |
| `ho-abs-iva-2027` requirement (#502)           | 0/1 · 0/1            | **1/1**       | green                                                                 |
| Hit-rate ≥ 94%                                 | 72/74 · 73/74        | **72/74**     | green (97.3%)                                                         |
| Robustness block, hit (#502)                   | 27/27 · 27/27        | **26/27**     | green (baseline 27, fails ≤ 24); misses `rb-tilde-inscribirme-afuera` |
| Robustness block, grounded                     | 26/27 · 25/27        | 26/27         | fails `rb-corto-cuanto-es-iva`                                        |
| Robustness block, adequate · requirements      | —                    | 0/7 · 27/37   | reported                                                              |
| Conflicting sources, amending law, census      | green                | green         | census 278/278                                                        |
| vitest                                         | 1 failed · 8 passed  | **1 failed**  | red on the abstention figure gate alone                               |

### Groundedness: 71/74, no blocking failure

The judges failed three of the 74 gated answers on the first verdict:

- `ho-factura-electronica-o-recibo` (blocking, `contradiction`). «Hacienda
  puede rechazar deducciones o créditos de comprobantes que incumplan los
  requisitos del reglamento [7]», where fragment [7] is about the exceptions to
  the obligation to emit. Both re-asks passed.
- `ho-800-mil-que-porcentaje-caja` (blocking, `contradiction`). The answer
  corrects itself in the open: «el afiliado paga 2.89% más 3.35%... no; el
  afiliado paga 6.24%, el Estado 5.76% y el conjunto es 12.00% [2]». The
  final figures are fragment [2]'s; 2.89 % is the escala's category 1 and 3.35 % is
  in no fragment. Both
  re-asks passed. It is the case #556's Tier 1 guard failed once too.
- `ho-t2-payoneer` (Tier 2, `inference`). A strict call: the answer
  paraphrases artículo 1's «con independencia de la nacionalidad, el domicilio
  o la residencia» as «sin importar…» and cites it.

Both blocking cases fail 1 of 3, so the blocking gate is green. In the block,
`rb-corto-cuanto-es-iva` fails (`contradiction`) on «el impuesto se cobra
sobre la base del 10 % del valor del boleto» for international air tickets,
which is the fragment's own wording, so it reads as the judge's error. Labels
(recorded): contradiction 3, inference 1.

### Tier 1: 88/116, reported only

88 is ten over #512's baseline of 78 and nine over its better lane. It is one
lane, so it is **not ratcheted**: whether to move the Tier 1 baseline is the
owner's call. The misses are still where-and-how (TRIBU-CR and OVi steps, CCSS
channels, how to regularize), as in the log's `missing:` lists. The robustness
block reads 27/37 requirements, with no case fully adequate (0/7).

### Hit-rate

The gated set misses `ho-t2-credito-iva-compras` (not in the pool, as in both
#512 lanes) and `ho-t2-hosting-extranjero` (pool #4, reranked #9 behind
`ley-iva` · Artículo 14). The block misses `rb-tilde-inscribirme-afuera` (pool
#7, reranked #12 behind `reglamento-iva` · Artículo 49), so it reads 26/27
against #512's 27/27, inside the margin.

### The red: an uncited 13 % in a decline

`ho-abs-devs-exentos-renta` declines correctly and passes the judges, but
writes, as its own paragraph:

> Sobre el IVA, los servicios de desarrollo de software tienen código CABYS con
> IVA de 13%. Por ejemplo, el 8314300000000 corresponde a diseño y desarrollo
> de software originales [1].

The first sentence has no marker. Fragment [1] is `cabys-dev`, whose text
carries «IVA: 13%», and the next sentence cites it. `figureMentions`
(`src/lib/eval/adequacy.ts`) counts a figure the fragments carry, but the
answer does not cite where it states it, as invented. So the figure is true
and sourced, only uncited in place, and the gate reads it as the defect it
exists to catch.

It is not new behaviour. This case mentions CABYS in 10 of its 19 committed
abstention rows, and the gate flagged it once before (2026-09-29's
`runs/2026-09-29-451/low/`, «100%», in a row without CABYS). #566 pins
`cabys-dev` only for a question that names CABYS, and this one doesn't: the
source reached the set on its own. The lane is red on this one gate.

### Absence openings (reported, not gated)

- Groundedness, 8/105 answers: `factura-electronica-v44`,
  `regimen-simplificado-programador`, `factura-primera-cabys`,
  `ho-cabys-paginas-web`, `ho-desinscribir-debiendo-declaraciones`,
  `ho-t2-constancia-al-dia`, `ho-t2-payoneer`, `rb-pill-primera-factura`.
- Abstention, 9/15 declines: `ho-abs-cuanto-cobro-la-hora`,
  `ho-abs-iva-2027`, `ho-abs-patente-municipal`, `ho-abs-recomendar-contador`,
  `abs-pasaporte-renovar`, `abs-dimex-sacar`, `abs-residencia-permanente`,
  `abs-ins-riesgos-trabajo`, `abs-patente-comercial`.

### Abstention

15/15, all on the model path (`route: "model"`), and `ho-abs-iva-2027` states
its requirement (1/1). `ho-abs-calculo-personalizado`, which failed #512's lane
1, passes.

## Cost

There is no console figure. The estimate is #512's lane 2, the same
configuration and row count.

| Step                                                     | ≈US$       |
| -------------------------------------------------------- | ---------- |
| Smoke (3 answers, judges, rewrites, rerank)              | 0.20       |
| Lane: 101 answers and 4 re-asks                          | 3.40       |
| Lane: judges, adequacy and label judges                  | 4.70       |
| Lane: abstention, fixtures, embeddings, rerank, rewrites | 2.10       |
| **Total**                                                | **≈10.40** |

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
