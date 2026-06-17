#!/usr/bin/env python3
"""
Pagila API smoke test (web-only architecture).

The database is private, so this test does NOT connect to Postgres directly.
It exercises the deployed API Gateway -> Lambda -> Aurora path with a few
read-only queries and checks the row counts look right after seeding.

Usage:
    API_ENDPOINT=https://xxxx.execute-api.us-east-1.amazonaws.com/prod \\
        python3 tests/integration-test.py

API_ENDPOINT is also read from a .env file in the project root if present.
Only the standard library is used (urllib), so there is nothing to install.
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path


def load_api_endpoint() -> str:
    endpoint = os.environ.get("API_ENDPOINT")
    if not endpoint:
        env = Path(__file__).resolve().parent.parent / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                line = line.strip()
                if line.startswith("API_ENDPOINT=") and not line.startswith("#"):
                    endpoint = line.split("=", 1)[1].strip()
                    break
    if not endpoint:
        sys.exit("API_ENDPOINT not set (env var or .env). Use the cdk APIEndpoint output.")
    endpoint = endpoint.rstrip("/")
    if not endpoint.endswith("/query"):
        endpoint += "/query"
    return endpoint


def run_query(url: str, sql: str) -> dict:
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    # First query after an idle period resumes Aurora; allow generous time.
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    url = load_api_endpoint()
    print(f"Testing API: {url}\n")

    # (label, SQL, predicate on the single returned scalar)
    checks = [
        ("film count",     "SELECT count(*) AS n FROM film",                       lambda n: n >= 1000),
        ("customer count", "SELECT count(*) AS n FROM customer",                   lambda n: n >= 500),
        ("rental count",   "SELECT count(*) AS n FROM rental",                     lambda n: n >= 10000),
        ("payment count",  "SELECT count(*) AS n FROM payment",                    lambda n: n >= 10000),
        ("film_actor join","SELECT count(*) AS n FROM film_actor",                 lambda n: n >= 5000),
        ("film_list view", "SELECT count(*) AS n FROM film_list",                  lambda n: n >= 1000),
        ("in-stock fn",    "SELECT count(*) AS n FROM film_in_stock(1, 1)",        lambda n: n >= 0),
    ]

    passed = failed = 0
    for label, sql, ok in checks:
        try:
            result = run_query(url, sql)
            if not result.get("success"):
                print(f"  FAIL  {label}: API error: {result.get('error')}")
                failed += 1
                continue
            value = int(next(iter(result["rows"][0].values())))
            if ok(value):
                print(f"  PASS  {label}: {value}")
                passed += 1
            else:
                print(f"  FAIL  {label}: unexpected value {value}")
                failed += 1
        except (urllib.error.URLError, KeyError, ValueError) as exc:
            print(f"  FAIL  {label}: {exc}")
            failed += 1

    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
