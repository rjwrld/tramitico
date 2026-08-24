#!/usr/bin/env bash
# Orca worktree setup — runs once when a worktree is created (wired in Orca's
# repo settings as `bash scripts/orca-setup.sh`).
#
# Everything here must be safe to re-run and safe to fail partially: a broken
# setup line should degrade a worktree, never brick its creation.
set -uo pipefail

main_checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")

# Secrets + agent permission allowlist: gitignored, so they can't travel via
# git. Symlinks, not copies — rotation in the main checkout propagates.
bash scripts/link-env.sh
mkdir -p .claude
if [[ -f "$main_checkout/.claude/settings.local.json" ]]; then
  ln -sfn "$main_checkout/.claude/settings.local.json" .claude/settings.local.json
fi

# Deps: pnpm's shared store makes this mostly hard-linking.
pnpm install --prefer-offline

# Playwright chromium — near no-op when the global browser cache has it.
pnpm exec playwright install chromium

# The local Supabase stack is SHARED across worktrees (CLAUDE.md, Worktrees).
# Warn about drift; applying a branch's migration to the shared db is a
# deliberate step, never automatic.
if supabase status >/dev/null 2>&1; then
  if command -v psql >/dev/null; then
    applied=$(psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -tAc \
      "select version from supabase_migrations.schema_migrations" 2>/dev/null || true)
    for f in supabase/migrations/*.sql; do
      v=$(basename "$f" | cut -d_ -f1)
      grep -q "^$v$" <<<"$applied" ||
        echo "⚠ unapplied migration $(basename "$f") — 'supabase migration up' touches the SHARED db"
    done
  fi
else
  echo "⚠ local Supabase not running — integration tests will skip (start it from the main checkout)"
fi
