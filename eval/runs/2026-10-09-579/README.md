# A multa in salarios base brings the salario base, 2026-10-09 (#579)

Wave E's lane went red on `rb-seguimiento-le-cobro-iva` (#500's false-absence
zero): the set held `cnpt` · Artículo 79, «multa equivalente al cincuenta por
ciento (50%) del salario base», and not `salario-base-2026`, and the answer
said the documents did not carry «el monto vigente del salario base».

The owner chose option A: the pin appends the salario base the year serves when
the cut states a sanción in salarios base. It is `PIN_SALARIO_BASE`, on by
default (`src/lib/answer/salario-base.ts`).

## Why its own pin, with a lookup

- **Not `PIN_DERIVED_INPUTS`.** That pin completes arithmetic over declared
  inputs, and nothing here is computed. Its eligibility rule is «a sibling input
  survived», and `cnpt` 79 is not an input.
- **Not `PIN_CROSS_REFERENCES`.** The artículo never names the circular. A
  cross-reference is a citation the text makes, and this one would be a guess.
- **Not pool-only like `PIN_NAMED_SOURCES`.** In all 8 cases below,
  `salario-base-2026` is not in the fused pool at all, so a pool-only append
  would add nothing. The pin reads the pool first. Otherwise it makes one
  service-role read, fail-open, with #508's 2 s budget, and runs beside the
  cross-reference lookup.
- **The year in force, not 2026.** The candidates are the `salario-base`
  annual-series entries that `retrieve()` serves today (`withheldSources`,
  #505). Next year's circular takes over on 1 January without a code change. A
  year with no circular appends nothing (unit-tested at 2027-01-02).

## The detector

The text has to say a multa or a sanción, then a count of salarios base in the
same clause. A free census of the local stack (`census.ts`, `census.log`)
checked all 873 chunks, and the detector fires on exactly four:

```
cnpt · Artículo 78 #0
cnpt · Artículo 79 #0
cnpt · Artículo 81 #0
ley-iva · Artículo 85 bis #0
```

Salario-base thresholds that aren't sanciones don't fire it. Examples are
`ley-iva` 8's alquiler exemption, `reglamento-iva` 31's bienes de capital and
`ley-renta` 31 ter. Option A doesn't cover them.

## Free check on the saved probe sets

`offline-check.ts` takes each case's route set (`top8/capoff/pinon`) from the
saved probes. It removes the recorded appends to get back to the cut, then
re-pins the cut with today's `pinAnswerSet` against the local stack. Log:
`offline-check.log`.

| Probe                             | Sets with a sanción in salarios base | Salario base already in | Added by the pin | Other sets changed | Chunks lost |
| --------------------------------- | ------------------------------------ | ----------------------- | ---------------- | ------------------ | ----------- |
| `2026-10-09-561/probe-after.json` | 14                                   | 6                       | **8**            | 0                  | 0           |
| `2026-10-09-562/probe-after.json` | 13                                   | 6                       | **7**            | 0                  | 0           |

The 8 cases: `iva-declaracion-mensual` (561 only), `inscripcion-tribu-cr`,
`ho-hacienda-solo-cliente-eeuu`, `ho-iva-en-cero-sin-facturar`,
`t2-inscripcion-dimex`, `rb-corto-cuando-declaro-iva`,
`rb-tilde-inscribirme-afuera`, `rb-seguimiento-le-cobro-iva`.

In every one of them, the multa sits at set position 9 or 10. Those are the two
places `STEP_PINS=2` appends past the top 8. That fits #579's «likely» cause,
a step pin. The probe can't prove it: its `pinned` field has never listed step
picks. From this change on, the probe records them per configuration (`pins`),
and so do the lane transcripts (`chunks[].pin`).

## Paid step

Pending the orchestrator's go. Details below once run.
