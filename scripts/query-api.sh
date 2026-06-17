#!/bin/bash
#
# Pagila API query helper - runs a SQL query through API Gateway -> Lambda.
# The database is private (web-only), so this is how you talk to it.
#
# Usage:
#   ./scripts/query-api.sh "SELECT count(*) FROM film;"
#
# Requires:
#   - API_ENDPOINT in .env (the APIEndpoint output from `cdk deploy`)
#   - curl, jq
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || -z "${1:-}" ]]; then
  echo "Usage: ./scripts/query-api.sh \"SELECT count(*) FROM film;\""
  echo "Set API_ENDPOINT in .env (from the 'cdk deploy' APIEndpoint output)."
  exit 0
fi

[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

: "${API_ENDPOINT:?API_ENDPOINT not set - put the cdk APIEndpoint output in .env}"
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq   >/dev/null || { echo "jq is required"   >&2; exit 1; }

QUERY="$1"

# The POST method lives on the /query resource; accept a base or full URL.
URL="${API_ENDPOINT%/}"
[[ "$URL" == */query ]] || URL="$URL/query"

# Build the JSON body safely (handles quotes/newlines in the query).
BODY="$(jq -n --arg q "$QUERY" '{query: $q}')"

curl -sS -X POST -H "Content-Type: application/json" -d "$BODY" "$URL" | jq '.'
