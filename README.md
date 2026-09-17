# Tramitico

[![CI](https://github.com/rjwrld/tramitico/actions/workflows/ci.yml/badge.svg)](https://github.com/rjwrld/tramitico/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

A RAG assistant that answers the tax and social-security questions of people who work for
themselves in Costa Rica, in plain Spanish, with every material claim cited to the official
Hacienda or CCSS document it came from. It retrieves and cites; it never rules. When the
corpus cannot back an answer it says so, and when the question belongs to another institution
it names that institution instead of guessing. The app is in Spanish because its users are;
this README is in English because its second audience reads code. _Tramitico_ is a diminutive
of _trámite_, the Costa Rican word for paperwork.

**Live:** [tramitico.com](https://tramitico.com).

![A Spanish CCSS question becomes a cited answer; clicking a source seal opens the official article in a new tab.](docs/assets/demo.gif)

<sub>Recorded on the live app in an anonymous session. Processing waits and source-page loading are shortened; the answer reveal plays at normal speed.</sub>

## What it does

- **Answers from the source, not from memory.** Every figure, deadline and condition in an
  answer carries a seal that opens the official document and artículo it was taken from. An
  answer with a citation that does not resolve is never shown; the pipeline retries once and
  then declines ([ADR 0011](docs/adr/0011-runtime-citation-invariant.md)).
- **Says no when it should.** A question the corpus does not cover gets an honest abstention.
  A question for another institution, immigration, municipal patentes, INS, gets a decline
  that names the institution and links its page
  ([ADR 0017](docs/adr/0017-other-institutions-are-routed.md)).

  <details>
  <summary>Watch a question routed to Migración</summary>

  ![A passport-renewal question in Spanish is declined and directed to Migración and its official URL.](docs/assets/demo-routed.gif)

  </details>

  <details>
  <summary>Watch an answer abstain when the sources do not cover it</summary>

  ![Asked in Spanish about the IVA rate in 2027, Tramitico says its sources cannot support an answer and directs the user to Hacienda.](docs/assets/demo-abstain.gif)

  </details>

- **Never invents a number.** Figures that no single document states, such as the CCSS
  minimum contribution base, are computed by code from cited inputs, never by the model
  ([ADR 0018](docs/adr/0018-derived-figures-by-code.md)).
- **Remembers the thread.** Follow-up questions are condensed into one standalone question
  before retrieval, so «¿y si facturo desde España?» is searched as the full question it
  implies ([ADR 0012](docs/adr/0012-multi-turn-question-condensation.md)).

## How it answers

![The ask pipeline: chat UI, quota, condense, hybrid retrieval, rerank, answer, citation check, Supabase](docs/assets/ask-pipeline.png)

<sub>Rendered from [`docs/assets/ask-pipeline.architecture.json`](docs/assets/ask-pipeline.architecture.json); every node cites the file and line it describes at a pinned commit.</sub>

One request, left to right: a daily quota check, condensation of the conversation into one
question, hybrid retrieval, a rerank, one model call, a citation check, and persistence.

- **Retrieval is hybrid and asks the question more than once.** The question, a
  corpus-register rewrite of it ([ADR 0019](docs/adr/0019-query-expansion-legs.md)) and, for
  the families that have one, the hand-written steps a complete answer needs
  ([ADR 0020](docs/adr/0020-step-catalogue-legs.md)) each run a vector leg and a lexical leg
  inside one Postgres function. Reciprocal rank fusion merges them into a pool of 40; a
  reranker keeps 8.
- **The answer is checked before it is streamed.** The model writes with numbered markers;
  the server buffers the answer, resolves every marker to a retrieved chunk, and only then
  streams it with the seals attached.
- **Everything that spends is bounded.** The quota is checked before any provider call and
  refunded on any failure that is not the user's
  ([ADR 0013](docs/adr/0013-disconnect-refunds-and-internal-deadline.md)). The pipeline
  carries its own deadline so the platform never kills it mid-answer.

Models: `claude-sonnet-5` writes the answer, `claude-haiku-4-5` condenses and expands,
Voyage `voyage-3` embeds and `rerank-2.5-lite` reranks. Postgres with pgvector holds the
corpus, the question history and the quota, all behind row-level security.

## The numbers

The corpus is 23 official documents in 876 chunks. The eval set is 73 hand-written cases,
each with the artículo the answer must cite and, for the 40 that carry them, the claims a
complete answer must make. Every case is run through the production pipeline and judged by
a second model at temperature 0. The table carries the three full runs since the pipeline
was frozen: the closing run of 2026-09-11
([`eval/runs/2026-09-11-closing/`](eval/runs/2026-09-11-closing/)), the record run of
2026-09-15 that measured the last knob and left it where it was
([`eval/runs/2026-09-15-top-k/`](eval/runs/2026-09-15-top-k/)), and the first run against
the deployed stack on 2026-09-16, executed by the eval workflow on GitHub Actions
([`eval/runs/2026-09-16-production/`](eval/runs/2026-09-16-production/)).

| Gate                                            | Baseline (2026-09-05) | Closing run (2026-09-11) | Record (2026-09-15) | Production (2026-09-16) | Threshold |
| ----------------------------------------------- | --------------------- | ------------------------ | ------------------- | ----------------------- | --------- |
| Retrieval hit-rate (cited artículo in top 8)    | 63/73                 | 70/73                    | 72/73               | **70/73**               | ≥ 0.92    |
| Groundedness (answer supported by its chunks)   | 70/73                 | 70/73                    | 69/73               | **69/73**               | ≥ 0.94    |
| Adequacy, Tier 2 (every required claim present) | 9/13                  | 12/13                    | 10/13               | **12/13**               | ≥ 0.84    |
| Abstention (declines when it should)            | 4/7                   | 9/9                      | 9/9                 | **8/9**                 | ≥ 0.90    |
| Adequacy, Tier 1 (every required claim present) | —                     | 5/27                     | 3/27                | **6/27**                | 27/27     |
| Blocking cases that fail groundedness           | —                     | 2                        | 3                   | **2**                   | 0         |
| Answers with an unresolved citation marker      | —                     | 0                        | 2                   | **1**                   | 0         |

The last three rows are the per-case gates added after the baseline; the closing run's
values are read from its transcripts. Read the three dated columns as a band, not a trend:
the pipeline barely changed between them, and Tier 1 moved by three cases, hit-rate and
groundedness by one or two. A single reading is a point inside that band.

Tier 1, the 27 cases the product promise depends on, is fully adequate in 6 of 27 on the
production run: the answers are cited and grounded but miss required steps or figures. That
is the open work ([#352](https://github.com/rjwrld/tramitico/issues/352), with
[#311](https://github.com/rjwrld/tramitico/issues/311) measured inside its next run), and it
is recorded as an accepted, dated risk rather than hidden by an aggregate. A full run costs
about US$6 in provider spend.

How the gates are defined, how thresholds ratchet and never lower, and every run since the
first are in [`eval/README.md`](eval/README.md).

## How it was built

By one person and a set of coding agents, in about eight weeks: a wayfinder map of the
domain first, then a grilling session per decision, then GitHub issues that link the spec
section they implement, then agents working in parallel worktrees, then review, then the eval
gates above as the release bar. Each stage caught something the previous one had let through.
The full account, including what was lost and what the gates failed to say, is in
[`docs/how-it-was-built.md`](docs/how-it-was-built.md).

## Limitations

- Four eval gates are red on the production run, and were red on the two runs before it.
  They are the open work in [#352](https://github.com/rjwrld/tramitico/issues/352):
  - Tier 1 adequacy is 6 of 27. Answers in those families are cited and grounded but
    incomplete.
  - Two Tier 1 answers fail groundedness, both on IVA for services sold abroad, both wrong
    statements rather than missing ones
    ([#324](https://github.com/rjwrld/tramitico/issues/324)). One of them has failed on every
    run since the per-case gate was added.
  - One of nine abstention cases answers: asked for a personalised calculation, the model
    gives the method and the tables instead of declining.
  - One answer carried a citation marker that points at no source. The runtime contract
    should refuse it before it ships; the invariant caught it at eval time.
- No one outside the author has used it, and the author wrote the eval set. Peer questions
  are the next dataset.
- The corpus has annual obligations, tramos, minimum wage, contribution scales, that a
  freshness policy describes ([ADR 0016](docs/adr/0016-source-freshness-policy.md)) and
  nothing automates yet.
- Tramitico is not legal or tax advice. It cites the general rule and the conditions that
  change it; the decision is the reader's, or their accountant's.

## Run it locally

```bash
pnpm install
pnpm test:unit     # no database, no API keys — the CI gate
pnpm build
```

Those pass from a clean clone. Running the app or the database-backed lanes needs a local
Supabase stack and provider keys; [CONTRIBUTING.md](CONTRIBUTING.md) has the steps and the
five test lanes, split by what each one needs.

## Docs

| Document                                             | What it is                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| [SPEC.md](SPEC.md)                                   | the build contract: corpus, retrieval, answer contract, gates |
| [DESIGN.md](DESIGN.md)                               | the visual contract, written before the first component       |
| [PRODUCT.md](PRODUCT.md)                             | who it is for and what it is not                              |
| [BRIEF.md](BRIEF.md)                                 | the original scope; its out-of-scope list is binding          |
| [docs/adr/](docs/adr/README.md)                      | the decisions that overturned a default, numbered and dated   |
| [docs/how-it-was-built.md](docs/how-it-was-built.md) | the workflow and what each stage caught                       |
| [docs/runbook.md](docs/runbook.md)                   | what to watch in production and when to roll back             |
| [eval/README.md](eval/README.md)                     | every eval run, and the rules for reading one                 |
| [CLAUDE.md](CLAUDE.md)                               | the working map for coding agents                             |

## License

The application code in this repository is licensed under the
[Apache License 2.0](LICENSE). Copyright 2026 Ronald Josue Calderon Barrantes.

That license covers the software only. It does not cover:

- **The Tramitico name, logo and visual identity.** They are not granted for reuse by the
  software license. Forks are welcome, but not under the Tramitico name or seal.
- **Official documents and third-party content.** The Costa Rican legal texts and datasets
  the corpus is built from, and the fixtures committed under `docs/corpus-samples/` and
  `corpus/cabys-dev.json`, are public documents of their issuing institutions. Their
  sources and status are listed in
  [docs/corpus-samples/README.md](docs/corpus-samples/README.md).
- **Vendored fonts.** Source Serif 4 is under the SIL Open Font License 1.1
  (`src/app/fonts/SourceSerif4-LICENSE.txt`).

The hosted service at tramitico.com, its data and its credentials are separate from this
codebase; see [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

---

Made by [Josue Calderon](https://josuecalderon.com) · [GitHub](https://github.com/rjwrld) ·
[LinkedIn](https://www.linkedin.com/in/rjwrld/)
