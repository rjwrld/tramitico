#!/usr/bin/env bash
# Symlink the main checkout's untracked .env.local into the current worktree.
#
# Orca's worktree setup (scripts/orca-setup.sh) runs this on create, so
# worktrees are keyed by default. The spend guardrail moved to convention:
# `pnpm test:eval` costs real API calls, so it runs on purpose, not habit
# (CLAUDE.md, Worktrees). Safe to re-run by hand (pnpm env:link) any time.
#
# A symlink (not a copy) keeps one source of truth: key rotation in the main
# checkout propagates everywhere, and removing the worktree removes only the
# link.
set -euo pipefail

main_checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
here=$(git rev-parse --show-toplevel)

if [[ "$here" == "$main_checkout" ]]; then
  echo "already in the main checkout — nothing to link"
  exit 0
fi

src="$main_checkout/.env.local"
if [[ ! -f "$src" ]]; then
  echo "error: $src not found — create .env.local in the main checkout first (see .env.example)" >&2
  exit 1
fi

ln -sfn "$src" "$here/.env.local"
echo "linked $here/.env.local -> $src"
