#!/usr/bin/env python3
"""
Pagila Database Initialization Script

Initializes Aurora PostgreSQL with Pagila schema and sample data.
Executes SQL files sequentially with error handling and progress reporting.

Environment Variables Required:
  DB_HOST     - Aurora cluster endpoint
  DB_PORT     - Database port (default: 5432)
  DB_NAME     - Database name (default: pagila)
  DB_USER     - Database user (default: postgres)
  DB_PASSWORD - Database password

Example:
  export DB_HOST=pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com
  export DB_PASSWORD=YourSecurePassword123!
  python3 scripts/init-database.py
"""

import os
import sys
import psycopg2
from pathlib import Path


def get_env_var(name, default=None):
    """Get environment variable or use default."""
    value = os.environ.get(name, default)
    if value is None:
        return None
    return value


def print_header(msg):
    """Print formatted header message."""
    print(f"🔗 {msg}")


def print_step(msg):
    """Print formatted step message."""
    print(f"📂 {msg}")


def print_success(msg):
    """Print formatted success message."""
    print(f"   ✅ {msg}")


def print_error(msg):
    """Print formatted error message."""
    print(f"   ❌ {msg}", file=sys.stderr)


def print_info(msg):
    """Print formatted info message."""
    print(f"   ℹ️  {msg}")


def validate_sql_file(filepath):
    """Check if SQL file exists."""
    if not Path(filepath).exists():
        return False
    return True


def connect_to_database(host, port, dbname, user, password):
    """Connect to Aurora PostgreSQL database."""
    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            database=dbname,
            user=user,
            password=password
        )
        return conn
    except psycopg2.Error as e:
        print_error(f"Connection failed: {e}")
        return None


def execute_sql_file(conn, filepath, description):
    """Execute SQL file with error handling."""
    try:
        print_step(f"Loading: {description}")
        print_info(f"File: {Path(filepath).name}")

        # Verify file exists
        if not validate_sql_file(filepath):
            print_error(f"SQL file not found: {filepath}")
            return False

        # Read and execute SQL file
        with open(filepath, 'r') as f:
            sql_content = f.read()

        cursor = conn.cursor()
        cursor.execute(sql_content)
        conn.commit()
        cursor.close()

        print_success("Success")
        return True

    except psycopg2.Error as e:
        print_error(f"Execution failed: {e}")
        conn.rollback()
        return False
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        conn.rollback()
        return False


def main():
    """Main initialization flow."""

    # Get configuration from environment
    db_host = get_env_var("DB_HOST")
    db_port = int(get_env_var("DB_PORT", "5432"))
    db_name = get_env_var("DB_NAME", "pagila")
    db_user = get_env_var("DB_USER", "postgres")
    db_password = get_env_var("DB_PASSWORD")

    # Validate required variables
    if not db_host:
        print_error("DB_HOST environment variable is required")
        return 1

    if not db_password:
        print_error("DB_PASSWORD environment variable is required")
        return 1

    # Determine base directory for SQL files
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    sql_files = [
        (project_root / "pagila-schema.sql", "Pagila Schema"),
        (project_root / "pagila-schema-jsonb.sql", "JSONB Schema"),
        (project_root / "pagila-data.sql", "Pagila Data (COPY method)"),
    ]

    # Connect to database
    print_header(f"Connecting to Aurora PostgreSQL...")
    conn = connect_to_database(db_host, db_port, db_name, db_user, db_password)

    if not conn:
        print_error("Failed to connect to database")
        return 1

    print_success(f"Connected to {db_host}:{db_port}/{db_name}")
    print()

    # Execute SQL files
    all_success = True
    for filepath, description in sql_files:
        if not execute_sql_file(conn, str(filepath), description):
            all_success = False
            break
        print()

    # Close connection
    conn.close()

    # Report results
    if all_success:
        print("✅ Database initialization complete!")
        print()
        print("You can now:")
        print("  1. Connect via psql:")
        print(f"     psql -h {db_host} -U {db_user} -d {db_name}")
        print("  2. Test a query:")
        print("     SELECT COUNT(*) FROM film;")
        print()
        print("Note: JSONB backup files require pg_restore (manual step):")
        print("  pg_restore -h {host} -U {user} -d {db_name} pagila-data-apt-jsonb.backup")
        print()
        return 0
    else:
        print_error("Database initialization failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
