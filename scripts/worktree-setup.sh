#!/usr/bin/env bash
# Worktree setup — T3 Code runs this when a thread is created (a
# runOnWorktreeCreate action, imported from t3.json). It also runs in the
# main checkout for every Local thread, so it exits there before touching
# anything. Safe to re-run by hand.
#
# Everything here must be safe to re-run and safe to fail partially: a broken
# setup line should degrade a worktree, never brick its creation.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
main_checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
here=$(git rev-parse --show-toplevel)

# In the main checkout every link below would point a path at itself — on
# macOS `ln -sfn` replaces the real settings.local.json with a symlink to
# itself, and that file is gitignored, so unrecoverable — and the installs
# are the owner's to run there.
if [[ "$here" -ef "$main_checkout" ]]; then
  echo "main checkout — nothing to set up"
  exit 0
fi

# Gitignored state can't travel via git. Symlinks, not copies: rotation in
# the main checkout propagates, and removing the worktree removes only the
# link. A real file or directory already here is left alone.
link_shared() {
  local src="$main_checkout/$1" dst="$here/$1"
  [[ -e "$src" ]] || return 0
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "⚠ $1 is a real path here — left alone, not linked"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
}

# Secrets + agent permission allowlist.
bash scripts/link-env.sh
link_shared .claude/settings.local.json

# Paid-run transcripts land in the main checkout, which T3 never deletes
# (CLAUDE.md, Worktrees).
mkdir -p "$main_checkout/eval/transcripts"
link_shared eval/transcripts

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
