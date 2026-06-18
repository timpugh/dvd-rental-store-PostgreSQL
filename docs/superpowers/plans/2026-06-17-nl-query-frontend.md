# Natural-Language Query Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** the JSONB seeder plan (`2026-06-17-jsonb-seeder-container.md`) should be implemented first so the two JSONB example prompts return data.

**Goal:** A deployed S3 + CloudFront web page where a user types a natural-language request; an "ask" Lambda uses Amazon Bedrock (Claude Haiku 4.5) to generate a read-only SQL query, runs it via the existing in-VPC `query` Lambda, and returns the request, the generated SQL, terminal-style results, and a plain-English explanation.

**Architecture:** A new `ask` Lambda runs **outside** the VPC: Bedrock Converse → read-only SQL → invoke the existing `query` Lambda (which reaches private Aurora) → Bedrock Converse for an explanation. A static page (S3 behind CloudFront) calls `POST /ask` on the existing API Gateway. SQL is hard-validated as a single read-only `SELECT`/`WITH` before it ever runs.

**Tech Stack:** AWS CDK (TypeScript), `NodejsFunction` (esbuild), `@aws-sdk/client-bedrock-runtime` (Converse), `@aws-sdk/client-lambda`, API Gateway REST, S3 + CloudFront (OAC) + `BucketDeployment`, vanilla browser JS, `node:test` / `tsx` for unit tests, Python stdlib smoke test.

## Global Constraints

- Region `us-east-1`. Bedrock model access must be enabled in the console for the chosen model; the model id is the CDK context param `bedrockModelId` (default `anthropic.claude-haiku-4-5`; some accounts need `us.anthropic.claude-haiku-4-5`).
- The `ask` Lambda is **NOT** VPC-attached (it must reach Bedrock over the internet and only invokes the query Lambda).
- Read-only only: a generated query that is not a single `SELECT`/`WITH` is rejected before execution; a `LIMIT 100` is appended when absent.
- API Gateway REST hard timeout is 29s → `ask` Lambda timeout is 28s; first call after Aurora auto-pause may time out and need a retry (surface a friendly message).
- CORS is already `ALL_ORIGINS` on the existing `PagilaAPI`.
- Existing `query` Lambda contract: it parses `event.body` as JSON `{query}` and returns `{statusCode, body}` where `body` is JSON `{success, rows, count, error}`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Read-only SQL guard

**Files:**
- Create: `infrastructure/cdk/lambda/sql-guard.ts`
- Create: `infrastructure/cdk/lambda/sql-guard.test.ts`
- Modify: `infrastructure/cdk/package.json` (add `tsx` devDependency)

**Interfaces:**
- Produces: `extractSql(modelText: string): string` and `validateReadOnly(input: string): { ok: boolean; sql?: string; error?: string }`. `validateReadOnly` returns `ok:true` with `sql` guaranteed to be a single statement that begins with `SELECT`/`WITH` and contains a `LIMIT`.

- [ ] **Step 1: Add the `tsx` test runner**

In `infrastructure/cdk/package.json`, add to `devDependencies`: `"tsx": "^4.19.0"`. Then:
```bash
cd infrastructure/cdk && npm install && cd -
```

- [ ] **Step 2: Write the failing test**

`infrastructure/cdk/lambda/sql-guard.test.ts`:
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSql, validateReadOnly } from './sql-guard';

test('extractSql pulls SQL out of a fenced code block', () => {
  assert.equal(extractSql('Here:\n```sql\nSELECT 1\n```'), 'SELECT 1');
});

test('extractSql trims a trailing semicolon and whitespace', () => {
  assert.equal(extractSql('  SELECT 1 ;  '), 'SELECT 1');
});

test('appends LIMIT 100 when none is present', () => {
  const r = validateReadOnly('SELECT * FROM film');
  assert.equal(r.ok, true);
  assert.match(r.sql!, /LIMIT 100$/);
});

test('keeps an existing LIMIT', () => {
  const r = validateReadOnly('SELECT * FROM film LIMIT 5');
  assert.equal(r.sql, 'SELECT * FROM film LIMIT 5');
});

test('allows a WITH (CTE) query', () => {
  assert.equal(validateReadOnly('WITH x AS (SELECT 1) SELECT * FROM x').ok, true);
});

test('rejects DELETE', () => {
  assert.equal(validateReadOnly('DELETE FROM customer').ok, false);
});

test('rejects stacked statements', () => {
  assert.equal(validateReadOnly('SELECT 1; DROP TABLE film').ok, false);
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd infrastructure/cdk && npx tsx --test lambda/sql-guard.test.ts; cd -`
Expected: FAIL — cannot find module `./sql-guard`.

- [ ] **Step 4: Implement the guard**

`infrastructure/cdk/lambda/sql-guard.ts`:
```typescript
export interface GuardResult {
  ok: boolean;
  sql?: string;
  error?: string;
}

// Reject anything that can write or run a second statement. Intentionally
// conservative for a training sandbox.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do|vacuum|reindex|comment|begin|commit|rollback)\b/i;

/** Pull SQL from a ```sql fenced block if present, else the whole text; drop a trailing ';'. */
export function extractSql(modelText: string): string {
  const fence = modelText.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const raw = (fence ? fence[1] : modelText).trim();
  return raw.replace(/;\s*$/, '').trim();
}

/** Validate the model output is a single read-only SELECT/WITH and ensure a LIMIT. */
export function validateReadOnly(input: string): GuardResult {
  const sql = extractSql(input);
  if (!sql) return { ok: false, error: 'No SQL was generated.' };
  if (sql.includes(';')) return { ok: false, error: 'Only a single statement is allowed.' };
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, error: 'Only read-only SELECT queries are allowed.' };
  }
  if (FORBIDDEN.test(sql)) {
    return { ok: false, error: 'Only read-only SELECT queries are allowed.' };
  }
  const limited = /\blimit\b/i.test(sql) ? sql : `${sql} LIMIT 100`;
  return { ok: true, sql: limited };
}
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `cd infrastructure/cdk && npx tsx --test lambda/sql-guard.test.ts; cd -`
Expected: all 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/cdk/lambda/sql-guard.ts infrastructure/cdk/lambda/sql-guard.test.ts infrastructure/cdk/package.json infrastructure/cdk/package-lock.json
git commit -m "feat(ask): read-only SQL guard with tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Schema context + ask-handler

**Files:**
- Create: `infrastructure/cdk/lambda/pagila-schema-context.ts`
- Create: `infrastructure/cdk/lambda/ask-handler.ts`

**Interfaces:**
- Consumes: `validateReadOnly` from `./sql-guard` (Task 1); env vars `BEDROCK_MODEL_ID`, `QUERY_FUNCTION_NAME`, `AWS_REGION`; the query Lambda contract from Global Constraints.
- Produces: `handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>` returning JSON `{prompt, sql?, columns?, rows?, explanation?, error?}`.

- [ ] **Step 1: Write the schema context**

`infrastructure/cdk/lambda/pagila-schema-context.ts`:
```typescript
/** Curated Pagila schema reference used as the Bedrock system prompt. */
export const PAGILA_SCHEMA = `Tables (PostgreSQL, schema "public"):
actor(actor_id PK, first_name, last_name, last_update)
film(film_id PK, title, description, release_year, language_id FK->language, original_language_id FK->language,
     rental_duration, rental_rate numeric, length int, replacement_cost numeric, rating mpaa_rating ENUM('G','PG','PG-13','R','NC-17'),
     last_update, special_features text[], fulltext tsvector)
film_actor(actor_id FK->actor, film_id FK->film, PK(actor_id,film_id))
category(category_id PK, name, last_update)
film_category(film_id FK->film, category_id FK->category, PK(film_id,category_id))
language(language_id PK, name, last_update)
inventory(inventory_id PK, film_id FK->film, store_id FK->store, last_update)
rental(rental_id PK, rental_date timestamptz, inventory_id FK->inventory, customer_id FK->customer,
       return_date timestamptz, staff_id FK->staff, last_update)
payment(payment_id, customer_id FK->customer, staff_id FK->staff, rental_id FK->rental, amount numeric,
        payment_date timestamptz)  -- PARTITIONED by payment_date (monthly partitions payment_p2022_01..07)
customer(customer_id PK, store_id FK->store, first_name, last_name, email, address_id FK->address,
         activebool boolean, active int, create_date, last_update)
address(address_id PK, address, address2, district, city_id FK->city, postal_code, phone, last_update)
city(city_id PK, city, country_id FK->country, last_update)
country(country_id PK, country, last_update)
store(store_id PK, manager_staff_id FK->staff, address_id FK->address, last_update)
staff(staff_id PK, first_name, last_name, address_id FK->address, email, store_id FK->store, active boolean,
      username, last_update)
packages_apt_postgresql_org(id PK, last_updated timestamp, aptdata jsonb)  -- JSONB; aptdata has keys like "Package","Version","Size"
packages_yum_postgresql_org(id PK, last_updated timestamp, yumdata jsonb)  -- JSONB; yumdata has keys like "name","version","size"

Views: film_list, customer_list, actor_info, nicer_but_slower_film_list, sales_by_store, sales_by_film_category.
Functions: film_in_stock(film_id,store_id), inventory_in_stock(inventory_id), get_customer_balance(customer_id, ts).

Notes:
- Full-text search on films uses the tsvector column: WHERE fulltext @@ to_tsquery('english','word').
- mpaa_rating is an enum; compare as text if needed.
- For JSONB, extract fields with ->> e.g. aptdata->>'Package'.
- Customer "active" status: activebool (boolean).`;
```

- [ ] **Step 2: Verify it compiles/bundles**

Run: `cd infrastructure/cdk && npx esbuild lambda/pagila-schema-context.ts --bundle --platform=node --outfile=/dev/null && echo OK; cd -`
Expected: `OK`.

- [ ] **Step 3: Write the ask-handler**

`infrastructure/cdk/lambda/ask-handler.ts`:
```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { validateReadOnly } from './sql-guard';
import { PAGILA_SCHEMA } from './pagila-schema-context';

const region = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID as string;
const QUERY_FN = process.env.QUERY_FUNCTION_NAME as string;
const bedrock = new BedrockRuntimeClient({ region });
const lambda = new LambdaClient({ region });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resp = (statusCode: number, body: object): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(body),
});

async function converse(system: string, user: string, maxTokens: number, temperature: number): Promise<string> {
  const out = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens, temperature },
    }),
  );
  return out.output?.message?.content?.[0]?.text?.trim() ?? '';
}

async function runSql(sql: string): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }> {
  const out = await lambda.send(
    new InvokeCommand({
      FunctionName: QUERY_FN,
      Payload: Buffer.from(JSON.stringify({ body: JSON.stringify({ query: sql }) })),
    }),
  );
  const envelope = JSON.parse(Buffer.from(out.Payload as Uint8Array).toString()); // { statusCode, body }
  return JSON.parse(envelope.body); // { success, rows, count, error }
}

const SQL_SYSTEM = `You convert a natural-language question into ONE read-only PostgreSQL query for the Pagila database.
Output ONLY the SQL inside a \`\`\`sql code block. Exactly one statement. SELECT or WITH only — never modify data.
Prefer explicit column lists and add a sensible LIMIT.

Schema:
${PAGILA_SCHEMA}`;

const EXPLAIN_SYSTEM =
  'You explain SQL query results to someone learning SQL, in 1-3 plain-English sentences. Be concise and specific about what the data shows. Do not restate the SQL.';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === 'OPTIONS') return resp(200, { ok: true });

  let prompt = '';
  try {
    prompt = String(JSON.parse(event.body || '{}').prompt || '').trim();
  } catch {
    /* fall through to validation below */
  }
  if (!prompt) return resp(400, { error: 'Provide a "prompt" in the request body.' });

  try {
    const generated = await converse(SQL_SYSTEM, prompt, 400, 0);
    const guard = validateReadOnly(generated);
    if (!guard.ok) return resp(200, { prompt, sql: generated, error: guard.error });
    const sql = guard.sql as string;

    const result = await runSql(sql);
    if (!result.success) return resp(200, { prompt, sql, error: `Database error: ${result.error ?? 'unknown'}` });

    const rows = result.rows ?? [];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const explanation = await converse(
      EXPLAIN_SYSTEM,
      `Question: ${prompt}\nColumns: ${columns.join(', ')}\nRows (up to 20): ${JSON.stringify(
        rows.slice(0, 20),
      )}\nTotal rows: ${rows.length}`,
      300,
      0.3,
    );

    return resp(200, { prompt, sql, columns, rows, explanation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return resp(200, { prompt, error: `Sorry, something went wrong: ${msg}` });
  }
};

export default handler;
```

- [ ] **Step 4: Verify it bundles (esbuild, the same bundler CDK uses)**

Run: `cd infrastructure/cdk && npx esbuild lambda/ask-handler.ts --bundle --platform=node --target=node20 --external:@aws-sdk/* --outfile=/dev/null && echo OK; cd -`
Expected: `OK` (no unresolved imports / type-free bundle errors).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/cdk/lambda/pagila-schema-context.ts infrastructure/cdk/lambda/ask-handler.ts
git commit -m "feat(ask): Bedrock NL->SQL orchestrator + curated Pagila schema context

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: CDK — ask Lambda, /ask route, Bedrock IAM

**Files:**
- Modify: `infrastructure/cdk/lib/pagila-stack.ts`

**Interfaces:**
- Consumes: existing `api` (`PagilaAPI`), `queryFunction`, `apigateway`, `lambda`, `iam`, `logs`, `path`, `NodejsFunction` already in scope; `this.account`.
- Produces: `askFunction` (NodejsFunction, no VPC) wired to `POST /ask`; output `AskEndpoint`.

- [ ] **Step 1: Add a `bedrockModelId` config constant**

In the config section near the other `const ... tryGetContext(...)` lines, add:
```typescript
    const bedrockModelId =
      this.node.tryGetContext('bedrockModelId') ?? 'anthropic.claude-haiku-4-5';
```

- [ ] **Step 2: Add the ask Lambda + route + IAM**

Immediately after the `api.root.addResource('query')...addMethod('POST', ...)` line, add:
```typescript
    // ---- NL -> SQL "ask" Lambda (outside the VPC; reaches Bedrock + invokes query Lambda) ----
    const askFunction = new NodejsFunction(this, 'PagilaAskFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'ask-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(28), // under the API Gateway 29s ceiling
      memorySize: 256,
      environment: {
        BEDROCK_MODEL_ID: bedrockModelId,
        QUERY_FUNCTION_NAME: queryFunction.functionName,
      },
      bundling: { minify: true, target: 'node20', externalModules: ['@aws-sdk/*'] },
      logGroup: new logs.LogGroup(this, 'PagilaAskFunctionLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      description: 'NL -> SQL orchestrator (Bedrock Converse + invokes the query Lambda)',
    });
    queryFunction.grantInvoke(askFunction);
    askFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/anthropic.*',
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }),
    );
    api.root.addResource('ask').addMethod('POST', new apigateway.LambdaIntegration(askFunction, { proxy: true }));

    new cdk.CfnOutput(this, 'AskEndpoint', {
      value: `${api.url}ask`,
      description: 'NL query endpoint (POST {prompt})',
    });
```

- [ ] **Step 3: Synthesize and verify**

Run:
```bash
cd infrastructure/cdk && npx cdk synth --quiet >/dev/null 2>/tmp/synth.err; echo "EXIT=$?"; cd -
grep -iE "error|cannot find" /tmp/synth.err | grep -vi "feature flags" || echo "(no errors)"
python3 - <<'PY'
import json
t = json.load(open('infrastructure/cdk/cdk.out/PagilaStack.template.json'))
R = t['Resources']
ask = [k for k, v in R.items()
       if v['Type'] == 'AWS::Lambda::Function'
       and 'Ask' in k and 'VpcConfig' not in v['Properties']]
assert ask, "ask Lambda missing or wrongly VPC-attached"
methods = [v for v in R.values() if v['Type'] == 'AWS::ApiGateway::Method'
           and v['Properties'].get('HttpMethod') == 'POST']
resources = [v['Properties'].get('PathPart') for v in R.values()
             if v['Type'] == 'AWS::ApiGateway::Resource']
assert 'ask' in resources, f"/ask resource missing; have {resources}"
policies = json.dumps(t)
assert 'bedrock:InvokeModel' in policies, "bedrock:InvokeModel policy missing"
print("OK: ask Lambda (no VPC), /ask POST route, bedrock:InvokeModel present")
PY
```
Expected: `EXIT=0`, `(no errors)`, `OK: ...`.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/cdk/lib/pagila-stack.ts
git commit -m "feat(cdk): ask Lambda (Bedrock) + POST /ask route + IAM

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Frontend page

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/app.js`
- Create: `frontend/styles.css`
- Create: `frontend/app.test.js`

**Interfaces:**
- Produces: `formatTable(columns: string[], rows: object[]): string` (terminal-style table) exported from `app.js` under Node for testing; browser wiring runs only when `document` exists. Reads `window.PAGILA_API` (set by the deploy-time `config.js`).

- [ ] **Step 1: Write the failing test**

`frontend/app.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatTable } = require('./app.js');

test('renders header, separator, rows and a row count', () => {
  const out = formatTable(['id', 'name'], [{ id: 1, name: 'a' }, { id: 2, name: 'bb' }]);
  assert.match(out, /id\s+\|\s+name/);
  assert.match(out, /\(2 rows\)/);
});

test('pads columns to align', () => {
  const out = formatTable(['n'], [{ n: 'x' }, { n: 'yyyy' }]);
  // header "n" padded to width of "yyyy"
  assert.match(out, /^n {3}/m);
});

test('handles no columns', () => {
  assert.equal(formatTable([], []), '(0 rows)');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test frontend/app.test.js`
Expected: FAIL — cannot find module `./app.js`.

- [ ] **Step 3: Write `app.js`**

`frontend/app.js`:
```javascript
// ---- pure: terminal-style table (psql-like) ----
function formatTable(columns, rows) {
  if (!columns.length) return '(0 rows)';
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length), 0),
  );
  const line = (cells) => cells.map((v, i) => String(v).padEnd(widths[i])).join(' | ');
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const body = rows.map((r) => line(columns.map((c) => (r[c] ?? '').toString())));
  const count = `(${rows.length} row${rows.length === 1 ? '' : 's'})`;
  return [line(columns), sep, ...body, '', count].join('\n');
}

// ---- example prompts (each tagged with the data it searches) ----
const EXAMPLES = [
  ['Which actors appear in the most films?', 'actor · film_actor · film'],
  ['Show the 5 longest films with their length and rating', 'film · length · mpaa_rating enum'],
  ['How many films are in each category?', 'category · film_category'],
  ['How many films are available in each language?', 'language · film'],
  ['How many copies of "ACADEMY DINOSAUR" are at each store?', 'inventory · store · film'],
  ['Which films are rented out right now and not yet returned?', 'rental · inventory (timestamps)'],
  ['Which 5 customers have spent the most, and how much?', 'payment · customer (money)'],
  ['How many active vs inactive customers are there?', 'customer (boolean active)'],
  ['List customers located in Canada', 'customer · address · city · country'],
  ['Total revenue per store, and the staff who processed it', 'store · staff · payment'],
  ['How many films have each MPAA rating (G, PG, R, …)?', 'film.rating (enum)'],
  ['Find films whose description mentions "astronaut"', 'film.fulltext (full-text search)'],
  ['How many rentals happened per month?', 'rental.rental_date (date series)'],
  ['Average rental rate and replacement cost by rating', 'film (numeric aggregates)'],
  ['Show 10 rows from the film_list view', 'film_list (view)'],
  ['How many apt packages are recorded, and list 5 of their names?', 'packages_apt… (jsonb)'],
  ['Show the 5 most recently updated yum packages', 'packages_yum… (jsonb)'],
];

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);

  function renderExamples() {
    const grid = $('examples');
    EXAMPLES.forEach(([q, tag]) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.innerHTML = `<span class="chip-q"></span><span class="chip-tag"></span>`;
      chip.querySelector('.chip-q').textContent = q;
      chip.querySelector('.chip-tag').textContent = tag;
      chip.addEventListener('click', () => {
        $('prompt').value = q;
        $('prompt').focus();
      });
      grid.appendChild(chip);
    });
  }

  function show(el, on) {
    el.style.display = on ? '' : 'none';
  }

  async function run() {
    const prompt = $('prompt').value.trim();
    if (!prompt) return;
    const out = $('output');
    show(out, true);
    $('req').textContent = prompt;
    $('sql').textContent = '…';
    $('table').textContent = '';
    $('explain').textContent = 'Thinking…';
    $('runBtn').disabled = true;
    try {
      const res = await fetch(window.PAGILA_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      $('sql').textContent = data.sql || '(none)';
      if (data.error) {
        $('table').textContent = '';
        $('explain').textContent = data.error;
      } else {
        $('table').textContent = formatTable(data.columns || [], data.rows || []);
        $('explain').textContent = data.explanation || '';
      }
    } catch (e) {
      $('explain').textContent =
        'Database is waking up or the request timed out — please try again in a few seconds.';
    } finally {
      $('runBtn').disabled = false;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    renderExamples();
    $('runBtn').addEventListener('click', run);
    $('prompt').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
    });
  });
}

if (typeof module !== 'undefined') module.exports = { formatTable };
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `node --test frontend/app.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Write `index.html`**

`frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pagila — Ask the database</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <h1>Ask the Pagila database</h1>
      <p>Type a question in plain English. It becomes a read-only SQL query, runs, and the results come back like a terminal — with an explanation.</p>
    </header>

    <section class="ask">
      <textarea id="prompt" rows="3" placeholder="e.g. Which 5 customers have spent the most?"></textarea>
      <button id="runBtn">Run</button>
      <p class="hint">⌘/Ctrl + Enter to run. Try an example:</p>
      <div id="examples" class="examples"></div>
    </section>

    <section id="output" class="output" style="display:none">
      <h2>Your request</h2>
      <p id="req" class="req"></p>
      <h2>SQL</h2>
      <pre id="sql" class="code"></pre>
      <h2>Result</h2>
      <pre id="table" class="terminal"></pre>
      <h2>Explanation</h2>
      <p id="explain" class="explain"></p>
    </section>

    <script src="config.js"></script>
    <script src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `styles.css`**

`frontend/styles.css`:
```css
:root { --bg:#0f1419; --panel:#1b2530; --ink:#e7edf3; --muted:#94a7b8; --accent:#3aa0ff; --term-bg:#0b0f14; }
* { box-sizing: border-box; }
body { margin:0; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:var(--bg); color:var(--ink); line-height:1.5; }
header, .ask, .output { max-width: 980px; margin: 0 auto; padding: 0 20px; }
header { padding-top: 32px; }
h1 { margin: 0 0 6px; }
header p { color: var(--muted); margin-top: 0; }
.ask { margin-top: 16px; }
textarea { width:100%; background:var(--panel); color:var(--ink); border:1px solid #2c3a48; border-radius:8px; padding:12px; font-size:16px; resize:vertical; }
#runBtn { margin-top:10px; background:var(--accent); color:#04121f; border:0; border-radius:8px; padding:10px 18px; font-weight:600; font-size:15px; cursor:pointer; }
#runBtn:disabled { opacity:.6; cursor:progress; }
.hint { color:var(--muted); font-size:14px; margin:16px 0 8px; }
.examples { display:grid; grid-template-columns: repeat(auto-fill, minmax(260px,1fr)); gap:10px; }
.chip { text-align:left; background:var(--panel); border:1px solid #2c3a48; border-radius:8px; padding:10px 12px; color:var(--ink); cursor:pointer; }
.chip:hover { border-color:var(--accent); }
.chip-q { display:block; font-size:14px; }
.chip-tag { display:block; color:var(--muted); font-size:12px; margin-top:4px; }
.output { padding-bottom: 60px; }
.output h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:22px 0 6px; }
.req { font-size:16px; }
.code, .terminal { background:var(--term-bg); border:1px solid #1f2a36; border-radius:8px; padding:14px; overflow:auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:13px; white-space:pre; }
.terminal { color:#c8f7c5; }
.explain { background:var(--panel); border-radius:8px; padding:12px 14px; }
```

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): NL query page (terminal-style results, annotated examples)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: CDK — S3 + CloudFront static site

**Files:**
- Modify: `infrastructure/cdk/lib/pagila-stack.ts`

**Interfaces:**
- Consumes: `api` (for the `/ask` URL), `path`, `cdk`; new imports for s3 / cloudfront / origins / s3deploy; the `frontend/` directory from Task 4.
- Produces: a private S3 bucket served via CloudFront (OAC); output `SiteURL`. `config.js` (generated) sets `window.PAGILA_API` to `<api.url>ask`.

- [ ] **Step 1: Add imports**

At the top of `infrastructure/cdk/lib/pagila-stack.ts`, add:
```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
```

- [ ] **Step 2: Add the static site (after the `AskEndpoint` output from Task 3)**

```typescript
    // ---- Static frontend: private S3 bucket served via CloudFront ----
    const siteBucket = new s3.Bucket(this, 'PagilaSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'PagilaSiteDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    new s3deploy.BucketDeployment(this, 'PagilaSiteDeployment', {
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'frontend')),
        s3deploy.Source.data('config.js', `window.PAGILA_API=${JSON.stringify(`${api.url}ask`)};`),
      ],
    });

    new cdk.CfnOutput(this, 'SiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Pagila natural-language query frontend',
    });
```

- [ ] **Step 3: Synthesize and verify**

Run:
```bash
cd infrastructure/cdk && npx cdk synth --quiet >/dev/null 2>/tmp/synth.err; echo "EXIT=$?"; cd -
grep -iE "error|cannot find" /tmp/synth.err | grep -vi "feature flags" || echo "(no errors)"
python3 - <<'PY'
import json
t = json.load(open('infrastructure/cdk/cdk.out/PagilaStack.template.json'))
types = [v['Type'] for v in t['Resources'].values()]
assert 'AWS::CloudFront::Distribution' in types, "CloudFront distribution missing"
assert 'AWS::S3::Bucket' in types, "site bucket missing"
assert any('Custom::CDKBucketDeployment' in x for x in types), "BucketDeployment missing"
print("OK: S3 bucket + CloudFront distribution + BucketDeployment present")
PY
```
Expected: `EXIT=0`, `(no errors)`, `OK: ...`.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/cdk/lib/pagila-stack.ts
git commit -m "feat(cdk): S3 + CloudFront static site for the NL query page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Post-deploy smoke test

**Files:**
- Create: `tests/ask-smoke-test.py`

**Interfaces:**
- Consumes: env var `ASK_ENDPOINT` (the `AskEndpoint` stack output, e.g. `https://…/prod/ask`).
- Produces: exit 0 if `/ask` returns SQL + rows + explanation for a normal question and refuses a destructive one.

- [ ] **Step 1: Write the smoke test**

`tests/ask-smoke-test.py`:
```python
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
```

- [ ] **Step 2: Verify it compiles**

Run: `python3 -m py_compile tests/ask-smoke-test.py && echo OK`
Expected: `OK`. (It cannot run until the stack is deployed; that is a post-deploy step.)

- [ ] **Step 3: Commit**

```bash
git add tests/ask-smoke-test.py
git commit -m "test(ask): post-deploy smoke test for /ask

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deploy & verify (after all tasks)

```bash
# Enable Bedrock model access for the chosen model in the console first.
cd infrastructure/cdk
npx cdk deploy            # builds the seeder image + ask bundle, deploys, seeds
# Note the SiteURL and AskEndpoint outputs.
ASK_ENDPOINT=<AskEndpoint output> python3 ../../tests/ask-smoke-test.py
# Open SiteURL in a browser and click through the example chips.
```

---

## Self-Review

**Spec coverage:**
- Frontend (S3+CloudFront, request/SQL/terminal-results/explanation, annotated examples) → Tasks 4, 5. ✓
- Orchestrator outside VPC, Bedrock Converse ×2, invoke query Lambda, response shape → Task 2. ✓
- Read-only guard + LIMIT → Task 1 (used in Task 2). ✓
- Curated schema incl. JSONB tables → Task 2 Step 1. ✓
- CDK: ask Lambda (no VPC), `/ask`, bedrock IAM, grantInvoke, `bedrockModelId` context, S3+CloudFront, outputs → Tasks 3, 5. ✓
- 17 examples incl. JSONB (16–17) → Task 4 `EXAMPLES`. ✓
- Error handling (Bedrock fail, non-SELECT, DB error, 29s retry message) → Task 2 handler + Task 4 `catch`. ✓
- Testing (smoke test + synth assertions) → Tasks 3, 5, 6; guard/table unit tests → Tasks 1, 4. ✓
- Known 29s limitation surfaced to the user → Task 4 `catch` message. ✓

**Placeholder scan:** none — every file's full content and every command is inline. ✓

**Type consistency:** `validateReadOnly` returns `{ok, sql?, error?}` (Task 1) and is consumed exactly that way in Task 2; the handler response keys `{prompt, sql, columns, rows, explanation, error}` match what `app.js` reads (Task 4) and what the smoke test asserts (Task 6); `formatTable(columns, rows)` signature matches its test and its caller. ✓
