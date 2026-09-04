# Eval dataset (SPEC §9, issues #25/#26)

`dataset.jsonl` holds the 30±5 hand-written eval questions — Appendix A's ten
pain questions plus corpus-derived ones — each with the source docs/artículos a
correct retrieval must surface. One JSON object per line:

```json
{
  "id": "iva-clientes-fuera-cr",
  "seed": "appendix-a:2",
  "question": "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?",
  "expected": [
    { "docKey": "reglamento-iva", "articulo": "Artículo 11" },
    { "docKey": "ley-iva", "articulo": "Artículo 8" }
  ],
  "blocking": true,
  "notes": "…"
}
```

- `expected` — any one target matching any answer-top-k chunk counts as a hit.
  Targets must be _correct sources for the question_, verified against the
  ingested corpus; never add a target just because retrieval returns it.
- `articulo` — exact label as chunked (case-insensitive); omit it to accept any
  chunk of the document (single-artículo docs like `cabys-dev`).
- `pathIncludes` — exact heading-path element, for artículo labels that repeat
  across Títulos of one norma.
- `blocking` — the case fails the eval on its own, regardless of hit-rate.
  The canary from ADR 0003 is the one blocking case.
- `seed` — provenance: `appendix-a:<n>` (SPEC Appendix A) or `corpus`.
- `history` — optional, and what makes a case a **condensation case** (#132,
  [ADR 0012](../docs/adr/0012-multi-turn-question-condensation.md)): a
  non-empty list of `{ question, answer }` turns preceding this one. Both eval
  suites condense such a case first — the same `condenseQuestion` the route
  calls — and then run the standalone result through the ordinary path, so
  `expected` describes the retrieval the _rewrite_ must produce, not the
  follow-up's. Write the follow-up the way a reader would type it ("¿Y si
  también soy asalariado?"): a case that would retrieve fine on its own proves
  nothing about condensation. Because these cases make a real model call, the
  hit-rate suite now needs `ANTHROPIC_API_KEY` too, and the per-case table
  prints the rewrite under any case that carries one — a miss is usually a bad
  rewrite rather than a retrieval regression.

The assertion lives in `src/lib/eval/retrieval-hitrate.eval.test.ts`
(loader/matcher in `src/lib/eval/dataset.ts`). It runs each question through
the production retrieval path — fused pool of 30, Voyage rerank, top-8 — and
gates on hit-rate, the blocking canary, and the weak-retrieval threshold. It is
env-gated: skipped without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and real
embeddings; CI runs it once those secrets exist (see `.github/workflows/ci.yml`).

Run locally:

```sh
supabase start && pnpm ingest   # once
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
pnpm vitest run src/lib/eval/retrieval-hitrate.eval.test.ts
```

`RERANK=off` measures the fused-only baseline; the per-case table (pool rank,
top score) prints with the run.

## Satisfiability guard (issues #111, #163)

The guard asserts every expected target is satisfiable by at least one ingested
chunk, and prints the full per-target census. The hit-rate eval cannot catch
this: a case hits when _any one_ of its targets matches, so a multi-target case
can carry a permanently unsatisfiable target and stay green forever — measuring
the corpus gap instead of answer quality.

It runs in **two lanes over one census** (`src/lib/eval/satisfiability.ts`):

- `src/lib/eval/dataset-satisfiability.test.ts` — the unit lane, on every PR,
  against `corpus-index.json`: a committed dump of the distinct
  `(docKey, articulo, path)` triples in `public.chunks`. Coverage is what the
  census needs, and coverage does not need embeddings — so a PR that adds an
  unsatisfiable target goes red with no database and no secrets. `pnpm ingest`
  rewrites the dump at the end of every run; **commit it with the corpus
  change**.
- `src/lib/eval/dataset-satisfiability.eval.test.ts` — the eval lane, against
  the real table. Same census, plus the drift check the committed dump cannot
  do for itself: it fails when `corpus-index.json` no longer describes
  `public.chunks`.

The eval-lane run needs no embeddings and no retrieval, only the database, so
it is far cheaper than the hit-rate eval:

```sh
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
pnpm vitest run src/lib/eval/dataset-satisfiability.eval.test.ts
```

Its limit is deliberate: an `articulo`-less target passes by construction,
since it matches any chunk of its document. Whether the document's _text_
supports the case's claim is the judgement half of #111's sweep, not a
predicate — that is what the `notes` field records.

## Groundedness gate (issue #26)

`src/lib/eval/groundedness.eval.test.ts` runs every dataset question
through the full production answer path — retrieval, rerank, then the answer
model (`ANSWER_MODEL`, default Sonnet) with the production system prompt —
and asks an LLM judge at temperature 0: _is this answer supported by the
retrieved chunks?_ A failed item is re-judged twice more and the majority
verdict stands, absorbing judge flakiness at n≈25 without loosening the gate.
**Blocking gate: ≥90% pass** (`GROUNDEDNESS_GATE` in
`src/lib/eval/groundedness.ts`), starting threshold per #14 — ratchet up,
never down.

The judge is pinned (`JUDGE_MODEL`, Sonnet 4.5 — it accepts temperature 0,
which Sonnet 5 rejects; [ADR 0007](../docs/adr/0007-groundedness-judge-model.md))
and does **not** follow `ANSWER_MODEL`, so answer models are always compared
against the same judge. Pure parts (prompt,
verdict parsing, majority rule) are unit-tested in
`src/lib/eval/groundedness.test.ts`.

Env-gated like the hit-rate eval, plus `ANTHROPIC_API_KEY`:

```sh
supabase start && pnpm ingest   # once
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
ANTHROPIC_API_KEY=<key> \
pnpm vitest run src/lib/eval/groundedness.eval.test.ts
```

> **Gate run 2026-08-25 (#157) on the current corpus: 24/25 (96%) — PASS.**
> Answer `claude-sonnet-5`, judge `claude-sonnet-4-5`, ~404s, 825 chunks / 17
> documents / 0 missing embeddings, all 25 cases model-judged (no weak-retrieval
> short-circuits). Capture the per-case table with
> `--disableConsoleIntercept`: without it vitest swallows the `beforeAll`
> console output and a run reports only pass/fail, which is why two earlier
> entries here say "per-case not captured".
>
> The one failure was `iva-tarifas-reducidas` — **not** one of the three cases
> that failed on 2026-08-13. It is a rule 4 false positive: fragment [1] is
> `ley-iva` Artículo 11 (Ley 6826, consolidated text) and fragment [2] is
> `ley-9635` Artículo 11 (Ley 9635, the reform that rewrote it) — the same norma
> at two moments, not two sources in conflict. Rule 4 reads the differing
> figures as a live discrepancy and the answer duly reports one, which the judge
> correctly calls an unsupported claim. Ingesting a consolidated law _and_ its
> amending law guarantees such pairs, so this is structural, not a one-off.
> Left unfixed here on purpose: a rule 4 amendment has to be validated against
> `conflicting-sources.eval.test.ts`, which rule 4 exists to hold in place, and
> that is a different piece of work. Failed 3/3 attempts (gate run plus two
> subset reps) — consistent, not judge noise.
>
> [#268](https://github.com/rjwrld/tramitico/issues/268) later removed this
> production shape by retiring `ley-9635` after migrating every target to the
> consolidated `ley-iva`/`ley-renta` sources. The fixed two-fragment fixture in
> `amending-law.eval.test.ts` remains as a prompt regression test.
>
> **The 2026-08-13 failures did not reproduce.** That run scored 22/25 (88%,
> FAIL) on `iva-clientes-fuera-cr`, `ccss-cuanto-pago-base` and
> `tribu-cr-declarar-pagar`, and concluded the #135 prompt amendment was not the
> cause and corpus drift probably was. Re-measured on the post-#114 corpus, the
> first two pass in the gate run and 2/2 in a pinned-chunk subset re-run; the
> drift diagnosis holds. `tribu-cr-declarar-pagar` passed the gate but was
> **unstable** — 1/2 in the same subset re-run, failing when the answer either
> over-reads «la salida de TRIBU-CR, el próximo 4 de agosto» as an operational
> date or invents a discrepancy, the latter being the same rule 4 pattern as
> `iva-tarifas-reducidas`. It was retired when #258 added five stable CCSS cases
> and the 30±5 cap required one case to leave. Per-case stability at n≈25 is
> real: treat a single case's verdict as a sample, not a fact.

### Haiku comparison (SPEC §5)

The Week 3 cost/quality comparison is the same command with
`ANSWER_MODEL=claude-haiku-4-5` — same dataset, same judge, same gate. The
per-case table and pass rate print with each run.

Measured on a verified-clean corpus (793 chunks / 14 documents / 0 missing
embeddings, all migrations applied), judge `claude-sonnet-4-5`, all 25 cases
model-judged — no weak-retrieval short-circuits in any run below:

> **Corpus changed since these runs — twice.** [#108](https://github.com/rjwrld/tramitico/issues/108)
> swapped the `rts-requisitos` flyer (1 chunk) for `reglamento-rts` (20 chunks),
> and [#114](https://github.com/rjwrld/tramitico/issues/114) then ingested the
> two CCSS escalas contributivas and the wage decree (`ccss-escala-salud`,
> `ccss-escala-ivm`, `salarios-minimos`). The corpus is now **825 chunks / 17
> documents / 0 missing embeddings**, and the gate's current-corpus number on it
> is the 24/25 recorded above. The rows below are a _Sonnet-vs-Haiku
> comparison_ measured on the older 793-chunk corpus — read them for the model
> gap they show, not as current measurements.

| Answer model                | Date       | Groundedness                                    | Eval wall-clock | Notes                                                                                        |
| --------------------------- | ---------- | ----------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `claude-sonnet-5` (default) | 2026-08-10 | 25/25                                           | ~371s           | gate re-held (≥90%) 2026-08-11 on the amended prompt (#95/#98), ~379s, per-case not captured |
| `claude-haiku-4-5`          | 2026-08-11 | run 1: pass · run 2: **22/25 (88%, gate FAIL)** | ~255s / ~273s   | ~5× cheaper per output token                                                                 |

**Haiku is borderline at the gate.** Two back-to-back runs on the identical
corpus and prompt straddled it: the first cleared ≥90% (per-case table not
captured), the immediate re-run scored 22/25 with three unanimous
`[fail/fail/fail]` verdicts (`inscripcion-hacienda-clientes-extranjero`,
`iva-servicios-extranjero-comprados`, `exportacion-servicios-comprobante`) —
each a real over-claim beyond the cited fragments, not judge noise. This
replaces the 2026-08-06 conclusion ("the judge separates neither model"): on
a clean corpus the gate _does_ see a quality gap, and Sonnet 5 stays the
default on quality grounds, not just inertia. The 2026-08-06 numbers (7
questions short-circuited to the deterministic fallback by a polluted corpus)
should not be quoted.

## Adversarial conflicting-sources case (issue #135)

`src/lib/eval/conflicting-sources.eval.test.ts` is the one case that
cannot live in `dataset.jsonl`. Its fragments are hand-written
(`src/lib/eval/conflicting-sources.ts`) and deliberately contradict each other
on a single figure — two tramos decrees of consecutive years quoting different
exempt amounts. The corpus does not contradict itself, and dataset targets must
be verified against the ingested corpus, so no real question can exercise the
path.

It runs the production answer path from the prompt down (`ANSWER_MODEL` +
`ANSWER_SYSTEM_PROMPT` + `buildUserPrompt`) and asks a **second** judge — not
the groundedness one — the adversarial question: does the answer say the
sources disagree, give both figures, and cite both? The groundedness judge
cannot catch this, since an answer that quietly picked one figure is still
fully supported by its fragments. Rule 4 of the answer prompt is what the case
holds in place; the decision that conflicts are surfaced in answer text rather
than resolved by structured vigencia extraction is #121's.

Blocking, single case, no rate. It needs no database and no embeddings, so it
is gated on `ANTHROPIC_API_KEY` alone and runs at the judge cadence alongside
the groundedness gate:

```sh
ANTHROPIC_API_KEY=<key> \
pnpm vitest run src/lib/eval/conflicting-sources.eval.test.ts
```

Verified 2026-08-13 (answer `claude-sonnet-5`, judge `claude-sonnet-4-5`):
pass — the answer opens with «Las fuentes discrepan…», names each decree with
its own figure and marker, and refers the reader to Hacienda for which one
rules.
