# Pagila AWS CDK Infrastructure

TypeScript AWS CDK infrastructure for deploying the Pagila PostgreSQL training database on AWS using serverless technologies.

## Architecture Overview

This CDK stack provisions:

- **Aurora PostgreSQL Serverless v2**: Auto-scaling, auto-pausing PostgreSQL cluster
- **Lambda Function**: Query execution handler (Node.js 20 with TypeScript)
- **API Gateway**: REST API endpoint for query submission
- **VPC**: Isolated network with security groups
- **Secrets Manager**: Secure credential storage
- **IAM Roles**: Proper permissions for Lambda execution

## Project Structure

```
infrastructure/cdk/
├── bin/
│   └── pagila.ts              # CDK app entry point
├── lib/
│   └── pagila-stack.ts        # Main CDK stack definition
├── lambda/
│   ├── query-handler.ts       # Lambda function code
│   ├── package.json           # Lambda dependencies
│   └── tsconfig.json          # Lambda TypeScript config
├── package.json               # CDK dependencies
├── tsconfig.json              # TypeScript configuration
├── cdk.json                   # CDK configuration
├── .gitignore                 # Git ignore rules
└── README.md                  # This file
```

## Prerequisites

- Node.js 18+ and npm
- AWS CLI v2 configured with credentials
- AWS CDK CLI: `npm install -g aws-cdk`
- AWS Account with appropriate permissions

## Installation

1. Install CDK dependencies:

```bash
cd infrastructure/cdk
npm install
```

2. Install Lambda dependencies:

```bash
cd lambda
npm install
cd ..
```

3. Bootstrap your AWS environment (one-time setup):

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

## Compilation

Compile TypeScript to JavaScript:

```bash
npm run build
```

Watch mode for development:

```bash
npm run watch
```

## Deployment

### 1. Synthesize CloudFormation Template

Generate the CloudFormation template without deploying:

```bash
npm run synth
```

This creates `cdk.out/PagilaStack.template.json` with the complete infrastructure definition.

### 2. Preview Changes

Review what will be created/modified:

```bash
npm run diff
```

### 3. Deploy Stack

Deploy to AWS:

```bash
npm run deploy
```

This will:
1. Display pending changes
2. Ask for confirmation
3. Create the stack
4. Output stack information including endpoints

### 4. Monitor Deployment

Watch deployment progress:

```bash
aws cloudformation describe-stack-events \
  --stack-name PagilaStack \
  --region us-east-1 \
  --query 'StackEvents[0:10]'
```

## Post-Deployment

After successful deployment, you'll receive outputs including:

- **AuroraEndpoint**: Database hostname
- **AuroraPort**: Database port (5432)
- **DatabaseName**: Database name (pagila)
- **DatabaseUsername**: Master username (postgres)
- **DBSecretArn**: Secret Manager ARN with credentials
- **LambdaFunctionName**: Query execution function name
- **APIEndpoint**: REST API endpoint URL
- **ConnectionString**: PostgreSQL connection string

### Save Outputs

Save the outputs for reference:

```bash
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs' \
  > ../cdk-outputs.json
```

## Configuration

### CDK Context Variables

Customize deployment via `cdk.json`:

```json
{
  "context": {
    "vpcCidr": "10.0.0.0/16",
    "dbMinCapacity": 0.5,
    "dbMaxCapacity": 2,
    "environment": "training"
  }
}
```

Or pass via command line:

```bash
cdk deploy -c vpcCidr=10.1.0.0/16 -c dbMaxCapacity=4
```

### Environment Variables

Set AWS environment for deployment:

```bash
export AWS_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1
```

## Database Initialization

After stack deployment, initialize the database with Pagila schema and data:

```bash
# Get credentials from CloudFormation outputs
export DB_HOST=pagila-cluster-xxxxx.us-east-1.rds.amazonaws.com
export DB_USER=postgres
export DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id pagila-db-credentials-training \
  --query SecretString \
  --output text | jq -r .password)

# Run initialization script from project root
python3 scripts/init-database.py
```

## Usage Examples

### Direct Database Connection

```bash
# Get connection details
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AuroraEndpoint`].OutputValue' \
  --output text

# Connect with psql
psql -h <aurora-endpoint> -U postgres -d pagila
```

### Query via Lambda/API Gateway

```bash
# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint`].OutputValue' \
  --output text)

# Execute query
curl -X POST ${API_ENDPOINT}query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT COUNT(*) FROM film;"}'
```

## Lambda Function Details

### Handler: `query-handler.ts`

The Lambda function:
- Accepts POST requests with JSON body containing `query` field
- Retrieves database credentials from Secrets Manager
- Executes SQL against Aurora PostgreSQL
- Returns results as JSON

### Request Format

```json
{
  "query": "SELECT title, release_year FROM film LIMIT 5;"
}
```

### Response Format (Success)

```json
{
  "success": true,
  "rows": [
    {"title": "ACADEMY DINOSAUR", "release_year": 2006},
    {"title": "ACE GOLDFINGER", "release_year": 2006}
  ],
  "count": 2,
  "executedAt": "2024-01-15T10:30:00.000Z"
}
```

### Response Format (Error)

```json
{
  "success": false,
  "error": "Connection refused"
}
```

## Database Credentials

Credentials are stored securely in AWS Secrets Manager:

```bash
# Retrieve credentials
aws secretsmanager get-secret-value \
  --secret-id pagila-db-credentials-training \
  --query SecretString \
  --output text | jq .
```

## Security Considerations

1. **Network Isolation**: Aurora runs in private subnets with restricted security groups
2. **Credentials**: Stored in Secrets Manager, never in code or environment files
3. **IAM Permissions**: Lambda has minimal permissions (Secrets Manager read, VPC access)
4. **Encryption**: Aurora storage is encrypted at rest
5. **Backups**: 7-day retention with automatic snapshots on deletion

### Production Hardening

For production deployments:

- Restrict security group to specific IPs/security groups
- Enable IAM database authentication
- Use VPC endpoints for private connectivity
- Enable enhanced monitoring
- Configure CloudWatch alarms
- Implement WAF rules on API Gateway
- Add API key/authorization

## Cleanup

### Destroy Stack

Remove all resources:

```bash
npm run destroy
```

This will:
1. Show resources to be deleted
2. Ask for confirmation
3. Delete the stack
4. Create final RDS snapshot (data retention)

### Manual Cleanup

If automated cleanup fails:

```bash
# Delete stack directly
aws cloudformation delete-stack \
  --stack-name PagilaStack \
  --region us-east-1

# Monitor deletion
aws cloudformation describe-stacks \
  --stack-name PagilaStack \
  --region us-east-1
```

## Troubleshooting

### Stack Creation Fails

Check CloudFormation events:

```bash
aws cloudformation describe-stack-events \
  --stack-name PagilaStack \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`]'
```

### Lambda Connection Issues

Check VPC configuration:

```bash
# Verify Lambda is in correct subnets
aws lambda get-function-concurrency \
  --function-name pagila-query-executor

# Check security group rules
aws ec2 describe-security-groups \
  --filters 'Name=group-name,Values=*AuroraSecurityGroup*'
```

### Database Won't Accept Connections

1. Verify database is not paused (wait 1-2 minutes)
2. Check security group allows inbound on port 5432
3. Verify credentials are correct
4. Check Aurora cluster is in "available" state

### Cold Start Performance

First Lambda invocation or database resume may take 30-60 seconds:
- This is normal for Serverless Aurora
- Subsequent invocations are faster
- Consider keeping database warm for production use

## Cost Estimation

### Monthly Costs (Sporadic Use < 1 hr/month)

| Service | Cost |
|---------|------|
| Aurora Compute | $0.03-0.05 |
| Aurora Storage | $1.00 |
| Lambda | <$0.01 |
| API Gateway | <$0.01 |
| **Total** | **~$1.05** |

### Cost Optimization

1. **Auto-pause**: Enabled by default (pauses after 15 min inactivity)
2. **Capacity scaling**: Scales from 0.5 to 2 ACUs as needed
3. **Direct psql**: Use for frequent access (avoids Lambda costs)
4. **Data transfer**: Keep within AWS to avoid egress charges

## Development

### Local Testing

Compile Lambda function for testing:

```bash
cd lambda
npm run build
```

### TypeScript Strict Mode

This project uses TypeScript strict mode for type safety:

```bash
npm run build
```

## CDK Best Practices Used

- ✅ Infrastructure as Code (IaC)
- ✅ Type-safe constructs (TypeScript)
- ✅ Proper separation of concerns
- ✅ Comprehensive documentation
- ✅ Security-first approach
- ✅ Minimal IAM permissions
- ✅ VPC networking best practices
- ✅ Stack outputs for easy reference
- ✅ Removal policies for data protection

## References

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/v2/guide/)
- [Aurora Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.html)
- [Lambda VPC Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [API Gateway Lambda Integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/)

## Support

For issues or questions:

1. Check CloudFormation events for deployment errors
2. Review Lambda logs in CloudWatch
3. Verify AWS CLI credentials and permissions
4. Check AWS service quotas aren't exceeded
5. Consult AWS documentation for service-specific issues

## License

MIT
