# Pagila AWS CDK Infrastructure

TypeScript CDK app that deploys the **private** Pagila environment plus a
natural-language query front end (a static web page → Amazon Bedrock → read-only
SQL).

## What it creates

- **VPC** — two private *isolated* subnets, no NAT, no internet gateway.
- **Aurora PostgreSQL Serverless v2** — `VER_16_6`, scale-to-zero
  (`serverlessV2MinCapacity: 0`), **not** publicly accessible.
- **Secrets Manager interface VPC endpoint** — pinned to a single AZ so the
  in-VPC Lambda can read DB credentials without a NAT gateway.
- **Query Lambda** (`lambda/query-handler.ts`) — bundled with esbuild
  (`NodejsFunction`), runs in the single pinned subnet, exposed via **API Gateway**
  `POST /query`.
- **Ask Lambda** (`lambda/ask-handler.ts`) — **outside the VPC**; calls **Amazon
  Bedrock** (Claude Haiku 4.5, see `bedrockModelId`) to turn a question into a
  guarded read-only `SELECT`/`WITH` (`lambda/sql-guard.ts`), invokes the Query
  Lambda to run it, then asks Bedrock to explain the results. Exposed via `POST /ask`.
- **Container-image seeder** (`seeder/`, a `DockerImageFunction` on ARM64) — a
  CloudFormation custom resource that runs `psql` + `pg_restore` to load the
  schema, `pagila-data.sql`, and the two JSONB tables on deploy (idempotent).
- **Static site** — an S3 bucket served through **CloudFront** (Origin Access
  Control), with `frontend/` deployed and a generated `config.js` pointing at the
  API. This is the `SiteURL` you open in a browser.

The in-VPC data path (Query Lambda + endpoint) shares one AZ to avoid cross-AZ
charges. Aurora's subnet group still spans both AZs because RDS requires it.

## Commands

```bash
npm install
npx cdk synth          # build + validate (no AWS calls)
npx cdk bootstrap --template bootstrap-template.yaml   # first time per account/region (see below)
npx cdk deploy         # deploy + auto-seed
npx cdk destroy        # tear down (no final snapshot — RemovalPolicy.DESTROY)
```

### Bootstrap with asset cleanup

[bootstrap-template.yaml](bootstrap-template.yaml) is the standard CDK bootstrap
template with two added lifecycle rules so deploy assets don't accumulate (and
keep billing) forever:

- **S3** staging bucket: expire current objects after 14 days, noncurrent versions
  after 1 day (the default only cleans noncurrent after 30 days, never current).
- **ECR** asset repo: expire images after 14 days, **including tagged** ones (the
  default only expires *untagged* images, which CDK never creates).

Bootstrap (or re-bootstrap) with `--template bootstrap-template.yaml` to keep these
rules; a plain `npx cdk bootstrap` would revert to the defaults. Account/region are
taken from your AWS CLI config, or pass `aws://<account>/<region>` explicitly.

## Context / configuration

Set in [cdk.json](cdk.json) or with `-c key=value`:

| key             | default      | meaning                                  |
| --------------- | ------------ | ---------------------------------------- |
| `vpcCidr`       | `10.0.0.0/16`| VPC CIDR                                 |
| `dbMinCapacity` | `0`          | Serverless v2 min ACU (0 = auto-pause)   |
| `dbMaxCapacity` | `2`          | Serverless v2 max ACU                    |
| `environment`   | `training`   | name tag / secret name suffix            |
| `bedrockModelId`| `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Bedrock inference profile for `/ask` |

## Outputs

- `SiteURL` — the CloudFront URL of the natural-language query page (open this).
- `AskEndpoint` — `POST /ask` (natural language → SQL → results + explanation).
- `APIEndpoint` — base API URL; `POST /query` runs raw SQL (see the root
  [USAGE_GUIDE.md](../../USAGE_GUIDE.md)).
- `AuroraEndpoint` (private), `AuroraPort`, `DatabaseName`, `DBSecretArn`.

## Notes

- The `/ask` and `/query` endpoints have no auth — fine for a personal sandbox,
  not for production. `/query` runs arbitrary SQL; `/ask` is constrained to
  guarded read-only statements. Add an authorizer before exposing either.
- Bedrock model access for Claude Haiku 4.5 must be enabled in the account/region,
  and the model id must be an inference profile (default
  `us.anthropic.claude-haiku-4-5-20251001-v1:0`).
- The seeder loads the relational data **and** the two JSONB tables
  (`pagila-data-*-jsonb.backup`, via `pg_restore`) on deploy.
