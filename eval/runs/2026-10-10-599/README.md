# The salario base only where the set ties it to Ley 7337, 2026-10-10 (#599)

Wave G's lane (`2026-10-10-497-wave-g/`) failed three groundedness rows, 3/3
judges each, all labelled inference: `iva-ajuste-bien-de-capital`,
`ho-t2-compu-cara-iva` and `ho-t2-panaderia-simplificado`. In each set,
#591's wide trigger had appended the Corte's circular (`salario-base-2026`)
beside an amount in salarios base whose chunk never names Ley 7337
(`reglamento-iva-bienes-capital` 31, «quince salarios base»;
`reglamento-rts` 2 and 3). The circular says it applies to the Código Penal
«y demás normativa … que refieran a la citada norma», so nothing in those
sets ties ¢462.200 to the threshold the answer applied it to.

Owner chose option A on 2026-10-10. The pin now fires on #579's sanción
reading, **or** on an amount in salarios base (#591's reading) when that same
chunk names Ley 7337 in its own text (`triggersSalarioBase`,
`namesLey7337` in `src/lib/answer/salario-base.ts`). The `salarioBase` event
field and `onSalarioBase` are unchanged.

«Ley 7337» is read on folded text as «ley», then up to 12 non-digit
characters, then `7337` or `7.337` as a whole number: «Ley 7337», «Ley N.°
7337», «ley No. 7337», «Ley Nº7337», «Ley número 7337». Another law («Ley
10.620»), a longer number («17337», «7337,5»), a decree or an amount of 7337
does not match. A bare «7337» with no «ley» before it does not match either;
no chunk in the corpus cites it that way.

## Match list (free)

`census.ts` runs the detectors over the shared local stack (894 chunks, after
#592's RES-0020 and RES-0033), read-only. Log: `census.log`.

- 7 chunks name Ley 7337, the same 7 that `content like '%7337%'` returns:
  `ley-iva` 8 and 11 bis, `ley-renta` 13, `reglamento-iva` 38 bis,
  `reglamento-renta` 22 and 30 #2, and the circular itself.
- **9 of #591's 24 chunks still trigger**: #579's four sanciones (`cnpt` 78,
  79, 81 #0; `ley-iva` 85 bis) and five amounts that name the law (`ley-iva` 8,
  11 bis; `ley-renta` 13; `reglamento-iva` 38 bis; `reglamento-renta` 30 #2).
  `reglamento-renta` 22 names the law but states no amount, and the circular
  states none either, so neither triggers.
- The 15 that no longer trigger: `cnpt` 81 #1; `ley-iva` 13; `ley-renta` 31
  ter; `reglamento-iva` 11 #2, 11 #3, 31, 58, 64; `reglamento-iva-bienes-capital`
  31; `reglamento-renta` 30 #0, 30 #1, 81, 107; `reglamento-rts` 2, 3.

## Wave G's answer sets (free)

`wave-g-check.ts` reads Wave G's lane transcripts. A set's cut is its chunks
with no pin or a step pin; the trigger reads only that. Log:
`wave-g-check.log`.

- **38 of the 101 groundedness sets carry the circular. 12 would lose it, and
  26 keep it.** Of the 26, 20 have a trigger in the cut. The other 6 got the
  circular another way: 5 as a CNPT multa's derived-figure input, and
  `ho-minimo-renta-2026` holds it in the cut.
- **All three failing rows lose it.** Their only triggers were
  `reglamento-iva-bienes-capital` 31, `reglamento-iva` 31 and `reglamento-rts`
  2/3.
- The other 9 that lose it: `regimen-simplificado-programador`,
  `iva-tarifas-reducidas`, `renta-tramos-2026`,
  `renta-pagos-parciales-retenciones`, `iva-retencion-tarjetas-porcentaje`,
  `ho-ademas-tengo-salario`, `ho-t2-credito-iva-compras`,
  `rb-corto-tramos-renta`, `rb-corto-que-cabys`. All 9 grounded in Wave G.
- No abstention set carried the circular in Wave G.

## Probe sets (free)

`offline-check.ts`, a copy of #591's, re-pins the saved probe sets with
today's `pinAnswerSet` against the local stack. No provider call. Log:
`offline-check.log`.

- `2026-10-09-562/probe-after.json` (116 cases, before #591): #591's reading
  fires on 38 cases, #599's on 25. 25 sets hold the circular past the cut, 19
  of them through this pin (32 under #591). No chunk other than the circular
  is lost.
- `2026-10-10-591/probe.json` (#591's 32 grown sets): 18 keep the circular,
  14 lose it, among them `abs-patente-comercial`, the abstention case #591
  flagged. No other chunk is lost.

## Answer replay: recommended skip

`answer-replay` re-answers a transcript row from its own chunk list. Replaying
the three Wave G rows as recorded would re-send the circular, so it wouldn't
test this change. Testing it means rebuilding each row without the circular,
which leaves Wave G's cut plus its other appends. Wave E's lane
(`2026-10-09-497-wave-e/`, before #590 and #596) already answered all three
cases on near-identical sets with no circular, and all three grounded `pass`.
Without the circular, Wave G's sets differ from Wave E's by one chunk in
`iva-ajuste-bien-de-capital` (`ley-iva` 16 for `reglamento-iva` Transitorio
V) and in `ho-t2-panaderia-simplificado` (`reglamento-rts` 6 for its
Preámbulo), and by four in `ho-t2-compu-cara-iva`. The ≈US$0.35
replay would re-measure that, so I recommend skipping it. The next lane reads
these three rows anyway.
