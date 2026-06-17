# Deployment Checklist (web-only Pagila)

## Prerequisites

- [ ] AWS account + AWS CLI configured (`aws sts get-caller-identity` works).
      See [infrastructure/aws-setup-guide.md](infrastructure/aws-setup-guide.md).
- [ ] Node.js 18+ and the AWS CDK (`npx cdk --version`).
- [ ] `jq` and `curl` (for the query helper / smoke test).

## Deploy

```bash
cd infrastructure/cdk
npm install
npx cdk bootstrap     # first time per account/region only
npx cdk deploy
```

- [ ] Deploy completes (~10–15 min). It provisions the VPC, the **private**
      Aurora Serverless v2 cluster, the Secrets Manager interface endpoint, the
      query Lambda, API Gateway, and the **seeder** custom resource.
- [ ] The seeder runs automatically and loads the schema + sample data — no
      manual init step.
- [ ] Note the stack outputs, especially **`APIEndpoint`**.

## Verify

```bash
cp .env.example .env          # set API_ENDPOINT to the APIEndpoint output
./scripts/query-api.sh "SELECT count(*) FROM film;"     # expect ~1000
python3 tests/integration-test.py                       # all checks PASS
```

- [ ] `film` count is ~1000, `rental`/`payment` are ~16k.
- [ ] (First call may take ~15–30s while Aurora resumes from auto-pause.)

## Operate

- **Re-seed:** the seeder is idempotent (skips if `film` already has rows). To
  force a reload, bump the `version` property on the `PagilaSeed` custom resource
  in [infrastructure/cdk/lib/pagila-stack.ts](infrastructure/cdk/lib/pagila-stack.ts)
  and redeploy.
- **Cost control:** Aurora auto-pauses at 0 ACU when idle. The single-AZ
  interface endpoint (~$7/mo) runs continuously.

## Tear down

```bash
cd infrastructure/cdk
npx cdk destroy
```

- [ ] Stack deleted. Aurora is removed with a final **snapshot**
      (`RemovalPolicy.SNAPSHOT`); delete that snapshot manually if you don't want
      to keep (or pay for) it.

## If deploy fails

- Read the failing resource in the CloudFormation events / `cdk deploy` output.
- `npx cdk destroy` to roll back, fix, and redeploy.
- Re-run `npx cdk synth` locally first — it catches most issues before any AWS
  calls are made.
