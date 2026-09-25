# The carrying chunks at the cut, 2026-09-24 (#287)

The evidence behind «The carrying chunks at the cut (2026-09-24, #287)» in
[`eval/README.md`](../../README.md): retrieval-only hit-rate lanes (no answer
model, no judge) on the local stack carrying the same 873-chunk ingest as
[`2026-09-24-352`](../2026-09-24-352/), with this branch's catalogue, the BMC
figure group and `STEPS_RERANK=slot`. Every retrieval knob was set on the
command line to its production value (`STEPS=on EXPAND=on RERANK=voyage
PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8 ANSWER_DOC_CAP=off`); only `STEPS_RERANK`
moved between arms. Each log ends with the `carrying chunks` block that
`eval/tier1-carriers.json` drives.

| File                                      | What it is                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke-slot-multa-iva-no-declarado.log`   | The one-case smoke read (cents) before the lanes: expansion answered, `salario-base-2026` entered the pool at #17, all three fine figures resolved. Gates fail by design on a subset.                           |
| `hitrate-off-r2-…` · `hitrate-off-r3-…`   | Arm `off`, the shipped step mode: 71/73 and 70/73 (r3's blocking red is `ho-factura-electronica-o-recibo` at rerank #9, the edge case the 2026-09-24 full lane also missed). Carriers 5/47 ×2.                  |
| `hitrate-pin1-r1-…` · `hitrate-pin1-r2-…` | Arm `pin1` (#311): 71/73 ×2, every gate green. Carriers 14/47 ×2. r1's expansion timed out on one case (`iva-credito-fiscal-compras`, untiered, no carriers).                                                   |
| `hitrate-slot-r1-…` · `hitrate-slot-r2-…` | Arm `slot`: 71/73 ×2; r1's blocking red is `ccss-pedir-prescripcion-cuotas`, its target displaced from #8 by a step pick. Carriers 23/47 and 24/47. r2's expansion timed out on `ccss-obligacion-ingreso-bajo`. |
| `dead/hitrate-off-r1-…`                   | The first `off` run, discarded: four expansion timeouts and one lexical-only degrade on its first cases, three of them carrier cases. Replaced by r3, not counted.                                              |

The logs' paths to the worktree and the session scratchpad are replaced with
`<worktree>` and `<scratchpad>`. Nothing else is edited. They carry no chunk
text, only chunk labels, and the expansion rewrites (model output about
public law).
