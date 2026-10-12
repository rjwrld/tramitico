#!/usr/bin/env bash
# #600's check: a sentence where the answer speaks about itself, in the first
# person («no puedo confirmar», «No encuentro en los documentos…», «los
# documentos que tengo a la vista», «los documentos que consulté», «le
# explico») or as the assistant («este asistente»). It widens #585's
# refusal-check.sh (runs/2026-10-09-580/) to the absence tails Wave G's lane
# wrote. Rule 6's scope sentence («queda fuera de lo que cubre este
# asistente») and a decline's «No encuentro base oficial» are hits too: a hit
# is a lead, read by hand, and a decline may keep them.
#
#   bash eval/runs/2026-10-12-600/first-person-check.sh <transcript.jsonl>...
#
# Prints `<file> <case>: <sentence>` per hit, then `first-person: <answers
# with a hit>/<answers read> <file>`. Free: jq only.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <transcript.jsonl>..." >&2
  exit 2
fi

pattern='\byo\b|\bpuedo\b|\bpude\b|\bencuentro\b|\bencontré\b|\btengo\b|\bconsulté\b|\brecibí\b|\bveo\b|\bno sé\b|\bme (?:permiten|permite|corresponde|impiden|impide|alcanza)\b|\bno (?:le |lo |la |se lo |se la )?(?:calculo|hago|fijo|determino|opero|doy|precis[oa]|comparo|recomiendo|confirmo|ubico)\b|\ble (?:explico|indico|detallo|muestro|resumo|digo|doy|calculo)\b|\bconmigo\b|\beste asistente\b'

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
  echo "first-person: $hits/$total $name"
done
