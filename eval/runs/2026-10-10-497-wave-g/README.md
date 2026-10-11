# Wave G's full lane, 2026-10-10 (#497)

The one full lane map #497's Wave G called for, after its PRs landed. It is
one `pnpm test:eval` on main at e7d954c, with a three-case smoke first. The
setup is Wave E's: `claude-sonnet-5-5` at `ANSWER_EFFORT=low` (production's
value), judge `claude-sonnet-4-5`, and every other knob at its code default,
which is production's. The shared local stack held the 894-chunk corpus (873
plus #597's two resolutions), and the census read 278/278 targets satisfiable.

Main at that commit carries, beyond Wave E's lane (9817c6e): Wave F's #586
(Tier 1 baseline 78 → 88), #587 (the groundedness judge sees the answer's
date, #582), #588 and #589 (#584/#583's carrier readouts), #590
(`PIN_SALARIO_BASE`, #579) and #594 (#580/#585's documented exception); then
Wave G's #595 (#593: ADR 0023 at 88, chunk ids in the probe), #597 (#592's
corpus: RES-0020 and RES-0033, the renta and IVA filing channel), #596 (#591:
any amount in salarios base brings the salario base, plus the pin's telemetry)
and #598 (#592's requirement rewrites: the D-140 clause in three cases, row
26's step).

| File                                          | What it is                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `smoke-groundedness-…T005242Z.log` · `smoke/` | The three-case smoke: 2/3 grounded, no false absence claim, Tier 1 8/10.                       |
| `lane-…T005438Z.log` · `lane/`                | The lane, 1749 s: the groundedness (101 rows, no re-ask) and abstention (15 rows) transcripts. |

The run went from the main checkout, so the logs' paths to it read
`<main-checkout>`. Nothing else is edited. The transcripts are also in the main
checkout's `eval/transcripts/2026-10-10-497-wave-g/`.

**It ran to the end.** No stall, no 429, 5xx or overloaded response, no
timeout, no `unknown knob` line. One rerank reading was lost: 1 of 589 in
hit-rate (`exportacion-comprobante-followup`, its step leg), none of 43 in
abstention and none of 588 in groundedness. vitest: 40 passed | 1 skipped, in
8 passed files. It is the first lane of map #497 with every suite green.

## Smoke

`desinscripcion-dejar-actividad`, `iva-ajuste-bien-de-capital` and
`ho-rebajar-25-sin-facturas` (one per Wave G change: #598's D-140 rewrite,
#596's wide salario-base pin on «quince salarios base», #597's TRIBU-CR
channel): 2/3 grounded, 0 false absence claims, Tier 1 8/10.
`iva-ajuste-bien-de-capital` failed 3/3 (inference) on the pinned circular,
the same failure the lane repeats below.

## Gates

| Gate                                           | Wave E (9817c6e) | This lane   | Read                                                                                    |
| ---------------------------------------------- | ---------------- | ----------- | --------------------------------------------------------------------------------------- |
| Groundedness, judges' first verdict (#474)     | 73/74            | **71/74**   | green (baseline 73, floor 69); 3 fails, all inference, 3/3 judges, #591's pin → #599    |
| Blocking cases, 2 of 3 answers (#474)          | green            | **green**   | no blocking case failed its first verdict; 0 re-asked                                   |
| False corpus-absence claims (#500, #547)       | 1 · 0            | **0** · 0   | green in both; `rb-seguimiento-le-cobro-iva` grounded, #579 fixed                       |
| Tier 1 requirements stated                     | 92/116           | **93/116**  | green (baseline 88, fails ≤ 83); **not ratcheted**, owner decision                      |
| Tier 1 cases fully adequate (reported)         | 13/27            | 15/27       | reported, not gated                                                                     |
| Tier 2 adequate ≥ 84%                          | 12/14            | **12/14**   | green (85.7 %); fails `tribu-cr-declarar-pagar`, `ho-t2-payoneer`                       |
| Citation invariant                             | 0                | 0           | green                                                                                   |
| Derived figures completely cited; F1 both BMCs | green            | green       | green                                                                                   |
| Abstention ≥ 90%                               | 14/15            | **15/15**   | green; `ho-abs-calculo-personalizado` passes                                            |
| Abstention invents no figure while declining   | red (1)          | **green**   | `ho-abs-devs-exentos-renta` names no figure                                             |
| `ho-abs-iva-2027` requirement (#502)           | 1/1              | **1/1**     | green                                                                                   |
| Hit-rate ≥ 94%                                 | 73/74            | **73/74**   | green (98.6 %); misses `ho-t2-credito-iva-compras` (not in the pool)                    |
| All expected targets reached (#570, reported)  | 49/74            | 50/74       | reported; robustness block 14/27                                                        |
| Robustness block, hit (#502)                   | 26/27            | **27/27**   | green (baseline 27, fails ≤ 24)                                                         |
| Robustness block, grounded                     | 25/27            | 27/27       |                                                                                         |
| Robustness block, adequate · requirements      | 4/7 · 31/37      | 2/7 · 26/37 | reported; `rb-pill-me-salgo` and `rb-tilde-deje-de-trabajr` miss #598's TRIBU-CR clause |
| Conflicting sources, amending law, census      | green            | green       | census 278/278                                                                          |
| vitest                                         | 2 failed         | **green**   | 8/8 files, 40 passed, 1 skipped                                                         |

### Tier 1: 93/116, three lanes over 88

93 is 5 over the baseline of 88 (#586, the lower of Wave D and Wave E) and 1
over Wave E's 92. Three lanes in a row now read 88, 92 and 93. The baseline
stays 88: raising it (to 92, the lower of Wave E and Wave G?) is the owner's
decision, **pending**. The tier1-carriers readout moves from 21/47 carrying
chunks in the answer set (Wave E) to 22/47.

### Groundedness: 71/74, the three failures are one cause (#599)

`iva-ajuste-bien-de-capital`, `ho-t2-compu-cara-iva` and
`ho-t2-panaderia-simplificado`, each failed by 3/3 judges, labelled
inference. Each answer set ends with `salario-base-2026` (Circular
246-2025), appended by #596's wide pin on «quince salarios base»
(`reglamento-iva-bienes-capital` 31) or the simplified regime's limits
(`reglamento-rts`). The judges' reasons all turn on the circular: it sets the
salario base for the Código Penal, and nothing in the set ties it to the
threshold the answer applies it to. The circular sits in 38 of the 101 answer
sets here, against 6 in Wave E (before #590 and #596); the other 35 grounded.
#599 has the options.

### #592: the corpus and the rewrites

- **RES-0020 and RES-0033 reach answer sets.** Nine of the 101 carry one or
  both: `tribu-cr-declarar-pagar` (all 8 chunks), `iva-declaracion-mensual`,
  `renta-plazo-followup`, `inscripcion-tribu-cr`, `ho-donde-inscribo-ya-no-atv`,
  `ho-iva-en-cero-sin-facturar`, `ho-hasta-que-dia-tengo-iva`,
  `rb-corto-cuando-declaro-renta` and `rb-corto-cuando-declaro-iva`. All but
  `inscripcion-tribu-cr` cite them.
- **Row 16, `ho-iva-en-cero-sin-facturar`, now passes** (Wave E missed «dónde
  se presenta la declaración hoy»). Its set carries RES-0033 Artículo 1 and
  the answer cites it.
- **The D-140 → ATV rewrite still misses** on `desinscripcion-dejar-actividad`,
  `rb-pill-me-salgo` and `rb-tilde-deje-de-trabajr`. The answers give the
  Oficina Virtual steps («Mis datos» → «Solicitar desinscripción») but name
  neither TRIBU-CR nor ATV.
- **`ho-rebajar-25-sin-facturas` still misses** «La declaración anual se
  presenta en TRIBU-CR». RES-0020 is not what it lacks: the case's target is
  `tribu-cr-res-0011-2025` Artículo 2, which the rerank cut (0/1 carrying
  chunk), and its set holds no `tribu-cr-*` document at all. It also misses the
  Ley 10818 clause this time: the answer names the law but says the documents
  don't say from when it applies.

### #593 item 3: first person outside declines persists (→ #600)

14 of the 101 groundedness answers, none of them a decline, speak in the first
person. In 11 it is the tail of an absence claim («no lo puedo determinar con
los documentos que consulté», «los documentos oficiales que tengo a la vista
no lo detallan», «No encuentro en los documentos oficiales…»):
`inscripcion-hacienda-clientes-extranjero`, `ccss-ventana-prescripcion-24-meses`,
`regimen-simplificado-programador`, `tribu-cr-declarar-pagar`,
`renta-plazo-followup`, `ho-cabys-paginas-web`, `ho-rebajar-25-sin-facturas`,
`ho-t2-pensionado-con-actividad`, `ho-t2-payoneer`, `rb-pill-inscribo-exterior`
and `rb-tilde-inscribirme-afuera`. The other 3 are conversational («le
explico ambas», «Si me dice qué bien o servicio vende, le indico»):
`rb-pill-impuesto-renta`, `rb-corto-tasa-iva`, `rb-corto-multa-tarde`. #600
lists five of them; no gate reads it.

### Absence openings (reported, not gated)

- Groundedness, 7/101 (Wave E 9): `factura-primera-cabys`,
  `ho-factura-electronica-o-recibo`, `ho-cabys-paginas-web`,
  `ho-desinscribir-debiendo-declaraciones`, `ho-t2-constancia-al-dia`,
  `ho-t2-payoneer`, `rb-pill-primera-factura`.
- Abstention, 10/15.

## Baselines

None moved. Groundedness stays 73 (floor 69), Tier 1 88 (fails ≤ 83), the
robustness hit 27, hit-rate 94 %. Tier 1's ratchet is pending the owner's
call, above.

## Cost

There is no console figure. The estimate is Wave E's lane, the same
configuration and row count.

| Step                                                     | ≈US$       |
| -------------------------------------------------------- | ---------- |
| Smoke (3 answers, judges, rewrites, rerank)              | 0.20       |
| Lane: answers, judges, adequacy and label judges         | 8.30       |
| Lane: abstention, fixtures, embeddings, rerank, rewrites | 2.10       |
| **Total**                                                | **≈10.60** |

With the wave's other paid steps, Wave G comes to ≈US$11.17.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
