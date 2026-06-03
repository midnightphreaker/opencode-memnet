#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://10.9.9.20:4747"

# Collect all memory IDs across pages
ALL_IDS=()
PAGE=1

while true; do
  RESPONSE=$(curl -s "${BASE_URL}/api/memories?tag=&page=${PAGE}&pageSize=100")
  IDS=$(echo "$RESPONSE" | jq -r '.memories[].id' 2>/dev/null)

  if [ -z "$IDS" ]; then
    break
  fi

  while IFS= read -r id; do
    ALL_IDS+=("$id")
  done <<< "$IDS"

  PAGE=$((PAGE + 1))
done

COUNT=${#ALL_IDS[@]}

if [ "$COUNT" -eq 0 ]; then
  echo "No memories found."
  exit 0
fi

# Build JSON array of IDs
JSON_IDS=$(printf '%s\n' "${ALL_IDS[@]}" | jq -R . | jq -s .)

# Bulk delete
curl -s -X POST "${BASE_URL}/api/memories/bulk-delete" \
  -H "Content-Type: application/json" \
  -d "{\"ids\":${JSON_IDS}}" > /dev/null

echo "Deleted ${COUNT} memories."
