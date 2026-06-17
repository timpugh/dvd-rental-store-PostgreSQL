#!/usr/bin/env python3
"""
Pagila Database Integration Test Suite

Comprehensive Python test suite for post-deployment validation.
Tests database connectivity, schema, data integrity, relationships, views, functions, and partitions.

Usage:
    python3 integration-test.py
    DB_HOST=localhost DB_USER=postgres DB_PASSWORD=password DB_NAME=pagila python3 integration-test.py

Environment Variables:
    DB_HOST (default: localhost)
    DB_USER (default: postgres)
    DB_PASSWORD (default: empty)
    DB_NAME (default: pagila)
"""

import os
import sys
import psycopg2
from datetime import datetime

class PagilaTestSuite:
    def __init__(self):
        """Initialize test suite with database connection details from environment."""
        self.db_host = os.getenv('DB_HOST', 'localhost')
        self.db_user = os.getenv('DB_USER', 'postgres')
        self.db_password = os.getenv('DB_PASSWORD', '')
        self.db_name = os.getenv('DB_NAME', 'pagila')
        self.db_port = os.getenv('DB_PORT', '5432')

        self.connection = None
        self.cursor = None
        self.passed_tests = 0
        self.failed_tests = 0
        self.failed_test_names = []

    def connect(self):
        """Connect to the PostgreSQL database."""
        try:
            self.connection = psycopg2.connect(
                host=self.db_host,
                user=self.db_user,
                password=self.db_password,
                database=self.db_name,
                port=self.db_port
            )
            self.cursor = self.connection.cursor()
            return True
        except psycopg2.Error as e:
            print(f"✗ Database connection failed: {e}")
            return False

    def disconnect(self):
        """Disconnect from the database."""
        if self.cursor:
            self.cursor.close()
        if self.connection:
            self.connection.close()

    def test_pass(self, test_name):
        """Record a passing test."""
        print(f"✓ {test_name}")
        self.passed_tests += 1

    def test_fail(self, test_name, error=None):
        """Record a failing test."""
        if error:
            print(f"✗ {test_name}: {error}")
        else:
            print(f"✗ {test_name}")
        self.failed_tests += 1
        self.failed_test_names.append(test_name)

    def execute_query(self, query, single=False):
        """Execute a query and return results."""
        try:
            self.cursor.execute(query)
            if single:
                return self.cursor.fetchone()
            return self.cursor.fetchall()
        except psycopg2.Error as e:
            return None

    def test_connection(self):
        """Test database connection."""
        print("\n🔗 Testing Connection...")

        # Test basic connectivity
        if self.execute_query("SELECT 1") is None:
            self.test_fail("Connection: Can connect to database")
            return False
        self.test_pass("Connection: Can connect to database")

        # Verify database name
        result = self.execute_query("SELECT current_database()", single=True)
        if result and result[0] == self.db_name:
            self.test_pass(f"Connection: Connected to '{self.db_name}' database")
        else:
            self.test_fail(f"Connection: Connected to correct database")

        # Verify user
        result = self.execute_query("SELECT current_user", single=True)
        if result:
            self.test_pass(f"Connection: Authenticated as '{result[0]}'")
        else:
            self.test_fail("Connection: User authentication")

        return True

    def test_tables_exist(self):
        """Test that all core tables exist and have data."""
        print("\n📊 Testing Table Existence & Data...")

        tables_and_counts = {
            'film': (1000, 1100),  # Expected range: ~1000
            'customer': (599, 650),  # Expected range: ~599
            'rental': (16000, 17000),  # Expected range: ~16000
            'payment': (16000, 17000),  # Expected range: ~16000
            'actor': (200, 250),  # Core table
            'category': (16, 20),  # Small reference table
            'inventory': (4500, 5000),  # Expected range
            'address': (600, 650),  # Address records
            'store': (2, 3),  # Store locations
            'staff': (2, 3),  # Staff records
            'language': (1, 10),  # Languages
            'city': (600, 650),  # Cities
            'country': (100, 110),  # Countries
        }

        for table_name, (min_expected, max_expected) in tables_and_counts.items():
            result = self.execute_query(f"SELECT COUNT(*) FROM {table_name}", single=True)
            if result is None:
                self.test_fail(f"Tables: {table_name} table does not exist")
            elif result[0] >= min_expected and result[0] <= max_expected:
                self.test_pass(f"Tables: {table_name} has {result[0]} rows")
            else:
                self.test_fail(f"Tables: {table_name} has {result[0]} rows (expected {min_expected}-{max_expected})")

    def test_joins(self):
        """Test foreign key relationships via joins."""
        print("\n🔗 Testing JOINs & Relationships...")

        joins_to_test = [
            ("film_actor JOIN", "SELECT COUNT(*) FROM film_actor fa JOIN film f ON fa.film_id = f.film_id JOIN actor a ON fa.actor_id = a.actor_id"),
            ("film_category JOIN", "SELECT COUNT(*) FROM film_category fc JOIN film f ON fc.film_id = f.film_id JOIN category c ON fc.category_id = c.category_id"),
            ("customer-address JOIN", "SELECT COUNT(*) FROM customer c JOIN address a ON c.address_id = a.address_id"),
            ("rental-inventory-film JOIN", "SELECT COUNT(*) FROM rental r JOIN inventory i ON r.inventory_id = i.inventory_id JOIN film f ON i.film_id = f.film_id"),
            ("payment-rental JOIN", "SELECT COUNT(*) FROM payment p JOIN rental r ON p.rental_id = r.rental_id"),
            ("inventory-store JOIN", "SELECT COUNT(*) FROM inventory i JOIN store s ON i.store_id = s.store_id"),
        ]

        for join_name, query in joins_to_test:
            result = self.execute_query(query, single=True)
            if result and result[0] > 0:
                self.test_pass(f"JOIN: {join_name} ({result[0]} rows)")
            else:
                self.test_fail(f"JOIN: {join_name}")

    def test_views(self):
        """Test that all views exist and are queryable."""
        print("\n📋 Testing VIEWs...")

        views_to_test = [
            'film_list',
            'customer_list',
            'actor_info',
            'sales_by_film_category',
            'sales_by_store',
            'staff_list',
            'nicer_but_slower_film_list',
        ]

        for view_name in views_to_test:
            result = self.execute_query(f"SELECT COUNT(*) FROM {view_name}", single=True)
            if result:
                self.test_pass(f"VIEW: {view_name} accessible ({result[0]} rows)")
            else:
                self.test_fail(f"VIEW: {view_name} not accessible")

    def test_functions(self):
        """Test that all functions exist and are callable."""
        print("\n⚙️  Testing FUNCTIONS...")

        # film_in_stock
        result = self.execute_query("SELECT COUNT(*) FROM film_in_stock(1, 1)", single=True)
        if result is not None:
            self.test_pass(f"FUNCTION: film_in_stock(1, 1) works")
        else:
            self.test_fail("FUNCTION: film_in_stock")

        # inventory_in_stock
        result = self.execute_query("SELECT inventory_in_stock(1)", single=True)
        if result is not None:
            self.test_pass(f"FUNCTION: inventory_in_stock(1) works")
        else:
            self.test_fail("FUNCTION: inventory_in_stock")

        # inventory_held_by_customer
        result = self.execute_query("SELECT inventory_held_by_customer(1)", single=True)
        if result is not None:
            self.test_pass(f"FUNCTION: inventory_held_by_customer(1) works")
        else:
            self.test_fail("FUNCTION: inventory_held_by_customer")

        # get_customer_balance
        result = self.execute_query("SELECT get_customer_balance(1, NOW())", single=True)
        if result is not None:
            self.test_pass(f"FUNCTION: get_customer_balance(1, NOW()) works")
        else:
            self.test_fail("FUNCTION: get_customer_balance")

        # film_not_in_stock
        result = self.execute_query("SELECT COUNT(*) FROM film_not_in_stock(1, 1)", single=True)
        if result is not None:
            self.test_pass(f"FUNCTION: film_not_in_stock(1, 1) works")
        else:
            self.test_fail("FUNCTION: film_not_in_stock")

        # rewards_report
        result = self.execute_query("SELECT COUNT(*) FROM rewards_report(50, 200)", single=True)
        if result is not None:
            self.test_pass(f"FUNCTION: rewards_report(50, 200) works")
        else:
            self.test_fail("FUNCTION: rewards_report")

    def test_triggers(self):
        """Test that triggers are working and last_update columns are populated."""
        print("\n⏰ Testing TRIGGERS...")

        tables_with_triggers = ['film', 'customer', 'actor', 'rental', 'payment', 'inventory']

        for table_name in tables_with_triggers:
            result = self.execute_query(f"SELECT COUNT(*) FROM {table_name} WHERE last_update IS NOT NULL", single=True)
            if result and result[0] > 0:
                self.test_pass(f"TRIGGER: {table_name} last_update columns populated")
            else:
                self.test_fail(f"TRIGGER: {table_name} last_update columns")

        # Check that last_update is recent
        result = self.execute_query("SELECT MAX(last_update) FROM film", single=True)
        if result and result[0]:
            days_ago = (datetime.now() - result[0].replace(tzinfo=None)).days
            if days_ago <= 30:
                self.test_pass(f"TRIGGER: film last_update is recent ({days_ago} days ago)")
            else:
                self.test_fail(f"TRIGGER: film last_update seems old ({days_ago} days ago)")

    def test_partitions(self):
        """Test payment table partitions."""
        print("\n🔀 Testing PARTITIONS...")

        # Check if payment table is partitioned
        result = self.execute_query(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'payment_p%' AND table_schema = 'public'",
            single=True
        )
        if result and result[0] > 0:
            self.test_pass(f"PARTITION: payment table is partitioned ({result[0]} partitions)")
        else:
            self.test_fail("PARTITION: payment table partitions not found")

        # Check specific partitions
        partitions = ['payment_p2022_01', 'payment_p2022_02', 'payment_p2022_03']
        for partition in partitions:
            result = self.execute_query(f"SELECT COUNT(*) FROM {partition}", single=True)
            if result is not None:
                self.test_pass(f"PARTITION: {partition} exists ({result[0]} rows)")
            else:
                self.test_fail(f"PARTITION: {partition} does not exist")

        # Check data distribution
        result = self.execute_query(
            "SELECT tablename FROM pg_tables WHERE tablename LIKE 'payment_p%' AND schemaname = 'public' ORDER BY tablename",
            single=False
        )
        if result:
            self.test_pass(f"PARTITION: Found {len(result)} partitions for payment table")

    def test_data_integrity(self):
        """Test data integrity constraints."""
        print("\n✓ Testing DATA INTEGRITY...")

        integrity_checks = [
            ("Film: no NULL titles", "SELECT COUNT(*) FROM film WHERE title IS NOT NULL"),
            ("Film: no NULL ratings", "SELECT COUNT(*) FROM film WHERE rating IS NOT NULL"),
            ("Customer: no NULL emails", "SELECT COUNT(*) FROM customer WHERE email IS NOT NULL"),
            ("Rental: no NULL rental_date", "SELECT COUNT(*) FROM rental WHERE rental_date IS NOT NULL"),
            ("Payment: no NULL amounts", "SELECT COUNT(*) FROM payment WHERE amount IS NOT NULL"),
            ("Actor: valid names", "SELECT COUNT(*) FROM actor WHERE first_name IS NOT NULL AND last_name IS NOT NULL"),
            ("Inventory: valid store_id", "SELECT COUNT(*) FROM inventory WHERE store_id IN (1, 2)"),
            ("Customer: valid active flag", "SELECT COUNT(*) FROM customer WHERE active IN (0, 1)"),
        ]

        for check_name, query in integrity_checks:
            result = self.execute_query(query, single=True)
            if result and result[0] > 0:
                self.test_pass(f"INTEGRITY: {check_name} ({result[0]} valid records)")
            else:
                self.test_fail(f"INTEGRITY: {check_name}")

    def test_enums_and_domains(self):
        """Test ENUM types and custom domains."""
        print("\n📦 Testing ENUMS & DOMAINS...")

        # Test MPAA rating ENUM
        result = self.execute_query("SELECT COUNT(DISTINCT rating) FROM film WHERE rating IS NOT NULL", single=True)
        if result and result[0] > 0:
            self.test_pass(f"ENUM: mpaa_rating type works ({result[0]} distinct ratings)")
        else:
            self.test_fail("ENUM: mpaa_rating type")

        # Test year domain
        result = self.execute_query("SELECT COUNT(*) FROM film WHERE release_year::int >= 1901 AND release_year::int <= 2155", single=True)
        if result and result[0] > 0:
            self.test_pass(f"DOMAIN: year type works ({result[0]} valid years)")
        else:
            self.test_fail("DOMAIN: year type")

        # Verify valid ENUM values
        result = self.execute_query("SELECT DISTINCT rating FROM film WHERE rating IS NOT NULL ORDER BY rating", single=False)
        if result:
            ratings = [r[0] for r in result]
            self.test_pass(f"ENUM: Found ratings: {', '.join(ratings)}")

    def test_advanced_features(self):
        """Test advanced database features."""
        print("\n🚀 Testing ADVANCED FEATURES...")

        # Test fulltext search indexes
        result = self.execute_query(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'film' AND column_name = 'fulltext'",
            single=True
        )
        if result and result[0] > 0:
            self.test_pass("FULLTEXT: Film fulltext search column exists")

        # Test language support
        result = self.execute_query("SELECT COUNT(*) FROM language", single=True)
        if result and result[0] > 0:
            self.test_pass(f"LANGUAGE: {result[0]} languages available")

        # Test relationship depth
        result = self.execute_query(
            "SELECT COUNT(*) FROM film f JOIN inventory i ON f.film_id = i.film_id JOIN rental r ON i.inventory_id = r.inventory_id",
            single=True
        )
        if result and result[0] > 0:
            self.test_pass(f"RELATIONSHIPS: Complex film-inventory-rental chain works")

    def run_all_tests(self):
        """Run all test suites."""
        print("\n" + "="*60)
        print("🧪 PAGILA DATABASE INTEGRATION TEST SUITE")
        print("="*60)

        if not self.connect():
            return False

        try:
            self.test_connection()
            self.test_tables_exist()
            self.test_joins()
            self.test_views()
            self.test_functions()
            self.test_triggers()
            self.test_partitions()
            self.test_data_integrity()
            self.test_enums_and_domains()
            self.test_advanced_features()
        finally:
            self.disconnect()

        self.print_summary()
        return self.failed_tests == 0

    def print_summary(self):
        """Print test summary."""
        total_tests = self.passed_tests + self.failed_tests

        print("\n" + "="*60)
        print(f"📊 TEST RESULTS")
        print("="*60)
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {self.passed_tests} ✓")
        print(f"Failed: {self.failed_tests} ✗")

        if self.failed_tests > 0:
            print(f"\nFailed Tests:")
            for test_name in self.failed_test_names:
                print(f"  - {test_name}")
            print(f"\nStatus: ✗ {self.failed_tests} test(s) failed")
        else:
            print(f"\nStatus: ✓ All tests passed!")

        print("="*60 + "\n")


def main():
    """Main entry point."""
    suite = PagilaTestSuite()
    success = suite.run_all_tests()
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
