# Pagila AWS CDK - Quick Start Guide

Deploy the Pagila PostgreSQL database in 5 minutes.

## Prerequisites

```bash
# Verify all tools installed
aws sts get-caller-identity   # AWS credentials configured
node --version                # Node.js 18+
npm --version                 # npm installed
cdk --version                 # AWS CDK v2.130+
```

## One-Time Setup

```bash
# Bootstrap AWS environment (first time only)
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
cdk bootstrap aws://$AWS_ACCOUNT_ID/us-east-1
```

## Deploy (3 Commands)

```bash
# 1. Install dependencies
npm install && cd lambda && npm install && cd ..

# 2. Build TypeScript
npm run build

# 3. Deploy to AWS
npm run deploy
```

**That's it!** Stack will deploy in ~10 minutes.

## Get Connection Details

```bash
# View all outputs
npm run synth
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs' \
  --output table

# Or just get database endpoint
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AuroraEndpoint`].OutputValue' \
  --output text
```

## Quick Test

```bash
# Test database connection
ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AuroraEndpoint`].OutputValue' \
  --output text)

# Get password from Secrets Manager
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id pagila-db-credentials-training \
  --query SecretString \
  --output text)

DB_PASSWORD=$(echo $SECRET | jq -r .password)

# Connect
PGPASSWORD=$DB_PASSWORD psql -h $ENDPOINT -U postgres -d postgres -c "SELECT 1;"
```

## Common Commands

| Task | Command |
|------|---------|
| **Preview changes** | `npm run diff` |
| **Generate template** | `npm run synth` |
| **Deploy** | `npm run deploy` |
| **Delete everything** | `npm run destroy` |
| **Watch for changes** | `npm run watch` |
| **Compile only** | `npm run build` |

## Next Steps

1. **Initialize Pagila Schema** (Phase 3)
   ```bash
   cd ../..
   python3 scripts/init-database.py
   ```

2. **Test API Gateway** (after Phase 3)
   ```bash
   API=$(aws cloudformation describe-stacks \
     --stack-name PagilaStack \
     --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint`].OutputValue' \
     --output text)
   
   curl -X POST ${API}query \
     -H "Content-Type: application/json" \
     -d '{"query": "SELECT COUNT(*) FROM film;"}'
   ```

3. **Clean Up** (when done)
   ```bash
   npm run destroy
   ```

## Estimated Costs

| Usage | Monthly Cost |
|-------|--------------|
| Sporadic (< 1 hr) | ~$1.00 |
| Regular (10 hrs) | ~$8-15 |
| Always on (24/7) | ~$50+ |

Auto-pause after 15 min inactivity saves ~95% of compute cost!

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"CDK not compatible"** | `npm install -g aws-cdk@latest` |
| **"No credentials"** | `aws configure` |
| **Stack creation fails** | `npm run diff` to see what's wrong |
| **Lambda timeout** | Normal - database warming up (30-60 sec) |

## File Structure

```
infrastructure/cdk/
├── lib/pagila-stack.ts      ← Main infrastructure
├── lambda/query-handler.ts  ← Query execution function
├── bin/pagila.ts            ← CDK app entry point
├── cdk.json                 ← Configuration
├── package.json             ← Dependencies
└── README.md                ← Full documentation
```

## Getting Help

- Full guide: See `../../PHASE_2_DEPLOYMENT_GUIDE.md`
- CDK docs: https://docs.aws.amazon.com/cdk/v2/guide/
- Aurora docs: https://docs.aws.amazon.com/RDS/latest/AuroraUserGuide/
- Stack errors: `aws cloudformation describe-stack-events --stack-name PagilaStack`

---

**Ready to deploy?** Run `npm run deploy` now!
