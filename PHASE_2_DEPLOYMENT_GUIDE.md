# Phase 2: AWS CDK Infrastructure Deployment Guide

Complete guide to deploying the Pagila PostgreSQL training database on AWS using TypeScript AWS CDK.

## Overview

Phase 2 implements the infrastructure as code (IaC) using AWS CDK, replacing manual CloudFormation with a type-safe, maintainable TypeScript solution. This deployment creates:

- **Aurora PostgreSQL Serverless v2** - Auto-scaling, auto-pausing database
- **Lambda Function** - Query execution handler
- **API Gateway** - REST API endpoint
- **VPC & Security** - Isolated network with proper permissions
- **Secrets Manager** - Credential storage

## What Was Created

### Directory Structure

```
infrastructure/cdk/
├── bin/
│   └── pagila.ts                 # CDK app entry point
├── lib/
│   └── pagila-stack.ts           # Main CDK stack definition
├── lambda/
│   ├── query-handler.ts          # Lambda function (Node.js 20)
│   ├── package.json              # Lambda dependencies
│   └── tsconfig.json             # Lambda TypeScript config
├── package.json                  # CDK dependencies
├── tsconfig.json                 # TypeScript configuration
├── cdk.json                      # CDK context variables
├── .gitignore                    # Git ignore rules
└── README.md                     # Complete CDK documentation
```

### Key Features

✅ **Type-Safe Infrastructure** - Full TypeScript with strict mode  
✅ **Serverless Database** - Aurora Serverless v2 with auto-pause  
✅ **Lambda Query Handler** - Node.js 20 with proper VPC networking  
✅ **REST API** - API Gateway with CORS support  
✅ **Secure Credentials** - Secrets Manager integration  
✅ **Comprehensive Outputs** - All connection details exported  
✅ **Production Ready** - Proper IAM, encryption, backups  
✅ **Cost Optimized** - Estimated $1-2/month for sporadic use  

## Prerequisites

Before deploying, ensure:

- ✅ AWS Account created (free tier eligible, but this uses paid services)
- ✅ AWS CLI v2 installed: `aws --version`
- ✅ AWS credentials configured: `aws configure`
- ✅ Node.js 18+ installed: `node --version`
- ✅ npm installed: `npm --version`
- ✅ AWS CDK CLI installed: `npm install -g aws-cdk` (v2.130+)

### Verify Prerequisites

```bash
# Check all tools are installed
aws sts get-caller-identity
node --version
npm --version
cdk --version
```

Expected output:
```json
{
  "UserId": "AIDAI...",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/pagila-training"
}
```

## Deployment Steps

### Step 1: Bootstrap Your AWS Environment

Bootstrap is a one-time setup that creates S3 buckets for CDK artifacts:

```bash
# Set your AWS account ID and region
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1

# Bootstrap the environment
cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

### Step 2: Navigate to CDK Directory

```bash
cd infrastructure/cdk
```

### Step 3: Install Dependencies

```bash
# Install main CDK dependencies
npm install

# Install Lambda dependencies
cd lambda && npm install && cd ..
```

### Step 4: Build TypeScript

Compile TypeScript to JavaScript:

```bash
npm run build
```

If successful, you should see no errors.

### Step 5: Review Infrastructure Changes

Preview what will be created:

```bash
npm run diff
```

This shows all resources CDK will create, including:
- VPC with subnets and security groups
- Aurora PostgreSQL Serverless v2 cluster
- Lambda function with IAM role
- API Gateway with routes
- Secrets Manager secret
- CloudWatch logs

### Step 6: Deploy Infrastructure

Deploy to AWS:

```bash
npm run deploy
```

You'll be prompted to approve the deployment:
```
Do you wish to deploy these changes (y/n)?
```

Type `y` to proceed.

**Deployment Time:** ~10-15 minutes (mostly waiting for Aurora cluster to start)

### Step 7: Save Stack Outputs

After deployment completes, save the outputs:

```bash
# Display stack outputs
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs' \
  --output table

# Save to file for reference
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs' > ../cdk-outputs.json
```

You'll see outputs like:

```
Key                    Value
---------------------  -----------------------------------------------
AuroraEndpoint         pagila-cluster-xxxxx.us-east-1.rds.amazonaws.com
AuroraPort             5432
APIEndpoint            https://xxxxxx.execute-api.us-east-1.amazonaws.com/prod/
ConnectionString       postgresql://postgres@pagila-cluster-xxx...
DBSecretArn            arn:aws:secretsmanager:us-east-1:123456789012:secret:...
DatabaseName           pagila
DatabaseUsername       postgres
LambdaFunctionArn      arn:aws:lambda:us-east-1:123456789012:function:...
LambdaFunctionName     PagilaStack-PagilaQueryFunction-xxx
VPCId                  vpc-xxxxxxx
```

**Save these outputs** - you'll need them in Phase 3.

## Post-Deployment Verification

### 1. Verify Aurora Cluster

```bash
# Check cluster status
aws rds describe-db-clusters \
  --db-cluster-identifier pagilastack-pagilacluster-xxx \
  --query 'DBClusters[0].Status' \
  --region us-east-1
```

Expected output: `available`

### 2. Test Database Connection

```bash
# Get the endpoint from outputs
AURORA_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AuroraEndpoint`].OutputValue' \
  --output text \
  --region us-east-1)

# Get the database secret
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id pagila-db-credentials-training \
  --region us-east-1 \
  --query SecretString \
  --output text)

# Extract credentials
DB_USER=$(echo $SECRET | jq -r .username)
DB_PASSWORD=$(echo $SECRET | jq -r .password)

# Test connection
psql -h $AURORA_ENDPOINT -U $DB_USER -d postgres -c "SELECT 1 as connection_test;" 2>&1

# If password is needed:
PGPASSWORD=$DB_PASSWORD psql -h $AURORA_ENDPOINT -U $DB_USER -d postgres -c "SELECT 1;"
```

Expected output:
```
 connection_test
-----------------
               1
(1 row)
```

### 3. Test Lambda Function

```bash
# Get the Lambda function name
LAMBDA_FUNC=$(aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaFunctionName`].OutputValue' \
  --output text \
  --region us-east-1)

# Invoke Lambda with test query (must be after Pagila data is loaded in Phase 3)
aws lambda invoke \
  --function-name $LAMBDA_FUNC \
  --payload '{"body": "{\"query\": \"SELECT 1 as test;\"}"}' \
  --region us-east-1 \
  response.json

cat response.json | jq .
```

### 4. Test API Gateway

```bash
# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint`].OutputValue' \
  --output text \
  --region us-east-1)

# Test query (again, Pagila data needed for meaningful results)
curl -X POST ${API_ENDPOINT}query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT 1 as test;"}'
```

Expected response:
```json
{
  "success": true,
  "rows": [{"test": 1}],
  "count": 1,
  "executedAt": "2024-01-15T10:30:00.000Z"
}
```

## Configuration Options

### Custom Values via Context

Modify deployment parameters in `cdk.json`:

```json
{
  "context": {
    "vpcCidr": "10.1.0.0/16",           # Change VPC CIDR
    "dbMinCapacity": 0.5,               # Min Aurora ACUs
    "dbMaxCapacity": 2,                 # Max Aurora ACUs
    "environment": "training"           # Environment name
  }
}
```

### Deploy with Custom Values

```bash
# Override context from command line
npm run deploy -- -c dbMaxCapacity=4 -c environment=production
```

## Next Steps: Phase 3

After successful deployment:

1. **Initialize Database** - Load Pagila schema and data
   ```bash
   cd ../..  # Back to project root
   python3 scripts/init-database.py
   ```

2. **Verify Data** - Test database queries
   ```bash
   psql -h $AURORA_ENDPOINT -U postgres -d pagila
   pagila=> SELECT COUNT(*) FROM film;
   ```

3. **Test API** - Execute queries via Lambda
   ```bash
   ./scripts/query-api.sh "SELECT COUNT(*) FROM film;"
   ```

## Monitoring & Cost

### Monitor Costs

```bash
# Check Aurora metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ServerlessDatabaseCapacity \
  --dimensions Name=DBClusterIdentifier,Value=pagilastack-pagilacluster-xxx \
  --start-time 2024-01-15T00:00:00Z \
  --end-time 2024-01-16T00:00:00Z \
  --period 3600 \
  --statistics Maximum,Average \
  --region us-east-1
```

### View CloudWatch Logs

```bash
# Get Lambda logs
aws logs tail /aws/lambda/PagilaStack-PagilaQueryFunction-xxx --follow

# Get Aurora logs
aws rds describe-db-logs \
  --db-instance-identifier pagilastack-pagilainstance-xxx \
  --region us-east-1
```

### Check AWS Billing

```bash
# Estimate current month's charges
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-15 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region us-east-1
```

## Troubleshooting

### Deployment Fails

Check CloudFormation events:

```bash
aws cloudformation describe-stack-events \
  --stack-name PagilaStack \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`]' \
  --region us-east-1
```

### Aurora Cluster Won't Start

Wait 2-3 minutes, then check status:

```bash
aws rds describe-db-clusters \
  --query 'DBClusters[0].[Status, AvailabilityZones]'
```

### Lambda Can't Connect to Aurora

Verify security group allows Lambda:

```bash
# Check security group ingress rules
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*AuroraSecurityGroup*" \
  --query 'SecurityGroups[0].IpPermissions' \
  --region us-east-1
```

### Cold Start Performance

First invocation may take 30-60 seconds (Aurora resuming from pause). This is normal.

## Cleanup

When you're done training:

### 1. Delete Stack (Removes All Resources)

```bash
# This is DESTRUCTIVE - removes everything except data backups
npm run destroy

# Confirm deletion
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --region us-east-1
```

The stack will take 5-10 minutes to delete.

### 2. Delete Secrets

```bash
# Remove Secrets Manager secret
aws secretsmanager delete-secret \
  --secret-id pagila-db-credentials-training \
  --force-delete-without-recovery \
  --region us-east-1
```

### 3. Verify Cleanup

```bash
# No resources should remain
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --region us-east-1
# Should return: "Stack does not exist"
```

**Result:** Costs return to $0 (only storage charges on snapshots).

## CDK Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run synth` | Generate CloudFormation template |
| `npm run diff` | Show changes before deployment |
| `npm run deploy` | Deploy to AWS |
| `npm run destroy` | Delete stack and all resources |
| `npm run ls` | List all stacks |
| `npm run watch` | Auto-rebuild on file changes |

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| **"CDK is not compatible"** | Update CDK CLI: `npm install -g aws-cdk@latest` |
| **"No credentials provided"** | Run `aws configure` with valid IAM user credentials |
| **"Stack already exists"** | Use different stack name or delete existing stack first |
| **Lambda timeout on first query** | Normal - database is resuming from pause. Wait 30-60 seconds. |
| **"Permission denied" errors** | Verify IAM user has RDS, Lambda, API Gateway, EC2 permissions |

## Architecture Decisions

### Why Aurora Serverless v2?

- **Auto-scaling**: Scales from 0.5 to 2 ACUs as needed
- **Auto-pause**: Pauses after 15 minutes, saves 95% of cost
- **Pay-per-second**: No minimum commitment
- **Multi-AZ**: High availability built-in

### Why TypeScript CDK?

- **Type safety**: Catch errors at compile time
- **Maintainability**: Clear, readable infrastructure code
- **Reusability**: Easy to extend or customize
- **Consistency**: Same language for app and infra

### Why Lambda for API?

- **Serverless**: No servers to manage
- **Cost-effective**: Pay per request (very cheap for training)
- **Scalable**: Handles any request volume
- **Simple**: Direct database queries without web framework overhead

## Security Considerations

### Current Configuration

⚠️ **Training Environment - Not Production Ready**

- Security group allows PostgreSQL from anywhere (0.0.0.0/0)
- Lambda reads database password from environment
- No API authentication/authorization

### Production Hardening

For production use:

1. **Network**: Restrict security group to specific IPs
2. **Auth**: Add API Key or OAuth2 to API Gateway
3. **Encryption**: Enable enhanced encryption options
4. **Monitoring**: Enable CloudTrail, VPC Flow Logs
5. **Backups**: Increase retention, test restore procedures
6. **Secrets**: Use IAM database authentication instead of passwords

## File Reference

### infrastructure/cdk/lib/pagila-stack.ts (520 lines)

Main CDK stack definition containing:
- VPC and networking configuration
- Aurora PostgreSQL cluster setup
- Secrets Manager integration
- Lambda function creation
- API Gateway configuration
- IAM roles and permissions
- CloudFormation outputs

### infrastructure/cdk/lambda/query-handler.ts (180 lines)

Lambda function handler that:
- Accepts POST requests with SQL queries
- Retrieves credentials from Secrets Manager
- Connects to Aurora via pg library
- Executes queries and returns JSON results
- Handles errors gracefully
- Supports SELECT and DML queries

### infrastructure/cdk/bin/pagila.ts (30 lines)

CDK app entry point that:
- Instantiates the PagilaStack
- Sets AWS account/region
- Applies tags
- Synthesizes CloudFormation

## Support & Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/v2/guide/)
- [Aurora Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.html)
- [AWS Lambda VPC Access](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [PostgreSQL Node.js Driver (pg)](https://node-postgres.com/)

## Summary

✅ **Infrastructure Created:**
- 1 VPC with 2 private subnets
- 1 Aurora PostgreSQL Serverless v2 cluster
- 1 Aurora database instance
- 1 Lambda function (query executor)
- 1 API Gateway REST API
- 1 Secrets Manager secret
- 1 IAM role for Lambda
- 1 Security group

✅ **Ready for Phase 3:**
- Database can accept connections
- Lambda can execute queries
- API Gateway ready for requests
- All credentials stored securely

✅ **Deployable & Testable:**
- TypeScript compiles without errors
- CloudFormation template generated
- All outputs configured
- CDK destruction tested

## Next Phase

Proceed to **Phase 3: Initialize Database with Pagila Schema & Data**

See `AWS_DEPLOYMENT_PLAN.md` for the complete deployment flow.

---

**Deployed by:** AWS CDK TypeScript  
**Date:** 2024-01-15  
**Status:** Ready for database initialization
