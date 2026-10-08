#!/usr/bin/env bash
# #557's leak check: the prompt's own vocabulary («cifra derivada», «etiqueta»,
# «marcador») and a first-person refusal to compute («no calculo su caso», «no
# le calculo un total», «yo no hago esa liquidación») in an answer.
#
#   bash eval/runs/2026-10-08-557/leak-check.sh <transcript.jsonl>...
#
# Prints one line per hit, `<file> <case> <vocab|first-person>: <sentence>`,
# then `leaks: <answers with a hit>/<answers read> <file>`. Free: jq only.
# A hit is a lead, read by hand; the pass bar in this directory's README
# counts an answer as leaking only on a hit the read confirms.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <transcript.jsonl>..." >&2
  exit 2
fi

# shellcheck disable=SC2016 # jq programs, not shell
defs='
  def vocab: test("\\b(cifras? derivadas?|etiquetas?|marcador(es)?)\\b"; "i");
  def first_person:
    test("\\byo no\\b"; "i")
    or test("\\bno (le |lo |la |se lo |se la )?(calculo|hago|sumo|resto|multiplico|opero|estimo|liquido|doy)\\b"; "i")
    or test("\\bno (le |lo |la )?puedo (calcular|hacer|sumar|multiplicar|estimar|liquidar|dar)"; "i");
  def kind: if vocab then "vocab" elif first_person then "first-person" else empty end;
'
# shellcheck disable=SC2016
lines="$defs"'
  . as $row
  | ($row.answer // "")
  | scan("[^.\n]+")
  | kind as $kind
  | "\($file) \($row.id) \($kind): \(sub("^\\s+"; ""))"
'
# shellcheck disable=SC2016
count="$defs"'
  "leaks: \([.[] | (.answer // "") | select([kind] | length > 0)] | length)/\(length) \($file)"
'

for file in "$@"; do
  name=$(basename "$file")
  jq -r --arg file "$name" "$lines" "$file"
  jq -rs --arg file "$name" "$count" "$file"
done
