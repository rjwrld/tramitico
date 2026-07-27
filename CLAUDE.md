# Tramitico

RAG assistant for CR independent developers — tax & trámite answers cited to official
Hacienda/CCSS documents. [SPEC.md](SPEC.md) is the build contract; [DESIGN.md](DESIGN.md) the
visual contract; [PRODUCT.md](PRODUCT.md) the strategic context; [BRIEF.md](BRIEF.md) the
original scope (its §5 OUT-list is binding).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on rjwrld/tramitico (gh CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at root (created lazily) + `docs/adr/`. See `docs/agents/domain.md`.
