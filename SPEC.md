# Tramitico — Build-Ready Spec

> Destination artifact of the [wayfinder map](https://github.com/rjwrld/tramitico/issues/1).
> Consolidates every decision made during planning (July 2026). The map's closed tickets hold
> the full reasoning; this document holds the answers. [BRIEF.md](BRIEF.md) holds the original
> motivation and remains the scope contract (§5 OUT-list is binding).
>
> **Status: building.** Week 1 (foundation) landed 2026-07-21 — PRs [#15](https://github.com/rjwrld/tramitico/pull/15), [#16](https://github.com/rjwrld/tramitico/pull/16).
> Build work is tracked as GitHub issues (label `build`); deviations discovered during the build
> are recorded as ADRs in [docs/adr/](docs/adr/), and this spec links them where they amend it.
> Every build issue opens with a **Spec:** line deep-linking its governing sections here; shared
> contracts (function signatures, API shapes) are owned by one issue and linked by consumers.

## 1. What ships

A RAG assistant for Costa Rican independent developers answering tax & trámite questions in
plain Spanish, with every answer **cited to the official document and artículo** it came from.
It retrieves and cites; it never rules. Chat UI seeded with the top-10 pain questions, public
ask with rate limits, sign-in for history, groundedness eval in CI, deployed on Vercel.

## 2. Locked decisions (index)

| Decision | Resolution                                                                                                                                                                                   | Ticket                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Name     | **Tramitico** (tramitico.com purchase in progress)                                                                                                                                           | [#8](https://github.com/rjwrld/tramitico/issues/8)   |
| Corpus   | ~14 official docs, Hacienda + CCSS; MTSS gap stated as fact                                                                                                                                  | [#13](https://github.com/rjwrld/tramitico/issues/13) |
| Chunking | Por-artículo + context header; hybrid retrieval                                                                                                                                              | [#4](https://github.com/rjwrld/tramitico/issues/4)   |
| UI       | Chat + top-10 pain questions as one-click prompts                                                                                                                                            | [#9](https://github.com/rjwrld/tramitico/issues/9)   |
| Auth     | Public ask (rate-limited); sign-in → history + higher limits                                                                                                                                 | [#10](https://github.com/rjwrld/tramitico/issues/10) |
| Language | ES corpus/answers **and app chrome** ([ADR 0013](docs/adr/0013-spanish-chrome.md)); EN README, demo                                                                                          | [#11](https://github.com/rjwrld/tramitico/issues/11) |
| Eval set | ~20–30 hand-written Q&As; peer questions post-launch                                                                                                                                         | [#12](https://github.com/rjwrld/tramitico/issues/12) |
| Done bar | §5 IN-list + green CI w/ eval gate + deployed + docs                                                                                                                                         | [#14](https://github.com/rjwrld/tramitico/issues/14) |
| Stack    | Next.js App Router · Supabase (Postgres/pgvector/Auth) · Claude Sonnet via Vercel AI SDK · **shadcn/ui + AI Elements** · Vitest/Playwright/GHA/Vercel — re-confirmed layer-by-layer post-map | BRIEF §4                                             |
| Branding | **DESIGN.md authored before build** (impeccable-driven): palette as shadcn CSS vars, type, tone, citation-chip look                                                                          | spec discussion                                      |

## 3. Corpus

The 14-doc list from [corpus-viability research §1](docs/research/corpus-viability.md) — renta +
IVA laws/reglamentos, Tramos 2026, export-services resolution, comprobantes electrónicos +
v4.4 spec, CABYS, CCSS BMC decree, Ley 10.363, TRIBU-CR guides, RTS reglamento. URLs live in
that table; the ingestion manifest (`corpus/manifest.json`) is the build-time source of truth,
seeded from it.

Amended by [#108](https://github.com/rjwrld/tramitico/issues/108): the RTS entry is the
**Reglamento del Régimen de Tributación Simplificada** (Decreto Ejecutivo 43881-H, SINALEVI),
replacing the Hacienda «requisitos» flyer one-for-one — the count stays 14. The flyer carried
only thresholds the decree states itself, and its PDF extracted as column-interleaved layout
noise; the decree is the only source that carries the closed eligible-activity list.

Amended by [#114](https://github.com/rjwrld/tramitico/issues/114): **three docs added, count 14 →
17** — `ccss-escala-salud`, `ccss-escala-ivm` and `salarios-minimos`. The CCSS BMC decree
(`ccss-bmc`) carries no contribution rates at all: SINALEVI publishes CCSS escala acuerdos as
raster images, so the escala table never survived into text. The rates exist as text only in the
CCSS **actas de Junta Directiva** — the Salud escala in acta 8999 and the vigente 2026 IVM escala
in the ficha técnica annexed to acta 9570 — and the escalas are denominated in _salarios mínimos_,
so the MTSS wage decree is what turns them into the colón BMC figures. `ccss-bmc` is retained for
the adjustment mechanism (Acuerdos Segundo–Cuarto), never for a figure.

Amended by [#176](https://github.com/rjwrld/tramitico/issues/176): **two docs added, count 17 →
19** — `reglamento-iva-bienes-capital` and `reglamento-iva-retencion-tarjetas`. Both are single
artículos of the IVA reglamento, ingested from the Gaceta alcance that published them because the
SINALEVI ficha renders their formulas as images and drops them
([#150](https://github.com/rjwrld/tramitico/issues/150)). They sit _beside_ `reglamento-iva`, not
in place of it: no single Gaceta carries the reglamento as it now reads, so the ficha remains the
only source for the other 72 artículos.

Amended by [#268](https://github.com/rjwrld/tramitico/issues/268): `ley-renta` (Ley 7092,
SINALEVI ficha 10969) replaces `ley-9635` one-for-one, so the count stays **19**. The consolidated
law includes the complete vigente renta text, Ley 10818's optional 25% deduction for physical
persons providing services, and the 2026 figures. `ley-9635` is retired rather than trimmed: its
Título I duplicated `ley-iva`, its Título II elided unchanged provisions, and its remaining titles
were out-of-scope retrieval noise. `ley-renta` sits beside `reglamento-renta`; the former owns the
substantive tax rules and the latter their application.

Amended by [#258](https://github.com/rjwrld/tramitico/issues/258): **two docs added, count 19 →
21** — `ccss-faq`, the official CCSS question/modal page filtered to Cobros, Seguro voluntario
and Trabajador Independiente, and `ccss-reglamento-ti`, the vigente SINALEVI regulation for
independent-worker affiliation and contribution. The FAQ supplies the procedural text absent
from the normative corpus; rates continue to come from the CCSS actas, not its image table.

Fetch strategy (validated in [#3](https://github.com/rjwrld/tramitico/issues/3)):

- **SINALEVI (laws/reglamentos):** 3 calls, all `_BuscarVersionNorma`/`_CargarTextoCompleto` —
  the shell page's version count is always 0; the real count comes from the ficha card ("1 de M").
  Vigente id resolved explicitly (redirect default lands on version 1). Browser User-Agent
  required. Old SCIJ `nValor2` = `idFichaNorma`. Incomplete TLS chain handled by vendoring the
  GlobalSign intermediate — verification stays on. **Amended by [ADR 0001](docs/adr/0001-sinalevi-fetch-recipe.md).**
- **hacienda.go.cr PDFs:** WAF fingerprints the TLS stack — fetch via **Playwright** (or
  curl-impersonate). Plain fetch/curl will never pass.
- **Public PDFs (CCSS actas, Imprenta Nacional alcances):** no WAF — a browser User-Agent over
  plain fetch suffices (`kind: "pdf"`). Three shapes the manifest declares: `member` pulls the PDF
  out of a sesión's anexos zip, `pages` limits extraction to the norma's own pages so a
  170-page acta or a 420-page alcance doesn't bury it, and `excerpt` narrows further to one
  artículo by line markers, for a page range that still carries superseded neighbours
  ([#176](https://github.com/rjwrld/tramitico/issues/176)). Neither has artículo structure of its own —
  every article-shaped string is a quotation — so they set `chunking.articulo` to the acta artículo
  the acuerdo was adopted under, which is the honest citable unit ([#114](https://github.com/rjwrld/tramitico/issues/114)).
- **Official HTML FAQs:** plain fetch with the shared browser User-Agent, then an explicit
  manifest-selected extractor for that page shape. CCSS question rows pair visible headings with
  Bootstrap modal bodies; a relevant-question floor and cached count delta make redesigns loud
  ([ADR 0014](docs/adr/0014-html-faq-question-chunks.md)).
- **CABYS:** reference data, not prose — ingest a **curated subset of developer-relevant codes**
  as a structured mini-doc (curated during Week 1 ingestion); full-catalog search is out of scope.
- Numeric figures (brackets, BMC) come **only from primary decrees** — aggregators disagreed.
- Every doc records `effective_date` + `fetched_at`; annual decree churn (tramos, BMC) is covered
  by re-running ingestion — **quarterly re-crawl** is the maintenance contract, automated as
  `.github/workflows/recrawl.yml` ([ADR 0010](docs/adr/0010-cli-ingestion-authoritative.md)).

## 4. Ingestion & chunking

Pipeline (re-runnable, idempotent per doc+version): fetch → clean → chunk → embed → upsert.

Chunking rules ([#4](https://github.com/rjwrld/tramitico/issues/4), prototype on
[`prototype/chunking`](https://github.com/rjwrld/tramitico/tree/prototype/chunking/prototype/chunking)):

1. **Unit: one chunk per artículo/transitorio.** Each chunk text is prepended with a context
   header: `[Doc — Título > Capítulo > Sección > Artículo N]`.
2. **No overlap between artículos.** Artículos >~1 000 words sub-split into parts with ~100-word
   overlap; every part keeps the artículo label.
3. **Cleaning pass (mandatory):** strip SINALEVI nav chrome (`Usted está en la última versión…`,
   `Ficha Artículo N`, version pager) and mso/Word markup. Title blocks become doc metadata,
   never retrievable chunks. Preamble/considerandos → one chunk tagged `preambulo`.
4. **Unstructured PDFs** (tramos decree): whole-doc chunk; window only if long.
5. **Structured FAQs:** one question/modal pair per chunk; the visible question is its citation
   label and the category is its path. These chunks are prepared by the declared HTML extractor
   and join the shared embed/persist stage ([ADR 0014](docs/adr/0014-html-faq-question-chunks.md)).

Chunk identity and boundary detection were refined against the live corpus (repeated artículo
numbers in consolidated texts; quoted-reform false boundaries) — **[ADR 0002](docs/adr/0002-chunk-identity.md)**.

### Schema (Supabase)

```sql
documents (
  id uuid pk, doc_key text unique,        -- 'reglamento-iva'
  title text, norma text,                 -- 'Decreto Ejecutivo 41779'
  source jsonb,                           -- {kind:'sinalevi', idFichaNorma, idVersionNorma} | {kind:'html', extractor, url} | {kind:'url', url}
  effective_date date, fetched_at timestamptz
)
chunks (
  id uuid pk, document_id fk,
  articulo text,                          -- 'Artículo 11' | 'Transitorio II' | 'Preámbulo'
  path text[],                            -- ['CAPÍTULO IV']
  part int default 0,
  content text,
  embedding vector(...),                  -- dim per embedding ADR
  tsv tsvector generated always as (to_tsvector('spanish', content)) stored
)
profiles / questions (user_id, question, answer, citations jsonb,
                     condensed_question text,                                  -- #132: the standalone form, NULL if none
                     created_at)                                               -- history, RLS per user
rate_limits (subject text pk, window_start timestamptz, count int)             -- see §7
```

## 5. Retrieval & answer assembly

- **Hybrid retrieval:** vector search (pgvector, cosine) **fused with** lexical search
  (Postgres FTS, `spanish` config) via reciprocal rank fusion. The prototype proved lexical-only
  misses vocabulary gaps ("clientes fuera de Costa Rica" vs "exportación de servicios"), while
  exact-term queries (tramos, CCSS, CABYS codes) reward the lexical leg. Top-k ≈ 8 fused → answer.
  The lexical leg's tsquery semantics (strict AND with a conditional OR fallback) —
  **[ADR 0005](docs/adr/0005-lexical-and-or-fallback.md)**.
- **Embedding model:** Voyage vs OpenAI `text-embedding-3-small` — **ADR during Week 2**,
  benchmarked on the eval set; the exportación vocabulary-gap question is the canary.
- **Multi-turn via condensation (#132, amends this section):** the pipeline below assembles an
  answer from **one standalone question**. When a request carries the bounded window of
  preceding turns the chat client now sends, a small model call rewrites the follow-up and that
  window into a single standalone Spanish question, and _that_ is what retrieval, rerank, the
  answer prompt and the citation invariant see — all unchanged, all still reasoning about one
  question. First turns skip the call entirely; a condensation that fails or times out falls
  back to the literal question, so multi-turn can degrade an answer and can never fail an ask.
  History stores what the reader typed, with the rewrite in `condensed_question` beside it —
  **[ADR 0012](docs/adr/0012-multi-turn-question-condensation.md)**.
- **Answer assembly:** Claude **Sonnet by default, model as env var** — Week 3 runs Haiku 4.5
  through the same groundedness gate as a cost/quality comparison (portfolio material either way).
  Via Vercel AI SDK, streaming. System prompt constrains
  answers to retrieved chunks; when retrieval is empty/weak, the answer says so and links the
  agency instead of guessing. MTSS questions get the encoded fact: the Labor Code mostly does
  not apply to independents.
- **Citations:** every answer renders the chunks used as `Documento · Artículo` chips linking to
  the official source URL, each captioned with the date the corpus fetched that document
  (_consultado el …_, #135). Groundedness is visible, not claimed — and so is how current it is.
  When two retrieved sources disagree on a figure or date, the answer states the discrepancy and
  cites both (#135); deciding which one is vigente needs structured `effective_date` extraction,
  which is post-launch (#121).
- **Disclaimer** on every answer: not legal/accounting advice — verify with Hacienda/CCSS.

## 6. API surface (route handlers)

| Route                     | Auth     | Purpose                                                                            |
| ------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `POST /api/ask`           | optional | question (+ recent turns, #132) → streamed answer + citations; enforces rate limit |
| `GET /api/history`        | required | user's saved Q&A, scoped to the session's own `user_id`                            |
| `DELETE /api/history/:id` | required | delete one of the session's own saved questions                                    |

Every route reads and writes the database with `service_role`, server-side only: `anon` and
`authenticated` hold no privileges on `public` (#123), so no browser or cookie-scoped client
touches the Data API. Each route takes the user id from the verified session and filters on it.

Ingestion has **no HTTP route**. It runs as `pnpm ingest [doc_key…]` from a developer shell or
from the scheduled re-crawl workflow (`.github/workflows/recrawl.yml`) — see
[ADR 0010](docs/adr/0010-cli-ingestion-authoritative.md), which drops the `POST /api/ingest` this
section used to promise and records why: the route would be an internet-reachable write path
holding the service-role key.

## 7. Auth & rate limiting

_(pinned here per #10)_

- Supabase Auth (email + Google/GitHub OAuth — Google added per #84, hedging magic-link
  email delivery). The history table keeps its per-user RLS policies as defense in depth behind
  the grant lockdown (#123); the enforced boundary is the routes' `user_id` filter.
- Same verified email across providers resolves to one `user_id` (Supabase automatic
  linking); unverified-email collisions stay separate accounts by design (#84).
- **Anonymous: 10 questions/day** per subject = `HMAC-SHA256(RATE_LIMIT_SUBJECT_SECRET,
crDate + IP + coarse UA)` (#125 — keyed so the subject can't be recomputed from an IP,
  date-scoped so it doesn't link across days). **Authed: 50/day** per user.
- "Day" = the **Costa Rica calendar day** (UTC-6, no DST), both tiers — quotas reset at local
  midnight, not at 18:00 local (#125).
- Mechanism: fixed-window counter in the `rate_limits` Postgres table, checked in `/api/ask` —
  no extra vendor. On limit: friendly ES message + sign-in nudge. **Fail-closed** (LLM cost is
  the thing being protected).

## 8. UI

- Landing = chat, with the **top-10 pain questions** (appendix A) as one-click seeded prompts.
- **Components: shadcn/ui; chat scaffolding from Vercel AI Elements** (shadcn-based registry —
  streaming message list + sources primitives that become the citation chips). Owned code, themeable.
- **Visual identity comes from DESIGN.md** (authored pre-build); the Week-2 UI prototype session
  explores _layout_ variants within that identity, and citation rendering is decided there —
  **decided: sello chips + streamed data-part snapshots, [ADR 0004](docs/adr/0004-citation-rendering.md)**.
- **Answer prose: the prompt permits three markdown constructs — `- ` bullets, `**bold**`,
  simple tables — and owned code renders exactly those**, not AI Elements' `Response`/Streamdown
  ([ADR 0008](docs/adr/0008-answer-markdown-rendering.md)). No HTML or image path exists in the
  render and no URL is ever derived from model text — the one `href` it emits is the inline
  citation reference (#133), a same-page fragment to the answer's own sello. AI Elements still
  supplies the chat scaffolding.
- **Answers _and_ chrome in Spanish** — every visible string, `aria-label`, `sr-only` label and
  page title ([ADR 0013](docs/adr/0013-spanish-chrome.md), amending #11). The reader is a Costa
  Rican developer and `<html lang="es">`; an English control narrated over a Spanish page was a
  defect for screen-reader users and a benefit to nobody. README and the demo script stay English —
  they address contributors, not users. Citation chips + disclaimer per answer.
- Signed-in: history sidebar. No other surfaces in MVP.

## 9. Eval & quality gates

- **Eval set:** 30±5 hand-written Q&As seeded from appendix A + corpus reading; stored in-repo
  (`eval/dataset.jsonl`) with expected source docs/artículos per question. A case may carry
  `history` (#132): its question is a follow-up, and both eval suites condense it first, so the
  expected targets are the retrieval the _standalone_ question must produce.
- **Groundedness judge in CI:** LLM-as-judge — "is this answer supported by the retrieved
  chunks?" **Gate: ≥ 90% pass**, blocking (starting threshold per #14; ratchet later, never
  lower). Judge runs at temperature 0; any failed item is re-judged twice more and the majority
  verdict stands — absorbs judge flakiness at n≈25 without loosening the gate. The judge model
  is pinned independently of `ANSWER_MODEL` —
  **[ADR 0007](docs/adr/0007-groundedness-judge-model.md)**.
- Also asserted: retrieval hit-rate (expected artículo in top-k) — catches chunking/retrieval
  regressions separately from generation.
- Standard pipeline: Vitest unit, Playwright e2e, 7-step CI on GitHub Actions, deploy on Vercel.

## 10. Done bar (from #14)

Feature publicly (CV/LinkedIn) when: every BRIEF §5 IN-item ships · CI green including the
groundedness gate · deployed on the real URL · README + ADRs + `how-it-was-built.md` done.
MCP server **not** required to feature — it gates only the "builds MCP servers" claim (BRIEF §6).

## 11. Week-by-week (refreshed)

- **Pre-build (half-day):** DESIGN.md — branding session (impeccable skill): palette → shadcn
  CSS variables, typography, tone, citation-chip look.
- **Wk 1 — foundation:** scaffold (Next.js + Supabase + shadcn), schema + pgvector, corpus manifest,
  fetchers (SINALEVI API + Playwright for Hacienda), chunker (port prototype rules), first full
  ingestion run, CABYS curation.
- **Wk 2 — RAG core:** hybrid retrieval + RRF, embedding ADR benchmark, answer assembly +
  citations + guardrail prompt, chat UI + seeded prompts, auth + history, rate limiting, unit tests.
- **Wk 3 — harden + ship:** eval dataset + groundedness judge wired into CI, Haiku-vs-Sonnet
  eval comparison, Playwright e2e, README/ADRs/how-it-was-built, deploy, buffer.

## 12. ADRs to write during build

1. Embedding model (Voyage vs OpenAI) — benchmark on eval set (Week 2).
2. Citation rendering format (chips vs footnotes) — **[ADR 0004](docs/adr/0004-citation-rendering.md)**: sello chips, cumulative `data-citations` snapshots.
3. Anything that overturns a spec default — record, don't silently drift. Also
   **[ADR 0012](docs/adr/0012-multi-turn-question-condensation.md)**, multi-turn by question
   condensation, which amends §5's single-question framing and §6's request body. First instance:
   **[ADR 0005](docs/adr/0005-lexical-and-or-fallback.md)**, the lexical leg's AND→OR tsquery
   fallback in `search_chunks`; also
   **[ADR 0008](docs/adr/0008-answer-markdown-rendering.md)**, the answer-prose markdown subset
   rendered by owned code instead of AI Elements' `Response`.

## 13. Out of scope (binding — BRIEF §5)

Full tax-law coverage · payments · multi-tenant · realtime · EN answers · fine-tuning ·
MCP server (phase-2) · peer question collection (post-launch) · Renta Global Dual reform
(pending bill — watch item, not law).

---

## Appendix A — Top-10 pain questions (seed prompts + eval seed)

1. ¿Tengo que inscribirme en Hacienda si facturo a clientes en el extranjero?
2. ¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?
3. ¿Cuál código CABYS uso para desarrollo de software?
4. ¿Cuánto pago a la CCSS como trabajador independiente y cómo se calcula la base?
5. ¿Me pueden cobrar retroactivo si nunca me inscribí en la CCSS?
6. ¿Cómo emito factura electrónica y qué cambió con v4.4 / TRIBU-CR?
7. Dejé de trabajar por mi cuenta, ¿cómo me salgo de Hacienda?
8. ¿Cómo calculo renta como persona física con actividad lucrativa — aplica la deducción automática del 25%?
9. ¿Régimen simplificado o tradicional siendo programador? (RTS excluye profesionales liberales)
10. ¿Con TRIBU-CR, cambió el procedimiento para declarar/pagar? ¿Dónde entro ahora?
