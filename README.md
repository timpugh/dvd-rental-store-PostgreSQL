# Pagila — AWS Serverless Training Edition

A serverless deployment of the **Pagila** sample database (a DVD‑rental store
schema) for practicing PostgreSQL on AWS at minimal cost.

## Architecture (private / web‑only)

![AWS Serverless Pagila Architecture Diagram](docs/pagila-serverless-architecture.png)

- **Database:** Aurora PostgreSQL **Serverless v2** with scale‑to‑zero (auto‑pauses when idle), **private** — no public endpoint.
- **Access:** **API Gateway → Lambda** only. You send SQL to an HTTPS endpoint; the Lambda runs it inside the VPC and returns JSON. There is **no direct psql** from a laptop (the DB is private by design).
- **Credentials:** generated and stored in **Secrets Manager**; the Lambda reads them through a single‑AZ interface VPC endpoint (no NAT gateway).
- **Seeding:** a one‑time **seeder Lambda** (CloudFormation custom resource) loads the schema + sample data on deploy — nothing to run by hand.
- **IaC:** AWS CDK (TypeScript) in [infrastructure/cdk/](infrastructure/cdk/).

**Request flow:** `POST /query` → Lambda → (read secret via endpoint) → run SQL on Aurora → rows back as JSON.

## Quick start

Prereqs: an AWS account, AWS CLI configured, Node.js 18+, and the AWS CDK
(`npx cdk`). See [infrastructure/aws-setup-guide.md](infrastructure/aws-setup-guide.md).

```bash
cd infrastructure/cdk
npm install
npx cdk bootstrap            # first time in the account/region only
npx cdk deploy               # creates everything AND seeds the database
```

When it finishes, copy the **`APIEndpoint`** output into a `.env` file, then query:

```bash
cp .env.example .env         # set API_ENDPOINT to the APIEndpoint output
./scripts/query-api.sh "SELECT count(*) FROM film;"
```

Or call it directly:

```bash
curl -sS -X POST "$API_ENDPOINT/query" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT title, rental_rate FROM film LIMIT 5;"}' | jq
```

Smoke‑test the deployment:

```bash
API_ENDPOINT=<your APIEndpoint> python3 tests/integration-test.py
```

Tear everything down (stops all charges):

```bash
cd infrastructure/cdk && npx cdk destroy
```

More detail in [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) and
[USAGE_GUIDE.md](USAGE_GUIDE.md).

> **Note on the JSONB sample data:** the relational Pagila data is loaded
> automatically. The JSONB extras ship as `pg_restore` custom‑format backups
> (`pagila-data-*-jsonb.backup`), which the seeder does not apply — those two
> `jsonb` tables are created but left empty.

## Example query

Find late rentals:

```sql
SELECT CONCAT(customer.last_name, ', ', customer.first_name) AS customer,
       address.phone, film.title
FROM rental
  INNER JOIN customer  ON rental.customer_id   = customer.customer_id
  INNER JOIN address   ON customer.address_id  = address.address_id
  INNER JOIN inventory ON rental.inventory_id  = inventory.inventory_id
  INNER JOIN film      ON inventory.film_id    = film.film_id
WHERE rental.return_date IS NULL
  AND rental_date < CURRENT_DATE
ORDER BY title
LIMIT 5;
```

Full‑text search is built in (no `film_text` table needed):

```sql
SELECT * FROM film WHERE fulltext @@ to_tsquery('fate & india');
```

## About Pagila

Pagila is a port of the [Sakila](https://dev.mysql.com/doc/sakila/en/) example
database (originally by Mike Hillyer of the MySQL AB documentation team),
intended as a standard schema for examples, tutorials, and articles. It targets
PostgreSQL 12+. Notable differences from Sakila:

- `char(1)` true/false fields became real booleans
- `last_update` columns are maintained by triggers
- foreign keys added (and pointless `DEFAULT 0` on FKs removed)
- PostgreSQL built‑in full‑text search (no `film_text` table)
- `rewards_report` ported to a simple set‑returning function
- JSONB sample data added

The `payment` table is partitioned by month. Pagila is made available under the
PostgreSQL license.

## Data files

- `pagila-schema.sql` — schema (tables, views, functions, triggers)
- `pagila-schema-jsonb.sql` — the two JSONB tables
- `pagila-insert-data.sql` — sample data as `INSERT`s (used by the seeder Lambda)
- `pagila-data.sql` — same data using `COPY` (kept for reference / `psql` use)
- `pagila-data-*-jsonb.backup` — JSONB data for `pg_restore` (not auto‑loaded)
