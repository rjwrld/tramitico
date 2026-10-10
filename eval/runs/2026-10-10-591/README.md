# Every amount in salarios base brings the salario base, 2026-10-10 (#591)

#579 (PR #590) made `PIN_SALARIO_BASE` append the salario base in force when
the cut states a **multa or sanción** in salarios base. Owner decision 4
(2026-10-10) widened it: any amount a set chunk states as a multiple or a
fraction of the salario base triggers it, so an exemption threshold or a tramo
can't repeat #579's false absence («no tengo el monto del salario base»). The
pin now also reports what it did in the ask event (`salarioBase`).

## The trigger

`statesAmountInSalariosBase` (`src/lib/answer/salario-base.ts`): a count or a
share right before «salario(s) base», in figures or words, bare or in
parentheses, then at most «de», «del» or «de un». «tres salarios base»,
«(117) salarios base», «1,000 (mil) salarios base», «medio salario base»,
«(50%) de un salario base», «(1,5) del salario base». The words «salario base»
with no count before them don't trigger it: «la denominación salario base»,
«el monto actualizado del salario base», «se entiende como salario base».
#579's sanción reading is kept as `statesSanctionInSalariosBase` for its
census and this comparison. Every chunk it matches, the new one matches too.

## Match list (free)

`match-list.sql` is one read-only `SELECT` on the shared local stack (run
through the supabase-local MCP), with both patterns in Postgres regex.
`match-list.tsv` is its result. `census.ts` runs the TypeScript detectors
themselves over the same 873 chunks (`census.log`). The two agree row for row.

26 chunks say «salario(s) base». #579 fired on 4, #591 fires on 24:

| Fires on           | Chunks                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| both (#579's four) | `cnpt` 78, 79, 81 #0; `ley-iva` 85 bis                                                                                                                                                                                 |
| #591 only (20)     | `cnpt` 81 #1; `ley-iva` 8, 11 bis, 13; `ley-renta` 13, 31 ter; `reglamento-iva` 11 #2, 11 #3, 31, 38 bis, 58, 64; `reglamento-iva-bienes-capital` 31; `reglamento-renta` 30 #0, #1, #2, 81, 107; `reglamento-rts` 2, 3 |
| neither (2)        | `reglamento-renta` 22 (a definition: «se entiende como salario base (\*) la contenida en…»); `salario-base-2026` itself                                                                                                |

## Which eval sets change (free)

`offline-check.ts` does what #579's did. It takes each case's route set
(`top8/capoff/pinon`) from `2026-10-09-562/probe-after.json`, the newest full
probe (116 cases). It removes the recorded appends to get back to the cut,
then re-pins the cut with today's `pinAnswerSet` against the local stack. No
provider call. Log: `offline-check.log`.

- **32 sets gain `salario-base-2026`. 25 of them gain it only because of
  #591**, and the other 7 are #579's. 6 more sets trigger and already hold
  the circular. No set loses a chunk.
- The 25: `inscripcion-hacienda-clientes-extranjero`, `iva-clientes-fuera-cr`,
  `cabys-desarrollo-software`, `ccss-asalariado-y-freelance`,
  `regimen-simplificado-programador`, `iva-tarifas-reducidas`,
  `renta-tramos-2026`, `renta-pagos-parciales-retenciones`,
  `renta-salario-y-actividad`, `exportacion-servicios-comprobante`,
  `iva-ajuste-bien-de-capital`, `iva-retencion-tarjetas-porcentaje`,
  `ho-cliente-espana-lleva-iva`, `ho-minimo-renta-2026`,
  `ho-ademas-tengo-salario`, `ho-t2-hosting-extranjero`,
  `ho-t2-retencion-tarjetas`, `ho-t2-compu-cara-iva`,
  `ho-t2-panaderia-simplificado`, `ho-t2-payoneer`, `rb-pill-iva-exterior`,
  `rb-corto-tramos-renta`, `rb-corto-que-cabys`, `rb-spanglish-client-usa`,
  and the abstention case `abs-patente-comercial`.
- The biggest carriers are `reglamento-renta` 30 (9 sets) and `ley-iva` 8 (6
  more, besides two of #579's). `reglamento-renta` 30 puts the tramos of
  cooperative excedentes, in salarios base, in the same artículo as pagos
  parciales and retenciones. `ley-iva` 8 puts the alquiler exemption in the
  same artículo as the export exemption. `ley-renta` 31 ter brings it to
  `ho-minimo-renta-2026` and `rb-corto-tramos-renta`, but its tramos are also
  the cooperatives', not the persona física's, which are in colones. So in
  most of the 25 the amount in salarios base isn't what the question asks
  about. It may be in `iva-ajuste-bien-de-capital` and `ho-t2-compu-cara-iva`
  (the fifteen salarios base for a bien de capital).

## Paid step

Pending the orchestrator's OK. See the PR thread.
