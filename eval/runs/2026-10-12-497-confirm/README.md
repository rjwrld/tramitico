# The confirming lane, 2026-10-12 (#497)

The full lane map #497 called for after Wave G's follow-ups. It is one
`pnpm test:eval` on main at b416b54, with a three-case smoke first. The setup
is Wave G's: `claude-sonnet-5-5` at `ANSWER_EFFORT=low` (production's value),
judge `claude-sonnet-4-5`, and every other knob at its code default, which is
production's. The shared local stack held the 894-chunk corpus, and the census
read 281/281 targets satisfiable (278 in Wave G; #607 added the targets).

Main at that commit carries, beyond Wave G's lane (e7d954c): #603 (Tier 1
baseline 88 → 92, so the floor is 88), #604 (#599 option A: the salario base
circular only where the set ties it to Ley 7337), #605, #606 and #607 (#602's
carrier maps and expected targets, no code) and #608 (#600: a missing datum
said of the data, not of the assistant, rules 3 and 7).

| File                                          | What it is                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `smoke-groundedness-…T230710Z.log` · `smoke/` | The three-case smoke: 3/3 grounded, no false absence claim, Tier 1 4/4.                                                  |
| `lane-…T230811Z.log` · `lane/`                | The lane, 1784 s: the groundedness (101 rows, no re-ask) and abstention (15 rows) transcripts.                           |
| `read.mjs` · `read.log`                       | Free: the Tier 1 requirements lost and gained against Wave G, the chunks only one set holds, and the answer-set overlap. |
| `conflicting/`                                | The conflicting-sources case re-asked three times on main 0aa2011, after the lane (below).                               |
| `stability.mjs` · `stability.log`             | Free: where the two lanes' retrieval parts, and where each retrieval-miss carrier sat in each draw (below).              |

The run went from the main checkout, so the logs' paths to it read
`<main-checkout>`. Nothing else is edited. The transcripts are also in the main
checkout's `eval/transcripts/2026-10-12-497-confirm/`.

```sh
node eval/runs/2026-10-12-497-confirm/read.mjs \
  eval/runs/2026-10-10-497-wave-g/lane/groundedness-claude-sonnet-5-5-effort-low-20261011T012347Z.jsonl \
  eval/runs/2026-10-12-497-confirm/lane/groundedness-claude-sonnet-5-5-effort-low-20261012T233756Z.jsonl
```

**It ran to the end, red on two blocking gates.** No stall, no 429, 5xx or
overloaded response, no `unknown knob` line. One query expansion timed out
(`ask: expansion failed — reason=timeout`, in the groundedness phase; the log
doesn't name the case). No rerank reading was lost: none of 588 in hit-rate,
none of 43 in abstention, none of 586 in groundedness. vitest: 2 failed | 38
passed | 1 skipped, in 2 failed and 6 passed files.

## Smoke

`iva-ajuste-bien-de-capital`, `ho-cobrar-8-anos-atras-caja` and
`ho-t2-payoneer` (one per change: #604's narrower pin on Wave G's inference
fail, #600's rule-7 form on an absence tail, #600's first person): 3/3
grounded, 0 false absence claims, Tier 1 4/4. `ho-t2-payoneer` stayed
inadequate, the same two claims Wave G missed.

## Gates

| Gate                                           | Wave G (e7d954c) | This lane   | Read                                                                                               |
| ---------------------------------------------- | ---------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Groundedness, judges' first verdict (#474)     | 71/74            | **73/74**   | green (baseline 73, floor 69); 1 fail, `ho-t2-credito-iva-compras`, inference, 3/3 judges          |
| Blocking cases, 2 of 3 answers (#474)          | green            | **green**   | 0 re-asked                                                                                         |
| False corpus-absence claims (#500, #547)       | 0 · 0            | **0** · 0   | green in both                                                                                      |
| Tier 1 requirements stated                     | 93/116           | **88/116**  | green, exactly at the floor (baseline 92, fails ≤ 87); 12 lost, 7 gained, below                    |
| Tier 1 cases fully adequate (reported)         | 15/27            | 8/27        | reported, not gated; 8 pass → fail, 1 fail → pass, below                                           |
| Tier 2 adequate ≥ 84%                          | 12/14            | **11/14**   | **red** (78.6 %); `tribu-cr-declarar-pagar`, `ho-t2-payoneer` again, `ho-t2-constancia-al-dia` new |
| Citation invariant                             | 0                | 0           | green                                                                                              |
| Derived figures completely cited; F1 both BMCs | green            | green       | green                                                                                              |
| Abstention ≥ 90%                               | 15/15            | **15/15**   | green                                                                                              |
| Abstention invents no figure while declining   | green            | **green**   |                                                                                                    |
| `ho-abs-iva-2027` requirement (#502)           | 1/1              | **1/1**     | green                                                                                              |
| Hit-rate ≥ 94%                                 | 73/74            | **73/74**   | green (98.6 %); misses `ho-t2-credito-iva-compras` (not in the pool), as in Wave G                 |
| All expected targets reached (#570, reported)  | 50/74            | 47/74       | reported; robustness block 14/27                                                                   |
| Robustness block, hit (#502)                   | 27/27            | **27/27**   | green (baseline 27, fails ≤ 24)                                                                    |
| Robustness block, grounded                     | 27/27            | 27/27       |                                                                                                    |
| Robustness block, adequate · requirements      | 2/7 · 26/37      | 2/7 · 28/37 | reported                                                                                           |
| Conflicting sources (#135)                     | green            | **red**     | judge: «treats them as legitimately different temporal versions rather than … a contradiction»     |
| Consolidated vs reform, amending law, census   | green            | green       | census 281/281                                                                                     |
| vitest                                         | green            | **red**     | 2 failed: Tier 2 adequacy, conflicting sources                                                     |

The tier1-carriers readout reads 23/49 carrying chunks in the answer set
(Wave G 22/47; #605–#607 added two rows).

## What #604 and #600 did

- **#604 did what it was for.** Wave G's three inference fails
  (`iva-ajuste-bien-de-capital`, `ho-t2-compu-cara-iva`,
  `ho-t2-panaderia-simplificado`) all ground. The salario base circular sits in
  28 of the 101 answer sets, against 38 in Wave G. The one new fail,
  `ho-t2-credito-iva-compras`, is about «artículo 37 del Reglamento», which the
  set names but doesn't carry; it has nothing to do with the circular.
- **#600 did what it was for.** #600's `first-person-check.sh` finds 2 of 101
  groundedness answers, against 16 in Wave G. They are
  `renta-plazo-followup` («no puedo compararla con la fecha de hoy») and
  `rb-corto-tramos-renta`'s rule-6 scope sentence («queda fuera de lo que cubre
  este asistente»), which a decline may keep.
- **It missed one place:** the conflicting-sources answer, which the
  groundedness transcript doesn't hold, still says «no puedo indicarle cuál
  aplica» and «lo que recibí». Rule 4b's own wording is «usted no puede
  afirmarlo».

## The regression read

Free, from both lanes' transcripts. The lanes ran the same configuration, and
their answer sets differ a lot: the median Jaccard overlap over the 101 rows is
0.64 (`read.log`). Query expansion is a model call, so a lane's retrieval is
itself a draw. #600 changes only the answer prompt. #604 only decides whether
the circular is appended after the rerank cut, and an append moves no other
chunk. So any requirement whose carrying chunk changed sets is not either
change's doing.

Causes: **(a) retrieval**, the carrier was in Wave G's set and not in this
one's (or the reverse for a gain); **(b) answer**, the carrier was in both
sets and only one answer stated it; **(c) judge/noise**, both answers say the
same thing (or both lack the same thing) and the verdicts differ.

### Tier 1: 12 lost

| Case                                 | Requirement lost                                          | Cause                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ccss-pedir-prescripcion-cuotas`     | 20 días hábiles to resolve, by phase                      | **(a)** `ccss-prescripcion` «¿…en cuanto tiempo resuelve…?» (`f5de49d4`) only in Wave G's set                                                                                                                                      |
| `ccss-ventana-prescripcion-24-meses` | after the window, 10 years; the CCSS checks interruptions | **(c)** carrier `2228e7de` in both; both answers state the 10 years and neither mentions interruption                                                                                                                              |
| `ccss-obligacion-ingreso-bajo`       | the obligation is in the Ley Constitutiva and Reglamento  | **(c)** carrier `abd64e0e` in both; both write «está obligado a asegurarse» and neither names the law                                                                                                                              |
| `ccss-obligacion-ingreso-bajo`       | categoría 1 of the scale                                  | **(b)** carrier `4d27bd2c` in both; Wave G gave «la categoría 1 (menos de ₡346.790) … 2.89 %», this answer drops the scale and gives the payment-date table instead                                                                |
| `inscripcion-tardia-sancion`         | regularize: the inscription filing in TRIBU-CR's OVi      | **(a)** `tribu-cr-faq` Declaraciones del RUT · 2 (`ab018516`) only in Wave G's set; this set leans to CCSS prescripción chunks                                                                                                     |
| `ho-trabajitos-por-mi-cuenta`        | contribuyente de utilidades and, if gravado, of IVA       | **(c)** carrier `ley-renta` 2 in both; both say «deben inscribirse» and «si sus actividades están gravadas con el IVA, también»                                                                                                    |
| `ho-donde-inscribo-ya-no-atv`        | the OVi path to the inscription filing                    | **(a)** Declaraciones del RUT · 3 (`b4d65583`, «dividido en secciones») only in Wave G's set                                                                                                                                       |
| `ho-tiquete-en-vez-de-factura`       | the art. 9 list of comprobantes                           | **(b)** carrier `113ca5fd` in both; Wave G listed them, this answer doesn't                                                                                                                                                        |
| `ho-cliente-espana-lleva-iva`        | 13 % if consumed in Costa Rica                            | **(a)** `ley-iva` 10 (`3895c7d0`) only in Wave G's set                                                                                                                                                                             |
| `ho-iva-en-cero-sin-facturar`        | 50 % of a salario base for an omitted declaration         | **(a)** `cnpt` 79 (`9cf26fa0`) only in Wave G's set; it sits at the cut in both lanes' hit-rate legs (rr#38, rr#36). The answer writes #600's form instead: «La sanción por no presentar la declaración … confírmelo con Hacienda» |
| `ho-tambien-asegurado-por-patrono`   | the afiliación, at a sucursal or online                   | **(c)** its carrier (`ccss-reglamento-ti` 7) is in neither set; both answers give the same ajuste channel («presencial … o por los mecanismos electrónicos»), and only Wave G's passed                                             |
| `ho-cobrar-8-anos-atras-caja`        | prescription doesn't run by itself; it must be asked for  | **(b)** carrier `ley-10363` 2 in both; Wave G: «la prescripción no opera sola», this answer: «debe declararse en sede administrativa a petición suya»                                                                              |

**(a) 5 · (b) 3 · (c) 4.** No loss is #600's rule-7 form standing where Wave G
stated a fact from the same set. The one rule-7 sentence in the table
(`ho-iva-en-cero-sin-facturar`) comes after a retrieval loss, where the rule
is the right behaviour. #604 can't have caused `ho-iva-en-cero-sin-facturar`'s
loss: the circular is missing because its trigger, `cnpt` 79, is missing, and
`ho-desinscribir-debiendo-declaraciones` missed the same 50 % in Wave G too.
The three (b) losses are plain omissions, no first-person or confirm sentence
in their place.

### Tier 1: 7 gained

| Case                              | Requirement gained                                  | Cause                                                                                                                                                       |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desinscripcion-dejar-actividad`  | the steps in the OVi                                | **(c)** same carriers; both answers give «Mis datos» → «Declaración de desinscripción»                                                                      |
| `ho-donde-inscribo-ya-no-atv`     | the OVi user is the cédula, DIMEX or NITE           | **(c)** both answers say «solo necesita un documento válido (cédula de identidad, DIMEX o NITE)»                                                            |
| `ho-factura-electronica-o-recibo` | the exceptions don't reach a gravado persona física | **(b)** carrier `reglamento-renta` 84 in both; only this answer lists «Quiénes no están obligados»                                                          |
| `ho-cabys-paginas-web`            | the code comes from the CABYS catalogue             | **(c)** both give the CABYS code 8314100000200 from `cabys-dev`                                                                                             |
| `ho-cabys-paginas-web`            | what each detail line carries                       | **(a)** `reglamento-comprobantes` 13 (`0982390e`) only in this set                                                                                          |
| `ho-cliente-espana-lleva-iva`     | the exempt operation is documented all the same     | **(a)** `reglamento-comprobantes` 13 only in this set                                                                                                       |
| `ho-rebajar-25-sin-facturas`      | the Ley 10818 reform and when it applies            | **(b), #600.** Wave G: «Los documentos oficiales que consulté no indican desde cuándo aplica esa reforma»; this answer states the reform and drops the tail |

**(a) 2 · (b) 2 (one #600) · (c) 3.** Net by cause: retrieval −3, answer −1,
noise −1, total −5 (93 → 88).

### Tier 1 cases fully adequate, 15 → 8

Of the eight pass → fail, `ccss-pedir-prescripcion-cuotas`,
`inscripcion-tardia-sancion` and `ho-iva-en-cero-sin-facturar` are
retrieval; `ccss-ventana-prescripcion-24-meses`, `ho-trabajitos-por-mi-cuenta`
and `ho-tambien-asegurado-por-patrono` are noise; `ho-cobrar-8-anos-atras-caja`
is an answer omission; `ccss-obligacion-ingreso-bajo` is one noise and one
answer omission. `ho-cabys-paginas-web` (fail → pass) is one retrieval and one
noise. Each of these cases turns on one requirement, so the count swings more
than the requirements do.

### Tier 2 and conflicting sources

- **`ho-t2-constancia-al-dia`, new: (a).** «La situación tributaria se consulta
  en la OVi pública de TRIBU-CR, sin necesidad de usuario.» Wave G's set held
  `tribu-cr-faq` Consulta de la Situación Tributaria (OVi Pública) · 1
  (`aff5121c`, «permite a cualquier persona, sea o no contribuyente»), and its
  answer cited it. This set doesn't hold it.
- **`ho-t2-payoneer`, both lanes: (a).** The same two claims missed. This
  answer set shares no chunk with Wave G's: it is nine CCSS and IVA chunks
  with no `ley-renta`, while the hit-rate leg put `ley-renta` 1 at rr#3. This
  is the only set that far off, so it is a candidate for the one expansion
  timeout. That is plausible, not shown, since the log doesn't name the case.
- **`tribu-cr-declarar-pagar`, both lanes: (a).** The 6 October 2025 date is in
  `tribu-cr-res-0011-2025`'s Transitorios II and III, which neither set holds.
  This answer misses one claim, against Wave G's two: the formularios clause now
  passes.
- **Conflicting sources: (c), on a borderline answer.** The answer gives both
  decrees, each with its citation, and says to verify with Hacienda. It opens
  «Las fuentes traen dos cifras distintas, porque corresponden a dos decretos
  anuales diferentes» and never writes that they discrepan. 2026-10-08's
  `final/lane1` opened with the same sentence and the judges passed it. Waves
  D, E and G, 2026-10-08's `baseline` and #546's lane all said «discrepan»
  and passed. The answer's
  wording drifts, and the judge reads this one as different years, not a
  contradiction. Neither #600 nor #604 touches rule 4b.

### The 19 incomplete Tier 1 cases

This lane misses 28 requirements. Carriers come from
`../2026-10-08-554/carriers.json` (with #602's map), and the rest were read by
hand above. The local stack was queried read-only for
`ho-donde-inscribo-ya-no-atv`'s requirements (Registro Único Tributario (RUT)
· 2, `9e67cf7f`).

| Cause                                   | Requirements | Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval miss (no carrier in this set) |           17 | `ccss-pedir-prescripcion-cuotas`, `desinscripcion-dejar-actividad` (ATV half, #602), `inscripcion-tardia-sancion`, `ho-hacienda-solo-cliente-eeuu` ×2 (`ley-iva` 4/5/8), `ho-donde-inscribo-ya-no-atv` ×2 (RUT · 2, RUT · 3), `ho-cliente-espana-lleva-iva` ×2 (13 %; the factura de exportación), `ho-iva-en-cero-sin-facturar`, `ho-rebajar-25-sin-facturas` (RES-0020 Art. 3), `ho-minimo-renta-2026`, `ho-ademas-tengo-salario` ×3 (`ley-renta` 22), `ho-tambien-asegurado-por-patrono`, `ho-desinscribir-debiendo-declaraciones` (`cnpt` 79) |
| In the set, unsaid                      |           11 | `ccss-ventana-prescripcion-24-meses`, `ccss-obligacion-ingreso-bajo` ×2, `ho-trabajitos-por-mi-cuenta`, `ho-donde-me-afilio-caja`, `ho-tiquete-en-vez-de-factura` ×2, `ho-factura-electronica-o-recibo`, `ho-cliente-espana-lleva-iva` (hecho generador), `ho-ademas-tengo-salario` (two scales), `ho-cobrar-8-anos-atras-caja`                                                                                                                                                                                                                   |
| Corpus gap                              |            0 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Correction (2026-10-12, `stability.log`):** one row is misfiled.
`ho-cliente-espana-lleva-iva`'s «factura electrónica de exportación» is in this
set (`reglamento-comprobantes` 13, as the paragraph below says), so it is
unsaid, not a retrieval miss. The split is **16 retrieval · 12 unsaid**; the
case counts below are unchanged, since the case misses on both anyway.

By case: 10 of the 19 miss on retrieval alone, 7 only on unsaid carriers, and 2
(`ho-cliente-espana-lleva-iva`, `ho-ademas-tengo-salario`) on both. Four of
the 11 unsaid rows are judge-sensitive: their wording passed in Wave G
(`ccss-ventana-…`, `ccss-obligacion-…` law, `ho-trabajitos-…`,
`ho-cobrar-8-…`).

`ho-cliente-espana-lleva-iva` also writes «Los documentos oficiales no indican
cuál tipo de comprobante corresponde a su caso», while its set lists the
«Factura Electrónica de Exportación» (`reglamento-comprobantes` 13). That is
an absence claim in the third person, which the #500 detector doesn't count.

## Which change

**Mostly noise; the evidence doesn't point at #600 or #604.** Of the 12
requirements lost, 5 are retrieval draws and 4 are judge verdicts on the same
content. Neither change can move either kind. The 3 answer omissions
(`ccss-obligacion-ingreso-bajo`'s categoría 1, `ho-tiquete-en-vez-de-factura`'s
list, `ho-cobrar-8-anos-atras-caja`'s «no opera sola») are not #600's form and
don't involve the salario base. Against them, #600 has one clear gain
(`ho-rebajar-25-sin-facturas`) and the first-person drop from 16 to 2. #604 has
no Tier 1 loss and three groundedness fixes. #600's own fixed-chunk replay
(`../2026-10-12-600/`) read its Tier 1 guard at 27 → 30 of 37 on the same kind
of rows.

The evidence is thin in one way. Three answer omissions on one draw is within
what two identical lanes differ by (±4 on Tier 1, #457), so they can't be told
apart from sampling without a second draw. The red Tier 2 gate is three cases,
all retrieval, two of them failing in Wave G too. The conflicting-sources red
is one judge call on wording that has passed before.

**The cheapest paid check that would settle it (not run):** a fixed-chunk
`pnpm answer-replay` of Wave G's lane rows for the 11 Tier 1 cases with a lost
requirement, on main b416b54, two draws each. That is 22 rows at #591's
≈US$0.11 a row, plus re-judging, so **≈US$2.5**. If the requirements come back
on Wave G's own sets, the drop is retrieval and judge noise. If the three (b)
omissions stay, the prompt is the suspect, and a control arm on a39df82 (the
pre-#600 prompt, the same 22 rows, ≈US$2.5 more) separates #600 from
sampling. The conflicting-sources case alone, re-asked three times on main
(#474's 2-of-3), costs ≈US$0.30. This proposes no tuning toward a number (ADR
0023).

## Conflicting sources, re-asked

After the lane the orchestrator re-asked the case three times on main at
0aa2011, whose answer path is b416b54's (`conflicting/`). **3/3 pass**, so
the lane's red reads as one fail in four asks: noise on a borderline answer,
as above. The ≈US$2.5 fixed-chunk replay was not run, by the owner's decision.

Two of the three answers keep first person: «no puedo señalar cuál aplica a
su caso» (re-ask 2) and «no aparecen en lo que recibí de las fuentes, así que
no puedo darlos aquí» (re-ask 3). Rule 4b's own last sentence ends «usted no
puede afirmarlo», which likely invites it. #600's rules 3 and 7 don't reach
this answer, and the groundedness transcript doesn't hold it, so
`first-person-check.sh` can't see it either.

## Where the retrieval variance enters

`stability.mjs` reads both lanes' hit-rate blocks (the expansion text and the
pool#/rr# of each printed target, catalogue reach and carrier) and both
groundedness answer sets. It is free.

```sh
node eval/runs/2026-10-12-497-confirm/stability.mjs \
  eval/runs/2026-10-10-497-wave-g/lane-20261011T005438Z.log \
  eval/runs/2026-10-12-497-confirm/lane-20261012T230811Z.log \
  eval/runs/2026-10-10-497-wave-g/lane/groundedness-claude-sonnet-5-5-effort-low-20261011T012347Z.jsonl \
  eval/runs/2026-10-12-497-confirm/lane/groundedness-claude-sonnet-5-5-effort-low-20261012T233756Z.jsonl
```

- **The expansion text differs on 100 of 100 cases** between the lanes. The
  step family is the same on 99, and the one that changes
  (`exportacion-comprobante-followup`) is a follow-up whose condensation
  changed: 14 of 101 rows ran on a different condensed query.
- **Seven of the 16 retrieval misses are a step-pin draw.** The carrier is in
  the pool every time it is printed (pool#2–#20), the rerank puts it at
  rr#16–#38, and it reaches the set only when a pin brings it. `pin1` takes 2
  of a family's 4–5 sentence picks, ranked by the question-and-expansion
  order, so which two changes with the expansion. Six of the seven are pinned
  in a lane's hit-rate draw and absent from the same lane's answer set; the
  seventh (`cnpt` 79 for `ho-iva-en-cero-sin-facturar`) is the reverse.
- The others: 2 are in the pool and cut on every draw (`cnpt` 79 at rr#28,
  RUT · 2 at rr#10–#12), 2 enter the pool only on some expansions (`ley-iva`
  5, RES-0020/RES-0011), 2 are in no pool read (the ATV carriers, `ley-iva`
  4/8), and 3 aren't printed by the lane, so their place is unknown.

## Baselines

None moved. Groundedness stays 73 (floor 69), Tier 1 92 (fails ≤ 87), the
robustness hit 27, hit-rate 94 %, Tier 2 84 %.

## Cost

There is no console figure. The estimate is Wave G's lane, the same
configuration and row count.

| Step                                                     | ≈US$       |
| -------------------------------------------------------- | ---------- |
| Smoke (3 answers, judges, rewrites, rerank)              | 0.20       |
| Lane: answers, judges, adequacy and label judges         | 8.30       |
| Lane: abstention, fixtures, embeddings, rerank, rewrites | 2.10       |
| Conflicting sources re-asked ×3 (answers, judges)        | 0.30       |
| **Total**                                                | **≈10.90** |

The read above is free: transcripts, `read.mjs`, `first-person-check.sh` and
one read-only query on the shared local stack.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
