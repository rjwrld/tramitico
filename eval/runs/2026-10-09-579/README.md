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

## Paid step (2026-10-09, orchestrator's go)

The two parts ran one after the other at ≈19:10 UTC with `ANSWER_EFFORT=low`.
The transcripts are also in `<main-checkout>/eval/transcripts/2026-10-09-579/`.

| Part                                                                                                                           | Files                               | ≈US$ |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---- |
| `answer-set-probe` on the 8 cases, rewrites replayed from `2026-10-09-562/probe-after.json`, `PROBE_CASE_MS=3000`              | `probe.json`, `probe-…T191003Z.log` | 0.03 |
| `answer-replay` of `rb-seguimiento-le-cobro-iva` ×3 on Wave E's chunks plus `salario-base-2026` as [12] (`replay-input.jsonl`) | `replay/`, `replay-…T191046Z.log`   | 0.30 |

**Probe.** No rerank readings were lost (0 of 52), and no case was weak. The
route's configuration with the pin is compared with `/sboff`, the same run's
order without it:

- 7 of the 8 sets gain `salario-base-2026`.
- `iva-declaracion-mensual` is unchanged because its set no longer holds
  `cnpt` 79 under #562's catalogue. #562's own probe already showed this.
- No set loses a chunk, and expected targets stay at 12/16.
- Derived figures resolved go from 0 to 7. The salario base completes the
  manifest's `cnpt-articulo-78-multa-mensual-2026`, `-tope-2026` and
  `cnpt-articulo-79-multa-declaracion-2026`.
- **The cause is now proven, not just likely.** The new `pins` record shows
  the `cnpt` 78/79 chunk as a `step` pin in all 7 sets.

**Replay.** The pass bar was 3/3 with no false absence claim, and it was met:

```
grounded, recorded → replayed: 0 → 3 of 3
false absence claims (#500), recorded → replayed: 3 → 0
citation invariant: 0 violation(s)
derived figures incompletely cited: 0
```

All three answers state the multa as «¢231.100 (0,50 × ¢462.200)», cited
[10][12]. The live probe set for this case differs from Wave E's in one
cross-referenced chunk: `reglamento-iva` 66 instead of `ley-iva` 11. The replay
holds Wave E's set fixed so that the only change from the red answer is the
appended chunk.
