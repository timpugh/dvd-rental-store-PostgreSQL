#!/bin/bash
#
# Pagila Database Connection Helper
# Quickly connect to Aurora PostgreSQL database via psql
#
# Usage:
#   ./scripts/connect-db.sh          # Connect using .env values
#   ./scripts/connect-db.sh --help   # Show this help message
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# Show help
show_help() {
    cat << EOF
${BLUE}Pagila Database Connection Helper${NC}

Usage:
  ./scripts/connect-db.sh          Connect to database using .env configuration
  ./scripts/connect-db.sh --help   Show this help message

Requirements:
  - .env file in project root (copy from .env.example if missing)
  - psql installed (PostgreSQL client tools)
  - Network access to Aurora cluster

Environment Variables (from .env):
  DB_HOST       Aurora cluster endpoint
  DB_PORT       Database port (default: 5432)
  DB_NAME       Database name (default: pagila)
  DB_USER       Database user (default: postgres)
  DB_PASSWORD   Database password (required)

Example:
  $ ./scripts/connect-db.sh
  🔗 Connecting to Pagila database...
     Host: pagila-cluster.xxx.us-east-1.rds.amazonaws.com
     Database: pagila
     User: postgres

  To exit psql, type: \\q

  psql (15.0, server 15.3)
  Type "help" for help.

  pagila=#

Tips:
  - Use \\dt to list all tables
  - Use \\d <table_name> to describe a table
  - Use \\q to quit psql
  - Use \\? for psql help commands

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
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    show_help
fi

# Check if .env file exists
if [[ ! -f "$ENV_FILE" ]]; then
    error ".env file not found at $ENV_FILE"$'\n'\
"Please copy .env.example to .env and fill in your database credentials:"$'\n'\
"  cp $PROJECT_DIR/.env.example $PROJECT_DIR/.env"
fi

# Load environment variables from .env
set -a
source "$ENV_FILE"
set +a

# Validate required variables
if [[ -z "$DB_HOST" ]]; then
    error "DB_HOST not set in .env file"
fi

if [[ -z "$DB_PASSWORD" ]]; then
    error "DB_PASSWORD not set in .env file"
fi

# Set defaults if not specified
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-pagila}"
DB_USER="${DB_USER:-postgres}"

# Display connection information
echo -e "${BLUE}🔗 Connecting to Pagila database...${NC}"
echo "   Host: $DB_HOST"
echo "   Port: $DB_PORT"
echo "   Database: $DB_NAME"
echo "   User: $DB_USER"
echo ""
echo -e "${GREEN}To exit psql, type: \\\\q${NC}"
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    error "psql not found. Please install PostgreSQL client tools:"$'\n'\
"  macOS: brew install postgresql"$'\n'\
"  Linux (Debian/Ubuntu): sudo apt-get install postgresql-client"$'\n'\
"  Linux (RHEL/CentOS): sudo yum install postgresql"
fi

# Connect to database
PGPASSWORD="$DB_PASSWORD" psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME"
