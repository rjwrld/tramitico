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
# Run from the main checkout, on `main`, with `.env.prod` (the deploy wizard's
# capture) beside it. Before anything runs, the checkout must be exactly
# origin/main once `git pull --ff-only` is done — nothing staged, modified or
# untracked — and `pnpm install --frozen-lockfile` runs before any secret is
# read. Then the steps the 2026-09-24 production ingest ran by hand:
#
#   1. the routing table's front doors still answer (`pnpm check:routing`);
#   2. no annualChurn entry names a past fiscal year (manifest vigencia test);
#   3. `pnpm ingest` against production, with Voyage embeddings, in an
#      environment holding only what it needs (scoped_ingest below);
#   4. `eval/corpus-index.json`: the ingest writes it, formatted, only when
#      the coverage changed, so a dirty file is the PR #163 requires.
#
# Sourcing this file only defines its functions; scripts/recrawl.test.ts does.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.prod}"
INDEX="eval/corpus-index.json"

# What `pnpm ingest` reads from the env file: the production database and the
# key its Voyage embedder needs. Nothing else the file holds reaches it.
INGEST_KEYS="SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY VOYAGE_API_KEY"

# env_file_value FILE KEY prints KEY's value from a dotenv-style FILE, read and
# never executed: `source` would run whatever the file held, and `set -a` would
# export every secret in it. Takes an `export ` prefix, whole-line and ` #`
# trailing comments, and one pair of surrounding quotes (no escapes inside);
# the deploy wizard writes KEY=value unquoted. The last assignment wins, as it
# would when sourced. Returns 1 when KEY is absent, 2 when its line cannot be
# parsed — and never prints a value to stderr.
env_file_value() {
  local file="$1" key="$2" line value="" q rest tail found=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    [[ "$line" == "$key="* ]] || continue
    value="${line#*=}"
    case "$value" in
      \"* | \'*)
        q="${value:0:1}"
        rest="${value:1}"
        if [[ "$rest" != *"$q"* ]]; then
          echo "$file: $key has an unterminated quote." >&2
          return 2
        fi
        tail="${rest#*"$q"}"
        tail="${tail#"${tail%%[![:space:]]*}"}"
        if [[ -n "$tail" && "$tail" != \#* ]]; then
          echo "$file: $key has text after its closing quote." >&2
          return 2
        fi
        value="${rest%%"$q"*}"
        ;;
      *)
        value="${value%%[[:space:]]#*}"
        value="${value%"${value##*[![:space:]]}"}"
        ;;
    esac
    found=1
  done <"$file"
  [[ -n "$found" ]] || return 1
  printf '%s' "$value"
}

# require_clean_tree: nothing staged, modified or untracked (ignored files —
# the env file, corpus/cache/ — excepted). An untracked corpus file or an
# uncommitted ingestion edit would reach production with no commit recording
# it; `git diff --quiet -- corpus` let all three through.
require_clean_tree() {
  local dirty
  dirty="$(git status --porcelain)"
  if [[ -n "$dirty" ]]; then
    echo "The checkout is not clean — commit or discard these first:" >&2
    printf '%s\n' "$dirty" >&2
    return 1
  fi
}

# require_at_origin_main: HEAD is the commit origin/main records — not behind
# it, and not ahead with local commits nobody reviewed (#163).
require_at_origin_main() {
  local head origin
  head="$(git rev-parse HEAD)"
  origin="$(git rev-parse origin/main)"
  if [[ "$head" != "$origin" ]]; then
    echo "HEAD (${head:0:12}) is not origin/main (${origin:0:12}). Production must hold the corpus main records (#163)." >&2
    return 1
  fi
}

# scoped_ingest FILE [doc_key…] runs `pnpm ingest` under `env -i`, in an
# environment holding the INGEST_KEYS read out of FILE, and from this shell
# only what the tools need to start:
#
#   PATH, HOME  pnpm (a corepack shim, its cache under HOME), node, pdftotext,
#               pdfimages and unzip; Playwright's Chromium, which the Hacienda
#               fetch launches, under HOME's cache unless
#   PLAYWRIGHT_BROWSERS_PATH  names where it was installed instead (if set);
#   TMPDIR      (if set) keeps Chromium's throwaway profile in the per-user
#               temp dir rather than the shared /tmp.
#
# plus three settings of its own:
#
#   EMBEDDINGS_PROVIDER=voyage  production vectors are Voyage's, whatever the
#       file says: a stub vector in production would retrieve nothing;
#   INGEST_NO_DOTENV=1  ingest.ts skips its `.env.local` back-fill, so the dev
#       file symlinked into every worktree cannot fill a gap here;
#   pnpm_config_verify_deps_before_run=error  pnpm 11 reinstalls stale
#       dependencies before running a script; here it fails instead, so no
#       install script runs beside these keys (the install ran without them).
#
# Nothing else: not NODE_OPTIONS, not the caller's shell, not the rest of the
# file. The values sit in `env`'s argv only until it execs pnpm.
scoped_ingest() {
  local file="$1" key value rc
  shift
  local -a pass=()
  for key in $INGEST_KEYS; do
    rc=0
    value="$(env_file_value "$file" "$key")" || rc=$?
    if ((rc == 2)); then
      return 1
    fi
    if [[ -z "$value" ]]; then
      echo "$file sets no $key, which the ingest needs (the deploy wizard writes it)." >&2
      return 1
    fi
    pass+=("$key=$value")
  done
  if [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
    pass+=("PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH")
  fi
  if [[ -n "${TMPDIR:-}" ]]; then
    pass+=("TMPDIR=$TMPDIR")
  fi
  env -i PATH="$PATH" HOME="$HOME" "${pass[@]}" \
    EMBEDDINGS_PROVIDER=voyage INGEST_NO_DOTENV=1 \
    pnpm_config_verify_deps_before_run=error \
    pnpm ingest "$@"
}

main() {
  cd "$(git rev-parse --show-toplevel)"

  if [[ ! -f "$ENV_FILE" ]]; then
    echo "No $ENV_FILE here — run from the main checkout (the deploy wizard writes it)." >&2
    exit 1
  fi
  if [[ "$(git branch --show-current)" != "main" ]]; then
    echo "Not on main. The corpus production holds must be the one main records (#163)." >&2
    exit 1
  fi
  require_clean_tree
  git pull --ff-only
  require_clean_tree
  require_at_origin_main

  echo "── 0/4 dependencies (before any secret is read)"
  pnpm install --frozen-lockfile

  echo "── 1/4 routing front doors"
  pnpm check:routing

  echo "── 2/4 manifest vigencia"
  pnpm exec vitest run --project unit src/lib/ingestion/manifest-vigencia.test.ts

  echo "── 3/4 ingest into production"
  scoped_ingest "$ENV_FILE" "$@"

  echo "── 4/4 corpus index"
  if git diff --quiet -- "$INDEX"; then
    echo "✓ corpus unchanged: production holds the corpus $INDEX records."
  else
    echo "⚠ the corpus changed: commit $INDEX on a branch and open a PR (#163)."
    git diff --stat -- "$INDEX"
  fi
}

# Run, unless sourced. One line, so bash has read the rest of this file before
# `git pull` can rewrite it under the running script.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; exit; fi
