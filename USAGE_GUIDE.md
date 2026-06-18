# Pagila Usage Guide (web-only)

The database is **private**. You interact with it only through the API Gateway
endpoint that `cdk deploy` creates — there is no direct `psql` access. This guide
covers how to query it, example SQL, costs, and troubleshooting.

## 1. Configure

After deploying (see [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)), copy the
`APIEndpoint` stack output into `.env`:

```bash
cp .env.example .env
# edit .env:  API_ENDPOINT=https://xxxx.execute-api.us-east-1.amazonaws.com/prod/
```

## 2. Run queries

**Web UI:** open the **`SiteURL`** output in a browser and ask in plain English —
it generates the SQL, runs it, shows terminal-style results and an explanation,
and lists the available tables/fields in a collapsible panel.

**Plain curl (raw SQL via the API):**

```bash
curl -sS -X POST "$API_ENDPOINT/query" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT title FROM film LIMIT 3;"}' | jq
```

**Response shape:**

```json
{ "success": true, "rows": [ { "count": "1000" } ], "count": 1, "executedAt": "..." }
```

Errors come back as `{ "success": false, "error": "..." }` with a 4xx/5xx status.

## 3. Example queries

```sql
-- Top 10 films by revenue
SELECT f.title, SUM(p.amount) AS revenue
FROM payment p
  JOIN rental r    ON p.rental_id = r.rental_id
  JOIN inventory i ON r.inventory_id = i.inventory_id
  JOIN film f      ON i.film_id = f.film_id
GROUP BY f.film_id, f.title
ORDER BY revenue DESC
LIMIT 10;

-- Films per category
SELECT c.name, COUNT(*) AS films
FROM category c
  JOIN film_category fc ON c.category_id = fc.category_id
GROUP BY c.name
ORDER BY films DESC;

-- Full-text search
SELECT title FROM film WHERE fulltext @@ to_tsquery('fate & india');
```

More example SQL lives in [tests/test-queries.sql](tests/test-queries.sql) (a
reference library — run statements individually through the API).

## 4. Smoke test

```bash
API_ENDPOINT=<your APIEndpoint> python3 tests/integration-test.py
```

It POSTs a handful of `count(*)` queries and checks the seeded row counts
(film ≥ 1000, rental ≥ 10000, …). Standard library only.

## 5. Costs

- **Aurora Serverless v2** scales to **0 ACU** when idle (auto-pause), so an
  unused database costs only storage (a few cents/day).
- **Interface endpoint** (Secrets Manager) is pinned to **one AZ** and runs 24/7
  (~$7/month) — it does not pause with Aurora.
- **Lambda / API Gateway** are effectively free at training volumes.
- Cheapest of all: `cdk destroy` when you're done for a while, redeploy later.

## 6. Troubleshooting

- **First query is slow or times out (~15–30s).** Aurora is resuming from
  auto-pause. Retry; the Lambda timeout is 60s to allow for it.
- **403 / "Missing Authentication Token".** You POSTed to the base URL instead of
  `/query`. Use `$API_ENDPOINT/query` (the helper script handles this).
- **`success:false` with a SQL error.** The error is the database message — fix
  the SQL. The endpoint runs arbitrary SQL (see security note).
- **Need ad-hoc `psql`?** The DB is private by design. You'd need a bastion /
  SSM port-forward in the VPC; that wasn't included to keep cost down.

## 7. Security note

The `/query` endpoint executes **arbitrary SQL** with **no authentication** —
fine for a personal training sandbox, not for anything real. Before exposing it
more widely, add an API key / IAM auth / a Cognito authorizer and consider
restricting it to read-only statements.
