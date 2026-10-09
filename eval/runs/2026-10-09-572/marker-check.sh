#!/usr/bin/env bash
# #572's check: a sentence that states a figure (¢…, …%) with no [n] of its
# own, and a sentence that says a date «ya pasó» or «ya venció» (or their
# plurals).
#
#   bash eval/runs/2026-10-09-572/marker-check.sh <transcript.jsonl>...
#
# Prints one line per hit, `<file> <case> <figure|date>: <sentence>`, then
# `figure: <answers with a hit>/<answers read> · date: <…>/<…> <file>`.
# Free: jq only. A sentence ends at «.», «!» or «?» before a space, or at a
# line end (`SENTENCE_END` in `src/lib/eval/adequacy.ts`, so «¢6.244.000»
# stays whole); a table row is one sentence. Stricter than the abstention
# gate's `figureMentions`, which counts a figure cited if any one of its
# mentions is: here every mention needs its own marker. A hit is a lead,
# read by hand.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <transcript.jsonl>..." >&2
  exit 2
fi

# shellcheck disable=SC2016 # jq programs, not shell
defs='
  def sentences:
    split("\n")[]
    | select(test("\\S"))
    | if test("^\\s*\\|") then . else splits("(?<=[.!?])\\s+") end
    | select(test("\\S"));
  def figure: test("[¢₡]\\s?\\d|\\d+(?:[.,]\\d+)?\\s?%");
  def marker: test("\\[\\d+\\]");
  def kind:
    if figure and (marker | not) then "figure"
    elif test("\\bya (pas(ó|aron)|venci(ó|eron))\\b"; "i") then "date"
    else empty end;
  def hits($k): [(.answer // "") | sentences | select(kind == $k)] | length > 0;
'
# shellcheck disable=SC2016
lines="$defs"'
  . as $row
  | ($row.answer // "")
  | sentences
  | kind as $kind
  | "\($file) \($row.id) \($kind): \(sub("^\\s+"; ""))"
'
# shellcheck disable=SC2016
count="$defs"'
  "figure: \([.[] | select(hits("figure"))] | length)/\(length) · date: \([.[] | select(hits("date"))] | length)/\(length) \($file)"
'

for file in "$@"; do
  name=$(basename "$file")
  jq -r --arg file "$name" "$lines" "$file"
  jq -rs --arg file "$name" "$count" "$file"
done
