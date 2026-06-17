#!/bin/bash
#
# Pagila API Query Helper
# Execute SQL queries via Lambda/API Gateway endpoint
#
# Usage:
#   ./scripts/query-api.sh "SELECT * FROM film LIMIT 5;"
#   ./scripts/query-api.sh --help
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# Show help
show_help() {
    cat << EOF
${BLUE}Pagila API Query Helper${NC}

Execute SQL queries via Lambda/API Gateway endpoint

Usage:
  ./scripts/query-api.sh <query>    Execute SQL query via API Gateway
  ./scripts/query-api.sh --help     Show this help message

Arguments:
  <query>  SQL query to execute (enclose in quotes)

Requirements:
  - .env file in project root (copy from .env.example if missing)
  - API_ENDPOINT configured in .env
  - curl installed
  - jq installed (for pretty-printing JSON)

Environment Variables (from .env):
  API_ENDPOINT  Lambda/API Gateway URL
                Format: https://<api-id>.execute-api.<region>.amazonaws.com/<stage>

Examples:
  # Count films
  $ ./scripts/query-api.sh "SELECT COUNT(*) FROM film;"

  # Top 5 actors by appearances
  $ ./scripts/query-api.sh "SELECT a.first_name, a.last_name, COUNT(*) as appearances \\
                             FROM actor a \\
                             JOIN film_actor fa ON a.actor_id = fa.actor_id \\
                             GROUP BY a.actor_id \\
                             ORDER BY appearances DESC LIMIT 5;"

  # Recently updated rentals
  $ ./scripts/query-api.sh "SELECT customer_id, rental_id, rental_date \\
                             FROM rental \\
                             ORDER BY rental_date DESC LIMIT 10;"

Tips:
  - Use SELECT queries only (no INSERT, UPDATE, DELETE)
  - Quote the entire query
  - Use single quotes inside the query for string literals
  - For multiline queries, use backslash continuation
  - Results are formatted as JSON

Troubleshooting:
  - If curl is not found: brew install curl (macOS) or apt-get install curl (Linux)
  - If jq is not found: brew install jq (macOS) or apt-get install jq (Linux)
  - Check that API_ENDPOINT is correct in .env file
  - Verify Lambda function is deployed and accessible

EOF
    exit 0
}

# Show error message
error() {
    echo -e "${RED}❌ Error: $1${NC}" >&2
    exit 1
}

# Show warning message
warning() {
    echo -e "${YELLOW}⚠️  Warning: $1${NC}"
}

# Check for help flag
if [[ "$1" == "--help" || "$1" == "-h" || -z "$1" ]]; then
    show_help
fi

# Check if .env file exists
if [[ ! -f "$ENV_FILE" ]]; then
    error ".env file not found at $ENV_FILE"$'\n'\
"Please copy .env.example to .env and configure API_ENDPOINT:"$'\n'\
"  cp $PROJECT_DIR/.env.example $PROJECT_DIR/.env"
fi

# Load environment variables from .env
set -a
source "$ENV_FILE"
set +a

# Validate required variables
if [[ -z "$API_ENDPOINT" ]]; then
    error "API_ENDPOINT not set in .env file"$'\n'\
"Example: API_ENDPOINT=https://xxxxx.execute-api.us-east-1.amazonaws.com/prod"
fi

# Check if curl is installed
if ! command -v curl &> /dev/null; then
    error "curl not found. Please install curl:"$'\n'\
"  macOS: brew install curl"$'\n'\
"  Linux (Debian/Ubuntu): sudo apt-get install curl"$'\n'\
"  Linux (RHEL/CentOS): sudo yum install curl"
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    warning "jq not found. Results will not be pretty-printed."$'\n'"  Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    HAS_JQ=false
else
    HAS_JQ=true
fi

# Store the query
QUERY="$1"

# Display query information
echo -e "${BLUE}🌐 Executing query via API Gateway...${NC}"
echo -e "   ${CYAN}Query:${NC} $QUERY"
echo ""

# Prepare JSON payload
PAYLOAD=$(cat <<EOF
{
  "query": "$QUERY"
}
EOF
)

# Make API request
RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "$API_ENDPOINT" 2>&1)

# Check if curl was successful
if [[ $? -ne 0 ]]; then
    error "Failed to connect to API endpoint: $API_ENDPOINT"$'\n'\
"Check that:"$'\n'\
"  1. The endpoint URL is correct in .env"$'\n'\
"  2. The Lambda function is deployed"$'\n'\
"  3. You have network access to the endpoint"$'\n'\
"Response: $RESPONSE"
fi

# Pretty-print JSON if jq is available
if [[ "$HAS_JQ" == true ]]; then
    echo "$RESPONSE" | jq '.'
else
    # Fallback to plain output
    echo "$RESPONSE"
fi

# Parse response for basic validation
if echo "$RESPONSE" | grep -q "error\|Error"; then
    echo ""
    echo -e "${YELLOW}⚠️  Response contains error information${NC}"
fi
