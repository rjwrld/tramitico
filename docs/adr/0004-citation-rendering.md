# ADR 0004 — Citation rendering: sello chips, streamed as cumulative data-part snapshots

Date: 2026-08-04 · Status: accepted ·
Context: issue [#22](https://github.com/rjwrld/tramitico/issues/22), consumes the ask contract of
[#21](https://github.com/rjwrld/tramitico/issues/21)

## Context

SPEC §12 deferred the citation rendering format — chips vs footnotes — to chat-UI time, and
SPEC §8 expected the decision to fall out of the Week-2 UI session. DESIGN §5 had meanwhile made
the chip the product's signature component (the sello), which left two real questions:

1. **Chips or footnotes?**
2. **How do citations travel over the ask stream so chips can appear while the answer is still
   streaming?** — #21 pinned "AI SDK data parts" but not the part shape.

## Decision

**Chips — the sello, exactly as DESIGN §5 specifies.** Footnotes are rejected: they bury the
groundedness signal below the fold, and "groundedness is visible, not claimed" (SPEC §5) is the
product's one differentiator. The sello row renders after the answer prose, one chip per cited
`Documento · Artículo`, each chip itself the link to the official source. No AI-Elements sources
primitive is imported; `src/components/sello.tsx` is owned code built directly against the
`Citation` type from `src/lib/retrieval.ts` (the shape #20 already ships).

**Wire shape: `data-citations` parts carrying cumulative snapshots.** Each part's data is the
full deduped citations array in order of use; a stable part id lets later snapshots supersede
earlier ones, and the UI renders the latest. Snapshots beat per-citation increments because they
make the stream idempotent — a re-emitted or reordered part can never duplicate a chip — and the
dedup policy stays server-side in one place (#21).

The client half of the contract is pinned in
[`src/lib/answer/contract.ts`](../../src/lib/answer/contract.ts): request body `{ question }`,
`data-citations` snapshot parts, and non-OK responses as `{ error, message }` JSON with a
user-facing Spanish `message` (the 429 carries #24's rate-limit nudge verbatim). #21 should
import these types rather than restate them.

## Consequences

- The chip label derives from `doc_key` (`reglamento-iva` → `Reglamento IVA · Art. 11`) via a
  small acronym table in `sello.tsx` — new corpus docs with novel acronyms need a table entry,
  which the Sello unit tests cover.
- Until #21 lands, the e2e smoke stubs `/api/ask` with this exact wire shape; the unstubbed
  end-to-end pass stays with #21/#27.
- Citations with no resolvable official URL render as a non-link stamp — the groundedness claim
  never silently disappears, it just loses the hyperlink.
