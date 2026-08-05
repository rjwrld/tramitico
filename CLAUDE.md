# Tramitico

RAG assistant for CR independent developers — tax & trámite answers cited to official
Hacienda/CCSS documents. [SPEC.md](SPEC.md) is the build contract; [DESIGN.md](DESIGN.md) the
visual contract; [PRODUCT.md](PRODUCT.md) the strategic context; [BRIEF.md](BRIEF.md) the
original scope (its §5 OUT-list is binding).

## Testing

Every interactive component (anything with a click/submit/toggle path) ships with a jsdom
interaction test that exercises the interaction — not just the states an issue's Tests section
happens to enumerate. Rationale: our UI primitives are Base UI, whose composition constraints
(e.g. `GroupLabel` needs a `Group` ancestor) only fail at runtime, and server-side smoke tests
can't click. Pattern: `// @vitest-environment jsdom` + Testing Library + `afterEach(cleanup)`;
mock `@/lib/supabase/client` and `next/navigation` at the module boundary
(see `src/components/auth/user-menu.test.tsx`).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on rjwrld/tramitico (gh CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at root (created lazily) + `docs/adr/`. See `docs/agents/domain.md`.
