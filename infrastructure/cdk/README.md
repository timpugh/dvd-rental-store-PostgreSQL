# Pagila AWS CDK Infrastructure

TypeScript CDK app that deploys the **private, web-only** Pagila environment.

## What it creates

- **VPC** — two private *isolated* subnets, no NAT, no internet gateway.
- **Aurora PostgreSQL Serverless v2** — `VER_16_6`, scale-to-zero
  (`serverlessV2MinCapacity: 0`), **not** publicly accessible.
- **Secrets Manager interface VPC endpoint** — pinned to a single AZ so the
  in-VPC Lambdas can read DB credentials without a NAT gateway.
- **Query Lambda** (`lambda/query-handler.ts`) — bundled with esbuild
  (`NodejsFunction`), runs in the single pinned subnet, exposed via **API Gateway**
  `POST /query`.
- **Seeder Lambda** (`lambda/seed-handler.ts`) — a CloudFormation custom resource
  that loads the schema + `pagila-insert-data.sql` on deploy (idempotent).

Everything in the data path (both Lambdas + the endpoint) shares one AZ to avoid
cross-AZ charges. Aurora's subnet group still spans both AZs because RDS requires
it.

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

## Outputs

`APIEndpoint` (use this to query — see the root [USAGE_GUIDE.md](../../USAGE_GUIDE.md)),
`AuroraEndpoint` (private), and `DBSecretArn`.

## Notes

- The `/query` endpoint runs arbitrary SQL with no auth — fine for a personal
  sandbox, not for production. Add an authorizer before exposing it.
- JSONB sample data (`pagila-data-*-jsonb.backup`) is not loaded by the seeder;
  those tables are created empty (they need `pg_restore`).
