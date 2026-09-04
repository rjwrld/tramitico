# Contadito — Project Brief _(working name — will be renamed)_

> Self-contained brief for planning and stress-testing this project before any code is written.
> Status: **idea — nothing built.** Author: Josué Calderón. Written July 2026.

---

## 1. The idea

A **RAG assistant for Costa Rican independent developers** that answers tax & trámite questions —
"¿cómo me inscribo como autónomo ante Hacienda?", "¿cuándo y cuánto pago a la CCSS?", "¿cobro IVA
por servicios de desarrollo al exterior?" — with answers grounded in, and **cited to, the official
Hacienda / CCSS / MTSS documents** they came from.

The answers to these questions exist, but they're scattered across dense official PDFs and
government pages that don't talk to each other. Contadito ingests a curated slice of those
sources and answers in plain Spanish. The core design stance: **it doesn't rule, it retrieves and
cites.** Every answer shows the exact document + section it used, plus a "not legal advice —
verify with Hacienda" disclaimer. High-stakes content is handled by making provenance the
feature, not by pretending the model is an authority.

**Target user:** me and my peers — CR freelance/independent developers. A named, reachable user
group, which means real feedback and possibly real traction.

> **Audience amendment (2026-09-04, [#265](https://github.com/rjwrld/tramitico/issues/265)):**
> developers remain the first reachable cohort, but the product audience is natural persons with
> independent lucrative activity in Costa Rica. Salaried people with side activity, people
> starting or closing an activity, and platform earners are a measured expansion audience. The
> boundary follows a person's legal circumstances, not profession or nationality.

## 2. Why this project (the portfolio logic)

This is planned as the **portfolio flagship**. It exists to close two specific gaps at once:

1. **A public app with a real backend + database + auth.** (The current featured project is
   frontend-only by design.)
2. **A public, nameable anchor for the AI claim.** (Prior LLM production work is on a private
   client project that can't be shown or named.)

Why RAG specifically — and why _this_ corpus:

- The corpus (official government docs) is **big and cross-referenced enough that retrieval is
  technically justified**. A RAG over a thin FAQ is a tutorial project wearing a costume; this
  one actually needs the retrieval layer.
- The corpus is **self-owned public data** — no third-party API, no client dependency, no
  permission to chase. The #1 risk of project stalls is removed at the design level.
- High-stakes content becomes a **responsible-AI showcase**: citations, guardrails, and an eval
  harness are the differentiators, not bolted-on extras.

## 3. What makes it not-a-tutorial

1. **Citation-first answers.** Every response renders the retrieved official chunks it used
   (source doc + section). Groundedness is visible to the user, not claimed in a README.
2. **An eval harness.** A curated Q&A eval set plus an automated groundedness check
   (LLM-as-judge: "is this answer supported by the retrieved chunks?"). Junior portfolios almost
   never show that the author _evaluates_ their RAG; this one does, in CI.
3. **Visible engineering process.** ADRs for the real decisions (chunking strategy, embedding
   model, citation format), a CONTEXT.md domain glossary, and a `how-it-was-built.md` documenting
   the parallel agentic-session workflow — making "develops with agentic AI tooling" provable.

## 4. Planned stack

| Layer          | Choice                                                       | Why                                                            |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| App + API      | **Next.js (App Router)**, route handlers as the REST backend | One deployable; UI + backend in the stack I actually use       |
| DB / retrieval | **Supabase Postgres + pgvector**                             | Real DB + vector search without a second vendor                |
| Auth           | **Supabase Auth + RLS**                                      | Real auth in a public app — a gap this project exists to close |
| LLM            | **Claude Sonnet** via **Vercel AI SDK**                      | Reuses prior production LLM-integration experience             |
| Embeddings     | **Voyage AI** (free tier) or OpenAI `text-embedding-3-small` | Cheap, good-enough, swappable                                  |
| Quality        | **Vitest · Playwright · GitHub Actions CI · Vercel**         | Same 7-step pipeline discipline as the rest of the portfolio   |

**Recorded tradeoff:** a separate Express API would strengthen the literal "Node/Express backend"
keyword, but adds a second deploy and repo complexity. Route handlers ARE the REST backend.
Revisit only if target job posts demand explicit FE/BE separation.

## 5. MVP scope

**IN:**

- Curated corpus: **~8–15 key official documents** (ES first), chosen by highest-pain questions
- Ingestion pipeline: fetch → chunk → embed → upsert to pgvector (re-runnable when sources change)
- Retrieval + answer assembly with **inline citations** (doc + section)
- Chat UI showing cited sources, with the legal disclaimer
- Supabase auth + light per-user history
- Eval set + groundedness check running in CI
- Tests (Vitest + Playwright), 7-step CI, deployed on Vercel
- README + ADRs + `how-it-was-built.md`

**OUT (binding — scope creep is the #2 risk):**

- Full tax-law coverage · payments/subscriptions · multi-tenant · realtime · English translation
  (stretch goal at most) · fine-tuning · MCP server (phase-2, below) · societies/companies ·
  employers/patronos · customs/imports · municipal permits/patentes · INS coverage

> **Routing annotation (2026-09-04, [#265](https://github.com/rjwrld/tramitico/issues/265)):**
> those additional institutions and legal categories are routed, not covered: Tramitico declines
> and points to the appropriate official institution without adding their rules to the corpus.

**Estimated effort:** ~3 focused weeks.
Wk 1 — foundation: scaffold, auth, schema + pgvector, corpus curation, ingestion, basic retrieval.
Wk 2 — RAG core: retrieval tuning, citation assembly, chat UI, guardrails, unit tests.
Wk 3 — harden + ship: e2e, CI, eval harness, docs, deploy, buffer.

## 6. Phase-2 — the MCP server

Once retrieval works, wrap it as an **MCP server** exposing a `search_cr_freelance_rules` tool,
usable from Claude Desktop or any MCP client. Estimated a few days. This is the milestone that
upgrades the public skill claim from _"integrates LLMs"_ to _"builds agentic tools / MCP
servers"_ — it must actually ship before that claim is ever made.

## 7. Risks & mitigations

| Risk                                         | Mitigation                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Wrong answers about taxes (liability, trust) | Citation-first design + disclaimer + eval set; the app retrieves official text, it never "rules" |
| Official sources change                      | Re-runnable ingestion script; corpus is versioned                                                |
| Scope creep kills the ship date              | The OUT-list is binding; MVP is the contract                                                     |
| Cost                                         | Free tiers (Supabase, Voyage, Vercel), small corpus, cached embeddings                           |
| Licensing                                    | Official public documents only; attribute and link out                                           |
| Accuracy of Spanish legal terminology        | Corpus is ES-native; UI copy reviewed by the author (native speaker)                             |

## 8. Naming

"Contadito" (contador + -ito) is a placeholder. Criteria for the real name:

- Spanish-first, pronounceable in English
- Domain or `*.vercel.app` available
- Does **not** imply it gives legal or accounting advice
- Survives being said out loud in an interview

## 9. Open questions (grill these)

- [ ] Corpus slice: _which_ 8–15 documents? What are the actual top-10 highest-pain questions?
- [ ] Is chat the right UI, or is a searchable Q&A / guide format more honest to the use case?
- [ ] Auth-gate everything, or public read + auth only for history? (Friction vs. showing auth off)
- [ ] Chunking strategy for legal/administrative text (articles? sections? sliding window?)
- [ ] How does the eval set get built — hand-written from the corpus, or collected from real peers?
- [ ] What does "done enough to feature publicly" mean — the bar that triggers CV/LinkedIn updates?
- [ ] ES-only MVP confirmed? (Sources are ES; EN is a stretch goal)
- [ ] The real name.
