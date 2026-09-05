# Eval dataset (SPEC §9, issues #25/#26)

`dataset.jsonl` holds the hand-written eval questions — Appendix A's nine Tier 1
seeds (#264), the corpus-derived regression suite, and since #261 part B the
48-case **held-out set** written from demand evidence — each with the source
docs/artículos a correct retrieval must surface. SPEC §9's 25–45 band now
describes the corpus-derived half only; the held-out set has a composition
instead of a size (see below). One JSON object per line:

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
- `seed` — provenance: `appendix-a:<n>` (SPEC Appendix A), `demand:<family>`,
  `held-out:<family>` (#261 part B) or `corpus`.
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

## Coverage contract: tiers, required claims, abstention (issues #130, #261)

`expected` is a claim about **retrieval** — did the right artículo reach the
model? It says nothing about what the answer then did with it. Since #261 a
case also carries its place in the coverage contract of the #254 map:

```json
{
  "id": "ccss-cuanto-pago",
  "seed": "held-out",
  "question": "¿Cuánto es lo mínimo que se paga a la Caja como independiente?",
  "tier": 1,
  "family": "T1-F",
  "expected": [{ "docKey": "ccss-escala-salud" }],
  "requiredClaims": [
    {
      "claim": "la cuota del afiliado es 6,71 %",
      "literal": ["6,71 %", "6,71%"]
    },
    "la cuota se calcula sobre el ingreso de referencia declarado"
  ],
  "requiredSteps": ["dónde se declara y actualiza el ingreso de referencia"],
  "freshness": ["salarios-minimos"],
  "notes": "…"
}
```

- `tier` — `1` (the published beta promise), `2` (measured, not advertised) or
  `"abstain"`. Defaults to `2`, which is what every pre-#261 case is.
- `family` — `T1-A`…`T1-I`, the nine Tier 1 families of the coverage contract.
  **Required on tier 1**, and so are `requiredClaims`; `blocking` defaults to
  `true` there and may not be set to `false`. The parser refuses a tier 1 case
  that does not carry what makes it checkable, so the contract cannot be
  claimed without the evidence for it.
- `requiredClaims` — at most five short, verifiable things the answer must
  say. A bare string is judged; the object form with `literal` is **not
  judged** — it lists the accepted spellings of a figure or date, one of which
  must appear verbatim _and_ carry a `[n]` before its sentence ends. A number
  is either printed with a source beside it or it is not, and that needs a
  regex, not a model.
- `requiredSteps` — for a procedural case, the next steps the answer owes the
  reader (the portal, the form, the deadline).
- `abstainIf` — the condition that obliges a decline. **Required on an
  abstention case**, where it is what the abstention judge checks; optional
  elsewhere, where it documents the edge the case does not cover.
- `routeTo` — the institution or professional an abstention must name. Also
  **required on an abstention case**: the verdict has two halves, and without a
  named destination there is nothing to check the routing against.
- `freshness` — docKeys whose figures the answer depends on: the ones a decree
  cycle invalidates.
- `heldOut` — membership in the held-out set of #261 part B, and `variant` —
  which of `literal` / `coloquial` / `seguimiento` a Tier 1 case is. Both are
  in the schema for the same reason: a discipline nobody can enumerate is a
  discipline nobody keeps. See the next section.

An abstention case is the one kind with **no `expected` targets** — the point
is that no correct source exists — so the retrieval and groundedness lanes skip
it (`retrievalCases()`), and it is judged on whether it declined and routed.

### The adequacy gate (#130)

`src/lib/eval/adequacy.ts` is the second question the eval asks, and it is
deliberately independent of groundedness. Groundedness passes an answer that is
supported and incomplete — "sí, debe asegurarse en la CCSS", never saying what
the cuota is. Adequacy asks whether the answer contained what the reader came
for. Three checks, in ascending order of trust required:

1. `checkLiterals` — regex, no model, for every claim with `literal`.
2. `judgeAdequacy` — the pinned judge at temperature 0, one requirement at a
   time, for the prose claims and steps; same fail → re-judge → majority
   orchestration as the groundedness judge, so both gates behave the same way
   under flakiness.
3. `judgeAbstention` — "did it decline **and** route?", paired with
   `figureMentions`, the deterministic check that a refusal printed no invented
   colón amount or percentage.

The rule that gives the gate teeth is in none of the three: **a weak-retrieval
decline on a case that declares required claims is an adequacy failure**
(`declineAdequacy`). Groundedness passes that decline — it claims nothing — so
without the rule the honest fallback would be a way to score full marks on a
question the product promised to answer.

Thresholds: **tier 1 is per-case blocking** (100 %, no rate — a strong average
must never hide a red Tier 1 case), tier 2 is an aggregate
`ADEQUACY_TIER2_GATE` of 0.8. Both run inside `groundedness.eval.test.ts`,
which already has the answers, so the gate costs judge calls rather than a
second pass of the whole pipeline.

`src/lib/eval/adequacy.eval.test.ts` is the fixture that pins the behavior:
a hand-written CCSS answer, supported by its fragments and missing the rate,
**passes groundedness and fails adequacy** — with a complete version of the
same answer as the positive control, so a judge stuck on one verdict is
visible. It needs no database and no embeddings:

```sh
ANTHROPIC_API_KEY=<key> \
pnpm vitest run src/lib/eval/adequacy.eval.test.ts
```

### The abstention lane (#261)

`src/lib/eval/abstention.eval.test.ts` runs the `"abstain"` cases through the
same production path and asks the binary question: did it decline, **and** did
it name where to go? Both routes are measured — the deterministic
weak-retrieval fallback and, when a question's vocabulary retrieves well
anyway, rule 6 of the answer prompt. Gate: correct abstention ≥ 90 %
(`ABSTENTION_GATE`), and **zero invented figures** (`figureMentions`), since an
answer with no fragments behind it that prints a colón amount or a percentage
made it up.

The nine held-out abstention cases landed with #261 part B, so the set is no
longer empty; the assertion that it is non-empty stays, because a check
asserting nothing is worse than a red one (#129).

### The held-out set (#261 part B, #254 §A5/§B8)

`expected` proves retrieval and `requiredClaims` proves adequacy, but both are
answers to questions **the author wrote after reading the corpus**. A suite
built that way measures whether the pipeline can find what its author already
knew was there. The held-out set is the other half: 48 cases written from the
demand evidence of #254 Part B — the words people actually type, «meterme en
Hacienda», «desde cuánta plata», «trabajitos por mi cuenta» — with targets
verified afterwards, and only for satisfiability.

`heldOut: true` marks them. The composition is asserted in
`src/lib/eval/held-out.test.ts` — the Tier 1 grid exactly, the other two blocks
as floors:

| Block   | Count | What it is                                                                   |
| ------- | ----- | ---------------------------------------------------------------------------- |
| Tier 1  | 27    | the nine families × `literal`, `coloquial`, `seguimiento` — exactly one each |
| Tier 2  | 12    | the adjacent questions of §B8, same evidence standard, no promise            |
| Abstain | 9     | out of scope, false premise, nonexistent figure, other institution           |

The three variants are the coverage claim itself. A family measured only in
its own vocabulary has not been shown to survive a reader's: `literal` is the
family's own question, `coloquial` the same need in demand vocabulary, and
`seguimiento` a follow-up that carries `history`, so it fails on condensation
(#132) rather than on retrieval. The Tier 1 grid is asserted as an **exact**
set while Tier 2 and abstention are floors, and the asymmetry is the point: a
further Tier 2 topic or abstention case only widens what is measured, but a
second variant of one family would quietly make the per-case blocking rule
mean something different for that family than for the other eight.

Two rules the set follows that are not visible in a case:

- **Held out means held out.** Nobody consults these cases while tuning
  retrieval, chunking or the prompt, until the #267 baseline is published.
  That is why the flag exists at all: a set nobody can enumerate is a set
  nobody can hold out.
- **A claim the corpus cannot support is not a claim.** Where §B4 asks for
  something the ingested excerpt does not carry — the crédito-fiscal effect of
  a tiquete, whether a pending debt blocks desinscripción — the edge is
  written into `abstainIf` instead of into `requiredClaims`. `abstainIf` on a
  Tier 1 case documents what the case does _not_ cover; inventing a required
  claim nothing can satisfy would just make the gate red forever and teach
  nobody anything.

Seven of the 27 Tier 1 cases were already in the file: the corpus issues that
unblocked this one (#258, #259, #260) added them from the same §B8 list, one
of them saying so in as many words. #261 part B promoted those in place rather
than writing near-duplicates, since a second copy of the same question would
have doubled the paid eval spend to measure the same thing twice:

| Case                                 | Family / variant | Added by |
| ------------------------------------ | ---------------- | -------- |
| `ccss-obligacion-ingreso-bajo`       | T1-B literal     | #258     |
| `ccss-cese-actividad`                | T1-H seguimiento | #258     |
| `ccss-pedir-prescripcion-cuotas`     | T1-G coloquial   | #260     |
| `ccss-ventana-prescripcion-24-meses` | T1-G seguimiento | #260     |
| `desinscripcion-dejar-actividad`     | T1-H literal     | #264     |
| `multa-iva-no-declarado`             | T1-I literal     | #259     |
| `inscripcion-tardia-sancion`         | T1-I coloquial   | #259     |

The other 41 cases are new here. The corpus-vocabulary cases that ask the same
questions in the corpus's own words (`iva-clientes-fuera-cr`,
`ccss-asalariado-y-freelance`, `renta-tramos-2026` and the rest) stay exactly
where they are: they are the retrieval regression suite, and retiring them to
save eval spend would trade measured coverage for a smaller bill.

One §B8 proposal did not survive verification. The Tier 2 «D-270» case has no
official source in the corpus, and a case whose target no chunk can satisfy
fails the satisfiability lane by construction — so that slot went to
«¿Cómo saco la constancia de que estoy al día con Hacienda?», the same §B4
Tier 2 need (TRIBU-CR situación tributaria) with a source behind it.

Two abstention cases are expected to expose a real gap rather than pass:
«¿Cuánto debería cobrar por hora…?» and «¿Qué contador me recomienda?» match
no institution keyword in `classifyRouting`, so today they take the default
decline and route to Hacienda and the CCSS — which is not where either reader
should be sent. Their `routeTo` names the honest destination anyway. Writing
the destination the product currently produces would have made the case pass
by describing the bug.

### The citation invariant, at eval time (#168)

The harness used to bypass `validateCitations` entirely: an answer citing
nothing — which `/api/ask` retries and then refuses to ship (#131) — could
score a groundedness pass here. `groundedness.eval.test.ts` now runs the same
runtime check over every generated answer and prints the violations. It is
**asserted on blocking cases** and reported for the rest: #254 §A3 sets no
recovery-rate threshold until #195 measures a baseline, and a number nobody has
measured is not a gate.

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
