# ADR 0017 — Other institutions are routed, not covered

Date: 2026-09-04 · Status: accepted · Amends [SPEC §13](../../SPEC.md) · Context:
issues [#254](https://github.com/rjwrld/tramitico/issues/254),
[#264](https://github.com/rjwrld/tramitico/issues/264), and
[#265](https://github.com/rjwrld/tramitico/issues/265)

## Context

An independent worker's journey can touch INS, a municipality, Registro Nacional, professional
associations, banks, MEIC, migration, or MTSS. Covering every institution would turn a closed,
testable Hacienda/CCSS promise into arbitrary government-procedure coverage; a generic decline to
Hacienda would still be unhelpful.

## Decision

These institutions are out of scope for the beta and receive institution-specific routing. One
deterministic table maps a content-free routing category to the institution's verified official
URL. The decline names that institution, but neither the corpus nor the prompt encodes substantive
rules from it. The existing narrow MTSS fact remains until demand evidence justifies replacing it
with cited routing; the product does not ingest the Labor Code for beta.

Promotion to Tier 2 requires both signals confirmed in #254: at least two of the 6–10 direct
validation participants raise the category unprompted, and a content-free decline counter for that
category crosses a threshold agreed after its first month of production data. The counter records
the routing category, never the question text. Quarterly recrawl verifies every routing URL.

## Amendment (2026-09-10, [#285](https://github.com/rjwrld/tramitico/issues/285))

Two questions the abstention set carries — what to charge for a service, and which professional to
hire — have no competent institution at all: no official document fixes either, so routing them to
Hacienda and the CCSS by default sent readers to portals that cannot answer. They get an eleventh
category, `contadores`, whose destination is a person (a professional in accounting or business
advice) and whose verified URL is the Colegio de Contadores Públicos de Costa Rica — the register
of who is colegiado, not a source for an answer. The decline says so in those words and the UI
labels the link «Registro de colegiados», because calling it an official source would contradict
the decline itself. Everything else about the decision above holds: no corpus, no encoded rules,
one table, the same re-crawl.

## Amendment (2026-10-07, [#503](https://github.com/rjwrld/tramitico/issues/503))

The eval had no routed case for migración, INS or driver's licences, and the table had no
destination for the last: «¿Cómo renuevo la licencia de conducir?» fell to the general decline,
Hacienda and the CCSS. A twelfth category, `cosevi`, sends it to the Consejo de Seguridad Vial
(https://www.csv.go.cr), keyed on phrases only, since a bare «licencia» is as often a software
licence. The eval gained six routed abstention cases, one for each of pasaporte, DIMEX, residencia,
INS riesgos del trabajo, licencia de conducir and patente comercial. Each case declares the
category the classifier must give, and a free unit test checks every one.

The same issue asked whether to decline before generation when an out-of-scope keyword hits. The
answer was no. The classifier still runs only on weak retrieval. An out-of-scope question that
retrieves well goes to the model, and the prompt's rule 6 routes it from this table. That costs a
paid call and risks a tangent (the production answer to «¿Cómo renuevo mi pasaporte?» added an
unrelated CCSS fact). A keyword decline would turn away answerable questions instead: «¿Puedo
inscribirme en Hacienda con mi DIMEX?» classifies as `migracion`, and `ho-t2-autorizar-contador`
as `contadores`, because an out-of-scope hit outranks Hacienda vocabulary. The unit test lists such
cases without failing on them. Revisit when real traffic shows model-path tangents.

## Consequences

Routing is useful abstention, not partial coverage. A link or a count does not authorize an answer
about that institution, and a source is added only after the promoted journey meets the same
authority, generalizability, maintenance, and evaluation standard as every Tier 2 family.
