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
