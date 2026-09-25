#!/usr/bin/env bash
#
# The quarterly re-crawl (SPEC §3, ADR 0010), owner-run (#405).
#
# GitHub-hosted runners cannot reach www.ccss.sa.cr or www.hacienda.go.cr
# (timeouts and a 400 on both 2026-09-24 runs; fine from a Costa Rican
# connection), and those two hosts carry six of the corpus's documents. So the
# re-crawl runs from the owner's machine, against production, and
# `.github/workflows/recrawl.yml` only reminds: an issue on the 25th of the
# month before, a comment on the 1st.
#
#   pnpm recrawl              # every document
#   pnpm recrawl ccss-faq     # just these doc_keys
#
# Run from the main checkout, on an up-to-date `main`, with `.env.prod` (the
# deploy wizard's capture) beside it. The steps are the ones the 2026-09-24
# production ingest ran by hand:
#
#   1. the routing table's front doors still answer (`pnpm check:routing`);
#   2. no annualChurn entry names a past fiscal year (manifest vigencia test);
#   3. `pnpm ingest` against production, with Voyage embeddings;
#   4. `eval/corpus-index.json`: the ingest writes it, formatted, only when
#      the coverage changed, so a dirty file is the PR #163 requires.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.prod}"
INDEX="eval/corpus-index.json"

cd "$(git rev-parse --show-toplevel)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No $ENV_FILE here — run from the main checkout (the deploy wizard writes it)." >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Not on main. The corpus production holds must be the one main records (#163)." >&2
  exit 1
fi
if ! git diff --quiet -- corpus "$INDEX"; then
  echo "Uncommitted changes under corpus/ or in $INDEX — commit or discard them first." >&2
  exit 1
fi
git pull --ff-only

echo "── 1/4 routing front doors"
pnpm check:routing

echo "── 2/4 manifest vigencia"
pnpm exec vitest run --project unit src/lib/ingestion/manifest-vigencia.test.ts

echo "── 3/4 ingest into production"
(
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  EMBEDDINGS_PROVIDER=voyage pnpm ingest "$@"
)

echo "── 4/4 corpus index"
if git diff --quiet -- "$INDEX"; then
  echo "✓ corpus unchanged: production holds the corpus $INDEX records."
else
  echo "⚠ the corpus changed: commit $INDEX on a branch and open a PR (#163)."
  git diff --stat -- "$INDEX"
fi
