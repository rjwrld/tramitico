# ADR 0014 — HTML FAQs own their question boundaries

Date: 2026-09-03 · Status: accepted · Amends [SPEC §3, §4](../../SPEC.md) · Context: issue [#258](https://github.com/rjwrld/tramitico/issues/258)

Official HTML FAQs may declare a source-specific extractor in the manifest. Unlike normas, the honest citable unit is one visible question paired with its modal answer, so the extractor emits prepared chunks with the question as `articulo` and the category as `path`; the shared embed-and-persist stage remains unchanged. We require an explicit extractor discriminator rather than treating `kind: html` as one universal page shape, and each extractor carries a source-shape count floor so a redesign cannot replace good rows with an empty crawl.
