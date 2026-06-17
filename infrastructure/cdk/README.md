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
npx cdk bootstrap      # first time per account/region
npx cdk deploy         # deploy + auto-seed
npx cdk destroy        # tear down (Aurora leaves a final snapshot)
```

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
