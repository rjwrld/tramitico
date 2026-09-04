# ADR 0018 — Derived figures are computed by code

Date: 2026-09-04 · Status: accepted · Amends [SPEC §5](../../SPEC.md#5-retrieval--answer-assembly) · Context: issue [#263](https://github.com/rjwrld/tramitico/issues/263)

Some useful figures are not claims any one official document makes. The 2026 CCSS base mínima contributiva, for example, combines a CCSS scale factor with the MTSS minimum wage. We record these derivations in `corpus/manifest.json` as arithmetic formulas over named values, with the exact document and artículo that state every input.

After reranking, answer assembly resolves each input against the final numbered chunks. It evaluates and exposes the figure only when every input is present, using a deliberately small arithmetic grammar rather than executable manifest code. The calculated block carries the existing citation marker of every input, so model prose, sellos, and history use the ordinary citation path. Runtime validation rejects a quoted figure unless its own paragraph carries every input marker, and the groundedness judge receives the same calculated block as the answer model. Prompt rule 3 remains unchanged: the model may repeat a system-calculated figure but may not calculate, estimate, or update one itself.

The manifest is intentionally the update seam for annual figures. A new wage decree or salario base requires updating its audited input value and source identity together; a partial retrieval or stale article identity yields no derived block rather than an unsupported number.
