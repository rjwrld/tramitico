# A source the question names, 2026-10-08 (#559)

`factura-primera-cabys` opened with «Sobre el código CABYS no encuentro base
oficial», #500's false-absence gate, in #556's lane and 9 committed runs back
to 2026-09-16. Its `cabys-dev` target was never in the answer set.

**Cause (free, from committed probes).** Not the pool: `cabys-dev` is fused
#3–#6 in `2026-10-07-508/probe.json`, `2026-10-02-460/probe-branch.json` and
`2026-10-07-509-rate-anchors/probe-haiku-4-5.json`, and reaches the set at #3
with `RERANK=off` (`2026-10-08-baseline/probe-rerank-off.json`). The rerank
reads a list of codes #13–#23 against the question, and `pin1`'s one append
goes to the step pick the question ranks best, always a
`reglamento-comprobantes` artículo. The step catalogue already picks
`cabys-dev`. No artículo in the set names CABYS, so a cross-reference has
nothing to start from.

**Fix.** `pinAnswerSet` appends, last and at most one, the best pooled chunk
of a source the condensed question names by its own name (`NAMED_SOURCES` in
`src/lib/answer/steps.ts`; `cabys → cabys-dev` only), when the set holds no
chunk of that document. `PIN_NAMED_SOURCES=off` is the baseline.

**The read.** `pnpm answer-set-probe` on the three cases expecting
`cabys-dev`, from this worktree on 7f82577, every other knob at its code
default:

- `probe-before.{json,log}`: `PIN_NAMED_SOURCES=off`, live rewrites.
- `probe-after.{json,log}`: `PIN_NAMED_SOURCES=on`, with
  `EVAL_REWRITES=probe-before.json`, so the knob is the only change.

Cost ≈US$0.02 for both: three Haiku expansions in the first run, embeddings,
and 10 Voyage rerank readings per run. Paths in the logs read `<worktree>`.

Production configuration (`top8/capoff/pinon`):

| case                      | `cabys-dev` fused | before                   | after                                   |
| ------------------------- | ----------------- | ------------------------ | --------------------------------------- |
| `factura-primera-cabys`   | #3 (reranked #18) | 10 chunks, `cabys-dev` ✗ | 11 chunks, `cabys-dev` ✓ (#11, the pin) |
| `rb-pill-primera-factura` | not in the 40     | 9 chunks, `cabys-dev` ✗  | identical                               |
| `rb-tilde-primera-fatura` | not in the 40     | 9 chunks, `cabys-dev` ✗  | identical                               |

On `factura-primera-cabys` the first ten chunks are the same in both runs:
the cut, then `pin1`'s Art. 9 and the cross-reference's Art. 12. The pin
appends `cabys-dev` after them and changes nothing else; every other probe
config goes 1/2 → 2/2 targets on that case too. The two robustness rows never
say CABYS, don't classify to a family («factura» alone names none), and
`cabys-dev` is outside their fused 40, so neither the pin nor the catalogue
reaches them. Whether they should expect it is a dataset question.

Not read here: whether the answer now cites the codes instead of claiming
their absence. That needs an answer-model call. The next full lane's
false-absence gate reads it.
