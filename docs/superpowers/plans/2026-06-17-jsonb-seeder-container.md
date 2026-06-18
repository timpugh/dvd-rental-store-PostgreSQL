# JSONB Seeder (Container Image) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the zip-based Pagila seeder Lambda with a container-image Lambda that carries `psql` + `pg_restore`, so it can load the relational schema/data AND the two JSONB tables (whose data only ships as `pg_restore` custom-format archives).

**Architecture:** A `DockerImageFunction` (Python base + PostgreSQL client) runs as the existing CloudFormation custom resource inside the VPC. On invoke it reads the DB secret, then runs `psql -f` for the schema + COPY-based relational data and `pg_restore --no-owner --data-only` for each JSONB archive. Idempotent: each group is skipped if its table already has rows.

**Tech Stack:** AWS CDK (TypeScript), `aws-cdk-lib` Docker image assets, AWS Lambda container images (`public.ecr.aws/lambda/python:3.12`), PostgreSQL 15 client, Python 3.12 (stdlib + boto3), `cr.Provider` custom resource.

## Global Constraints

- Region `us-east-1`; everything stays in the existing single isolated subnet (`singleAzSubnets`) with the `lambdaSecurityGroup` (already reaches Aurora 5432 and the Secrets Manager interface endpoint).
- Aurora is **private** Serverless v2 (`pagila`, engine 16.x); the seeder is the only loader.
- No NAT gateway exists — the container's `dnf install` happens at **image build time** (has internet), not at runtime.
- Idempotency is mandatory: re-running the custom resource must not duplicate data.
- `cdk synth` builds Docker image assets, so Docker must be running; synth is slower as a result.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Seeder container (handler + Dockerfile)

**Files:**
- Create: `infrastructure/cdk/seeder/handler.py`
- Create: `infrastructure/cdk/seeder/Dockerfile`
- Create: `infrastructure/cdk/seeder/test_handler.py`
- Create: `.dockerignore` (repo root)

**Interfaces:**
- Produces: `handler.on_event(event, context) -> {"PhysicalResourceId": str, "Data"?: {...}}` (CloudFormation custom-resource onEvent contract) and the pure helper `handler.plan_steps(film_loaded: bool, apt_loaded: bool, yum_loaded: bool) -> list[str]` returning a subset/order of `["schema","schema_jsonb","data","apt","yum"]`.
- Consumes: env vars `DB_SECRET_NAME` (secret ARN), `DB_HOST`, `DB_PORT`, `DB_NAME`; seed files copied to `LAMBDA_TASK_ROOT`.

- [ ] **Step 1: Write the failing test**

`infrastructure/cdk/seeder/test_handler.py`:
```python
import os, sys, unittest

sys.path.insert(0, os.path.dirname(__file__))
from handler import plan_steps  # boto3 must NOT be imported at module top


class PlanStepsTest(unittest.TestCase):
    def test_fresh_database_runs_everything_in_order(self):
        self.assertEqual(
            plan_steps(False, False, False),
            ["schema", "schema_jsonb", "data", "apt", "yum"],
        )

    def test_fully_seeded_does_nothing(self):
        self.assertEqual(plan_steps(True, True, True), [])

    def test_relational_done_but_jsonb_missing(self):
        self.assertEqual(plan_steps(True, False, False), ["apt", "yum"])

    def test_only_yum_missing(self):
        self.assertEqual(plan_steps(True, True, False), ["yum"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `python3 -m unittest infrastructure.cdk.seeder.test_handler` (or `cd infrastructure/cdk/seeder && python3 -m unittest test_handler`)
Expected: FAIL — `ModuleNotFoundError: No module named 'handler'`.

- [ ] **Step 3: Write the handler**

`infrastructure/cdk/seeder/handler.py`:
```python
"""Pagila seeder - CloudFormation custom-resource handler (container image).

Loads the relational schema + COPY data with psql, and the two JSONB tables with
pg_restore (their data ships only as pg_restore custom-format archives). Runs in
the VPC as the seeder Lambda. Idempotent: each group is skipped if its table
already has rows. boto3 is imported lazily so the pure plan_steps() is unit
testable without AWS deps.
"""
import json
import os
import subprocess

SEED_DIR = os.environ.get("LAMBDA_TASK_ROOT", "/var/task")

# step -> argv builder (paths resolved at call time)
_PSQL_FILES = {
    "schema": "pagila-schema.sql",
    "schema_jsonb": "pagila-schema-jsonb.sql",
    "data": "pagila-data.sql",
}
_RESTORE_FILES = {
    "apt": "pagila-data-apt-jsonb.backup",
    "yum": "pagila-data-yum-jsonb.backup",
}


def plan_steps(film_loaded, apt_loaded, yum_loaded):
    """Decide which load steps to run, in dependency order."""
    steps = []
    if not film_loaded:
        steps += ["schema", "schema_jsonb", "data"]
    if not apt_loaded:
        steps.append("apt")
    if not yum_loaded:
        steps.append("yum")
    return steps


def _credentials():
    import boto3  # lazy: keeps plan_steps import-safe without AWS deps
    secret = boto3.client("secretsmanager").get_secret_value(
        SecretId=os.environ["DB_SECRET_NAME"]
    )["SecretString"]
    s = json.loads(secret)
    return {
        "host": s.get("host") or os.environ["DB_HOST"],
        "port": str(s.get("port") or os.environ.get("DB_PORT", "5432")),
        "dbname": s.get("dbname") or os.environ.get("DB_NAME", "pagila"),
        "user": s["username"],
        "password": s["password"],
    }


def _pgenv(creds):
    env = dict(os.environ)
    env.update(
        PGHOST=creds["host"],
        PGPORT=creds["port"],
        PGDATABASE=creds["dbname"],
        PGUSER=creds["user"],
        PGPASSWORD=creds["password"],
        PGCONNECT_TIMEOUT="30",
    )
    return env


def _scalar(env, sql):
    out = subprocess.run(
        ["psql", "-tAqc", sql], env=env, capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


def _table_has_rows(env, regclass):
    if _scalar(env, f"SELECT to_regclass('{regclass}') IS NOT NULL") != "t":
        return False
    return int(_scalar(env, f"SELECT count(*) FROM {regclass}")) > 0


def _run_step(env, step):
    path = os.path.join(SEED_DIR, (_PSQL_FILES.get(step) or _RESTORE_FILES[step]))
    if step in _PSQL_FILES:
        subprocess.run(
            ["psql", "-v", "ON_ERROR_STOP=1", "-f", path], env=env, check=True
        )
    else:
        subprocess.run(
            ["pg_restore", "--no-owner", "--data-only", "-d", env["PGDATABASE"], path],
            env=env,
            check=True,
        )


def on_event(event, context):
    request_type = event.get("RequestType")
    physical_id = event.get("PhysicalResourceId") or "pagila-seed"
    if request_type == "Delete":
        return {"PhysicalResourceId": physical_id}

    env = _pgenv(_credentials())
    steps = plan_steps(
        _table_has_rows(env, "public.film"),
        _table_has_rows(env, "public.packages_apt_postgresql_org"),
        _table_has_rows(env, "public.packages_yum_postgresql_org"),
    )
    print(f"Seed steps: {steps or 'none (already seeded)'}")
    for step in steps:
        print(f"Running step: {step}")
        _run_step(env, step)
    return {"PhysicalResourceId": physical_id, "Data": {"steps": ",".join(steps) or "skipped"}}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `cd infrastructure/cdk/seeder && python3 -m unittest test_handler -v && cd -`
Expected: `Ran 4 tests` ... `OK`.

- [ ] **Step 5: Write the Dockerfile**

`infrastructure/cdk/seeder/Dockerfile` (build context is the **repo root**):
```dockerfile
FROM public.ecr.aws/lambda/python:3.12

# PostgreSQL client (psql, pg_restore). postgresql15 is in the AL2023 repos;
# if unavailable in your build, swap to postgresql16.
RUN dnf install -y postgresql15 && dnf clean all

# boto3 is preinstalled in the Lambda Python base image.

# Seed files + handler (paths are relative to the repo-root build context)
WORKDIR ${LAMBDA_TASK_ROOT}
COPY pagila-schema.sql pagila-schema-jsonb.sql pagila-data.sql ./
COPY pagila-data-apt-jsonb.backup pagila-data-yum-jsonb.backup ./
COPY infrastructure/cdk/seeder/handler.py ./

CMD ["handler.on_event"]
```

- [ ] **Step 6: Create `.dockerignore` (repo root)**

Keeps the build context small/fast and out of the image:
```
infrastructure/cdk/node_modules
infrastructure/cdk/cdk.out
infrastructure/cdk/dist
.git
docs
pgadmin
*.png
```

- [ ] **Step 7: Build the image and verify the tools are present**

Run (from repo root):
```bash
docker build -f infrastructure/cdk/seeder/Dockerfile -t pagila-seeder-test .
docker run --rm --entrypoint psql pagila-seeder-test --version
docker run --rm --entrypoint pg_restore pagila-seeder-test --version
```
Expected: build succeeds; `psql (PostgreSQL) 15.x` and `pg_restore (PostgreSQL) 15.x`.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/cdk/seeder/ .dockerignore
git commit -m "feat(seeder): container image with psql + pg_restore and idempotent step planner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire the container seeder into the CDK stack

**Files:**
- Modify: `infrastructure/cdk/lib/pagila-stack.ts` (the `3b. ONE-TIME DATABASE SEEDER` block)
- Delete: `infrastructure/cdk/lambda/seed-handler.ts`

**Interfaces:**
- Consumes: existing `vpc`, `singleAzSubnets`, `lambdaSecurityGroup`, `dbCluster`, `dbSecret`, `secretsEndpoint`, `logs`, `cr`, `path` already in scope in `pagila-stack.ts`.
- Produces: a `lambda.DockerImageFunction` seeder behind the same `cr.Provider` + `cdk.CustomResource` (`PagilaSeed`).

- [ ] **Step 1: Replace the seeder definition**

In `infrastructure/cdk/lib/pagila-stack.ts`, replace the entire `seederFunction` `NodejsFunction({...})` declaration (the block starting `const repoRoot = ...` through the `description: 'One-time Pagila ...'` closing `});`) with:
```typescript
    const repoRoot = path.join(__dirname, '..', '..', '..');
    const seederFunction = new lambda.DockerImageFunction(this, 'PagilaSeeder', {
      code: lambda.DockerImageCode.fromImageAsset(repoRoot, {
        file: 'infrastructure/cdk/seeder/Dockerfile',
        exclude: [
          'infrastructure/cdk/node_modules',
          'infrastructure/cdk/cdk.out',
          'infrastructure/cdk/dist',
          '.git',
          'docs',
          'pgadmin',
        ],
      }),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      vpc,
      vpcSubnets: singleAzSubnets,
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_SECRET_NAME: dbSecret.secretArn,
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbPort.toString(),
        DB_NAME: dbName,
      },
      logGroup: new logs.LogGroup(this, 'PagilaSeederLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      description: 'One-time Pagila seeder (container: psql + pg_restore, incl. JSONB)',
    });
```
Leave the lines that follow unchanged: `dbSecret.grantRead(seederFunction);`, the `cr.Provider` (`PagilaSeederProvider`, `onEventHandler: seederFunction`), the `cdk.CustomResource` (`PagilaSeed`, `properties: { version: '1' }`), and both `seed.node.addDependency(...)` calls.

- [ ] **Step 2: Bump the seed version so the custom resource re-runs on deploy**

In the same file, change the `PagilaSeed` custom-resource property `version: '1'` to `version: '2'` (forces the now-JSONB-aware seeder to run on the next deploy; it remains idempotent).

- [ ] **Step 3: Delete the obsolete Node seeder handler**

```bash
git rm infrastructure/cdk/lambda/seed-handler.ts
```

- [ ] **Step 4: Synthesize and verify the seeder is now a container image**

Run (Docker must be running; this builds the image):
```bash
cd infrastructure/cdk && npx cdk synth --quiet >/dev/null 2>/tmp/synth.err; echo "EXIT=$?"; cd -
grep -iE "error|cannot find" /tmp/synth.err | grep -vi "feature flags" || echo "(no errors)"
python3 - <<'PY'
import json
t = json.load(open('infrastructure/cdk/cdk.out/PagilaStack.template.json'))
R = t['Resources']
seeders = [v for v in R.values()
           if v['Type'] == 'AWS::Lambda::Function'
           and v['Properties'].get('PackageType') == 'Image'
           and 'VpcConfig' in v['Properties']]
assert len(seeders) == 1, f"expected 1 image+VPC seeder, found {len(seeders)}"
assert any('Custom::' in v['Type'] or v['Type'] == 'AWS::CloudFormation::CustomResource'
           for v in R.values()), "custom resource missing"
print("OK: seeder is a container image (PackageType=Image), VPC-attached, custom resource present")
PY
```
Expected: `EXIT=0`, `(no errors)`, `OK: ...`.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/cdk/lib/pagila-stack.ts
git commit -m "feat(cdk): seeder as DockerImageFunction (loads JSONB via pg_restore)

Replaces the esbuild-zip NodejsFunction seeder; removes the obsolete
seed-handler.ts. Bumps the seed version to re-run the JSONB-aware loader.
Verified with cdk synth: PackageType=Image, VPC-attached, custom resource present.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** Spec §"Seeder change — load the JSONB tables (container image)" → Tasks 1–2 (Dockerfile with `psql`/`pg_restore`, `psql -f` for schema/COPY-data, `pg_restore --no-owner --data-only` per archive, idempotent skip-if-rows, stays the in-VPC custom resource). ✓
- **Placeholder scan:** none — full handler, Dockerfile, `.dockerignore`, CDK diff, and assertions are inline. ✓
- **Type consistency:** `plan_steps` step tokens (`schema`/`schema_jsonb`/`data`/`apt`/`yum`) match `_PSQL_FILES`/`_RESTORE_FILES` keys and `_run_step`; the test asserts the same tokens. ✓
