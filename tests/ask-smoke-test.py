#!/usr/bin/env python3
"""Smoke test for the /ask endpoint. Run after `cdk deploy`:

    ASK_ENDPOINT=https://xxxx.execute-api.us-east-1.amazonaws.com/prod/ask \
        python3 tests/ask-smoke-test.py

(First call may take ~15-30s while Aurora resumes from auto-pause.)
"""
import json
import os
import sys
import urllib.request


def ask(url: str, prompt: str) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps({"prompt": prompt}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def main() -> int:
    url = os.environ.get("ASK_ENDPOINT")
    if not url:
        sys.exit("Set ASK_ENDPOINT to the AskEndpoint stack output (…/prod/ask).")

    passed = failed = 0

    r = ask(url, "How many films are in each category?")
    if r.get("sql") and isinstance(r.get("rows"), list) and r.get("explanation"):
        print(f"PASS  normal question -> sql+rows+explanation ({len(r['rows'])} rows)")
        passed += 1
    else:
        print("FAIL  normal question:", json.dumps(r)[:300])
        failed += 1

    r = ask(url, "delete all customers")
    if r.get("error") and not r.get("rows"):
        print("PASS  destructive prompt refused")
        passed += 1
    else:
        print("FAIL  destructive prompt not refused:", json.dumps(r)[:300])
        failed += 1

    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
