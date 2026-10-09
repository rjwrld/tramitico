#!/usr/bin/env bash
# #585's check: a sentence where the answer says, in the first person or as
# the assistant, what it won't or can't do («yo no la calculo», «no puedo
# darle ese código», «este asistente tampoco puede hacerlo»). Rule 6's scope
# sentence («queda fuera de lo que cubre este asistente») is not a hit.
#
#   bash eval/runs/2026-10-09-580/refusal-check.sh <transcript.jsonl>...
#
# Prints `<file> <case>: <sentence>` per hit, then `refusal: <answers with a
# hit>/<answers read> <file>`. Free: jq only. A hit is a lead, read by hand.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <transcript.jsonl>..." >&2
  exit 2
fi

# shellcheck disable=SC2016 # jq programs, not shell
pattern='\byo\b|\bno (?:le |lo |la |se lo |se la )?(?:puedo|calculo|hago|fijo|determino|opero|doy|precis[oa])\b|\bme (?:corresponde|impiden)\b|este asistente (?:no|tampoco) (?:puede|hace|calcula|da)|no la hace este asistente|no corresponde a este asistente'

for file in "$@"; do
  name=$(basename "$file")
  jq -r --arg f "$name" --arg p "$pattern" '
    select(.answer != null)
    | .id as $id
    | .answer
    | split("\n")[]
    | splits("(?<=[.!?])\\s+")
    | select(test($p; "i"))
    | "\($f) \($id): \(.)"' "$file"
  hits=$(jq -r --arg p "$pattern" 'select(.answer != null) | select(.answer | test($p; "i")) | .id' "$file" | wc -l | tr -d ' ')
  total=$(jq -r 'select(.answer != null) | .id' "$file" | wc -l | tr -d ' ')
  echo "refusal: $hits/$total $name"
done
