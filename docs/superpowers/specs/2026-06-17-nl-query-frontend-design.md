# Natural-Language Query Frontend — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

A deployed web page where a user types a natural-language request, Bedrock (Claude
Haiku 4.5) converts it to a read-only Postgres query, the query runs against the
private Pagila database, and the page shows four things: the user's request
(echoed), the generated SQL, the results rendered like a terminal (psql-style
table), and a plain-English explanation of what the data shows. The page presents
clickable example prompts that together exercise every kind of data in the database.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Frontend hosting | Deployed: S3 + CloudFront static site |
| LLM | Amazon Bedrock, `anthropic.claude-haiku-4-5` (configurable) |
| Show generated SQL | Yes — between the request and the results |
| Backend shape | Orchestrator Lambda **outside** the VPC, reusing the existing in-VPC `query` Lambda for DB access (no new VPC endpoint) |

## Architecture

```
Browser  (CloudFront + S3 static site)
   │  POST /ask  {prompt}
   ▼
API Gateway ──► ask-Lambda  (outside the VPC)
                  1. Bedrock Converse (Haiku 4.5): schema context + prompt → SQL
                  2. validate: single read-only SELECT/WITH; enforce LIMIT
                  3. lambda.invoke(query-Lambda)  ──►  Aurora (private, in VPC)
                  4. Bedrock Converse (Haiku 4.5): prompt + columns + rows → explanation
                  5. return {prompt, sql, columns, rows, explanation, error?}
```

Why outside the VPC: the ask-Lambda reaches Bedrock over the internet (no Bedrock
VPC endpoint to pay for) and never touches the database directly. The existing
`query` Lambda remains the only path to Aurora. Clean split: the AI orchestrator
has no DB access; the DB Lambda has no Bedrock access.

## Components

### 1. Frontend — `frontend/` (vanilla JS, no framework)

- `index.html` — request textarea, a "Run" button, a grid of example chips, and a
  results panel.
- `app.js` — POSTs `{prompt}` to the API, renders the four output sections, builds
  the terminal-style table client-side from `columns` + `rows` (monospace,
  box-drawn, psql-like; right-pads columns to align). Clicking an example chip
  fills the request box.
- `styles.css` — dark "terminal" aesthetic for the results table; clean layout.
- `config.js` — generated at deploy time by CDK, sets `window.PAGILA_API` to the
  `/ask` URL (so the static site knows the API endpoint without a rebuild).

Results panel layout (top to bottom):
1. **Your request:** the echoed natural-language prompt.
2. **SQL:** the generated query in a code block (copyable).
3. **Result:** terminal-style table (or "0 rows").
4. **Explanation:** the plain-English summary.

### 2. Orchestrator — `infrastructure/cdk/lambda/ask-handler.ts`

- Runtime Node 20, bundled with `NodejsFunction` (esbuild), **not** VPC-attached.
- Uses `@aws-sdk/client-bedrock-runtime` `ConverseCommand` for both calls
  (temperature 0 for SQL, ~0.3 for the explanation; `maxTokens` modest).
- Bundles a **curated Pagila schema summary** (core tables, key columns, FK
  relationships, the `mpaa_rating` enum, the `fulltext` tsvector column, and a note
  that `payment` is partitioned) as the Bedrock *system* prompt so generated SQL is
  accurate. This is a hand-written ~150-line reference, not the full pg_dump.
- Invokes the existing `query` Lambda via `LambdaClient` `InvokeCommand`
  (`RequestResponse`) with payload `{ body: JSON.stringify({ query: sql }) }`,
  matching the query handler's existing event shape; parses its
  `{success, rows, count, error}` response.
- Env vars: `BEDROCK_MODEL_ID`, `QUERY_FUNCTION_NAME`, `AWS_REGION`.
- Returns JSON `{prompt, sql, columns, rows, explanation, error?}` with permissive
  CORS headers.

### 3. CDK additions — `infrastructure/cdk/lib/pagila-stack.ts`

- **ask-Lambda** (`NodejsFunction`, no VPC) with:
  - `bedrock:InvokeModel` on `arn:aws:bedrock:*::foundation-model/anthropic.*` and
    `arn:aws:bedrock:*:<account>:inference-profile/*` (inference profiles need both
    the profile and the underlying model ARNs).
  - `queryFunction.grantInvoke(askFunction)`.
  - timeout 28s (just under the API Gateway 29s ceiling), memory 256 MB.
- **API Gateway**: add an `/ask` resource with a `POST` (Lambda proxy) on the
  existing `PagilaAPI`. CORS is already `ALL_ORIGINS`.
- **Static site**: a private S3 bucket + CloudFront distribution (Origin Access
  Control, default root object `index.html`), and a `BucketDeployment` that uploads
  `frontend/` plus a generated `config.js` carrying the `/ask` URL.
- **Context param** `bedrockModelId` (default `anthropic.claude-haiku-4-5`); some
  accounts/regions require the cross-region inference profile id
  (`us.anthropic.claude-haiku-4-5`). Documented as a prerequisite: enable Bedrock
  model access in the console.
- **Outputs**: `SiteURL` (CloudFront), `AskEndpoint`.

## Example prompts (every kind of data)

Each example chip shows the question **and** a small tag naming the data it
searches (the annotation the user asked to keep). Coverage:

| # | Example prompt | Data searched (tag) |
| --- | --- | --- |
| 1 | Which actors appear in the most films? | actor · film_actor · film |
| 2 | Show the 5 longest films with their length and rating | film · length · mpaa_rating enum |
| 3 | How many films are in each category? | category · film_category |
| 4 | How many films are available in each language? | language · film |
| 5 | How many copies of "ACADEMY DINOSAUR" are at each store? | inventory · store · film |
| 6 | Which films are rented out right now and not yet returned? | rental · inventory (timestamps) |
| 7 | Which 5 customers have spent the most, and how much? | payment · customer (money) |
| 8 | How many active vs inactive customers are there? | customer (boolean active) |
| 9 | List customers located in Canada | customer · address · city · country |
| 10 | Total revenue per store, and the staff who processed it | store · staff · payment |
| 11 | How many films have each MPAA rating (G, PG, R, …)? | film.rating (enum) |
| 12 | Find films whose description mentions "astronaut" | film.fulltext (full-text search) |
| 13 | How many rentals happened per month? | rental.rental_date (date/time series) |
| 14 | Average rental rate and replacement cost by rating | film (numeric aggregates) |
| 15 | Show 10 rows from the film_list view | film_list (view) |

This spans every populated table (actor, film, film_actor, category,
film_category, language, inventory, rental, payment, customer, address, city,
country, store, staff) and every special type/feature in the dataset: the
`mpaa_rating` enum, full-text search, timestamps/date series, numeric/money,
boolean flags, and a built-in view.

**Coverage note:** the JSONB tables (`packages_apt_postgresql_org`,
`packages_yum_postgresql_org`) exist but are **not populated** by the seeder
(their data ships only as `pg_restore` backups), so no example targets them — a
query there would return zero rows. This is called out in the spec, not hidden.

## Read-only safety

The orchestrator rejects any generated query that is not a single `SELECT`/`WITH`
statement (no `INSERT/UPDATE/DELETE/DDL`, no stacked statements via `;`), and
appends `LIMIT 100` when the model omits a limit, so a question cannot mutate data
or return an unbounded result. (The separate `/query` endpoint's open-SQL behavior
is unchanged and out of scope here.)

## Error handling

- Bedrock failure → friendly message, no SQL/results.
- Model returns non-SELECT / invalid SQL → message + the attempted SQL shown.
- Aurora returns a SQL error → show the DB error plus a one-line note; still show
  the SQL.
- API Gateway 29s timeout on a cold Aurora resume → the page shows
  "Database is waking up — try again," and the retry succeeds.

## Known limitation

REST API Gateway has a hard 29s integration timeout. The first request after
Aurora auto-pauses (~15–30s to resume) plus two Bedrock calls can exceed it; the
retry is fast. Documented; mitigated with the friendly retry message. (Not worth a
warmup mechanism for a training tool.)

## Testing

- `tests/ask-smoke-test.py` (stdlib only): POST 2–3 NL prompts to `/ask`, assert
  the response contains non-empty `sql`, a `rows` array, and an `explanation`;
  assert a read-only guard by checking a "delete all customers" prompt is refused.
- `cdk synth` verification: ask-Lambda present and **not** VPC-attached, `/ask`
  route exists, CloudFront distribution + bucket deployment present, IAM has
  `bedrock:InvokeModel` and invoke permission on the query Lambda.

## Out of scope

- Authentication on `/ask` (open, like `/query` — a training sandbox; noted as a
  hardening item, not built here).
- Write/DDL queries (read-only by design).
- Loading the JSONB sample data.
- Streaming responses / conversation history (single request/response).

## File structure

```
frontend/
  index.html
  app.js
  styles.css
infrastructure/cdk/
  lambda/ask-handler.ts          (new)
  lambda/pagila-schema-context.ts (new — curated schema string for the prompt)
  lib/pagila-stack.ts            (modified — ask Lambda, /ask route, S3+CloudFront)
tests/
  ask-smoke-test.py              (new)
```
