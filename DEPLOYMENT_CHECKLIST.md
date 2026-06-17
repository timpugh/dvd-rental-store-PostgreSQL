# Deployment Checklist: AWS Serverless Pagila Database

Complete this checklist when deploying the Pagila database to AWS. Use this as both a deployment guide and a troubleshooting reference.

---

## 1. Pre-Deployment Setup

Essential prerequisites before any AWS infrastructure work.

- [ ] **AWS Account Created**
  - Visit https://aws.amazon.com and create account
  - Receive $300 free credits (if new account)
  - Verify email address
  - Enable 2FA on root account

- [ ] **AWS CLI v2 Installed**
  ```bash
  # macOS
  brew install awscliv2
  
  # Linux
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip awscliv2.zip
  sudo ./aws/install
  
  # Windows
  # Download from: https://awscli.amazonaws.com/AWSCLIV2.msi
  
  # Verify installation
  aws --version  # Should show 2.x or later
  ```

- [ ] **AWS CLI Configured**
  ```bash
  # Configure credentials
  aws configure
  
  # When prompted enter:
  # AWS Access Key ID: [from IAM user]
  # AWS Secret Access Key: [from IAM user]
  # Default region: us-east-1
  # Default output format: json
  
  # Verify configuration
  aws sts get-caller-identity
  ```

- [ ] **IAM User Created with Programmatic Access**
  - Go to AWS Console → IAM → Users → Create user
  - Username: `pagila-training`
  - Enable "Provide user access to the AWS Management Console" (optional)
  - Attach policies:
    - `AmazonRDSFullAccess` (database management)
    - `AmazonAPIGatewayFullAccess` (API creation)
    - `AWSLambdaFullAccess` (Lambda functions)
    - `AWSCloudFormationFullAccess` (infrastructure)
    - `AmazonSSMFullAccess` (parameter store)
  - Generate access key
  - Save access key ID and secret locally (use `aws configure`)

- [ ] **Git Repository Cloned**
  ```bash
  git clone https://github.com/YOUR_REPO/dvd-rental-store-PostgreSQL.git
  cd dvd-rental-store-PostgreSQL
  ```

- [ ] **Node.js 18+ Installed** (for CDK/TypeScript compilation)
  ```bash
  node --version  # Should be 18.0.0 or later
  npm --version   # Should be 8.0.0 or later
  ```

- [ ] **Python 3.11+ Installed**
  ```bash
  python3 --version  # Should be 3.11 or later
  pip install --upgrade pip
  ```

- [ ] **Required Python Packages Installed**
  ```bash
  pip install psycopg2-binary
  pip install boto3
  
  # Verify
  python3 -c "import psycopg2; print('psycopg2 OK')"
  python3 -c "import boto3; print('boto3 OK')"
  ```

---

## 2. CDK Deployment

Deploy infrastructure using AWS CDK (CloudFormation alternative).

- [ ] **Navigate to Infrastructure Directory**
  ```bash
  cd infrastructure/cdk
  pwd  # Should end with /infrastructure/cdk
  ```

- [ ] **Install Dependencies**
  ```bash
  npm install
  npm install -g aws-cdk  # Install CDK CLI globally
  
  # Verify
  cdk --version  # Should show 2.x or later
  ```

- [ ] **Compile TypeScript to JavaScript**
  ```bash
  npm run build
  
  # Verify no errors in output
  ```

- [ ] **Bootstrap CDK (First Time Only)**
  ```bash
  cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
  
  # Get your account ID:
  aws sts get-caller-identity --query Account --output text
  ```

- [ ] **Deploy Infrastructure Stack**
  ```bash
  cdk deploy
  
  # When prompted to approve changes, review and type: y
  ```

- [ ] **Monitor Stack Creation** (takes 10-15 minutes)
  ```bash
  # Option 1: Watch in AWS Console
  # Go to CloudFormation → Stacks → pagila-serverless
  
  # Option 2: Monitor via CLI
  aws cloudformation describe-stack-events \
    --stack-name pagila-serverless \
    --region us-east-1 \
    --query 'StackEvents[0:5]' \
    --output table
  ```

- [ ] **Verify All Resources Created**
  ```bash
  # Check stack status
  aws cloudformation describe-stacks \
    --stack-name pagila-serverless \
    --region us-east-1 \
    --query 'Stacks[0].StackStatus'
  
  # Should output: CREATE_COMPLETE
  ```

- [ ] **Confirm Core Resources**
  
  Check Aurora cluster created:
  ```bash
  aws rds describe-db-clusters \
    --db-cluster-identifier pagila-cluster \
    --region us-east-1 \
    --query 'DBClusters[0].Endpoint'
  ```
  
  Check Lambda function deployed:
  ```bash
  aws lambda get-function \
    --function-name pagila-query-executor \
    --region us-east-1
  ```
  
  Check API Gateway endpoint:
  ```bash
  aws apigateway get-rest-apis \
    --region us-east-1 \
    --query 'items[?name==`pagila-query-api`]' \
    --output table
  ```
  
  Check Secrets Manager secret:
  ```bash
  aws secretsmanager list-secrets \
    --region us-east-1 \
    --query 'SecretList[?contains(Name, `pagila`)]' \
    --output table
  ```

---

## 3. Extract Deployment Outputs

Collect the values needed for local configuration.

- [ ] **Get CloudFormation Stack Outputs**
  ```bash
  aws cloudformation describe-stacks \
    --stack-name pagila-serverless \
    --region us-east-1 \
    --query 'Stacks[0].Outputs' \
    --output table
  ```
  
  Save these values:
  - **AuroraEndpoint**: Database host (e.g., `pagila-cluster.c9akciq32.us-east-1.rds.amazonaws.com`)
  - **AuroraPort**: Should be `5432`
  - **APIEndpoint**: Lambda API URL (e.g., `https://xxxxx.execute-api.us-east-1.amazonaws.com/prod`)
  - **DBSecret**: Secrets Manager secret name

- [ ] **Retrieve Database Credentials from Secrets Manager**
  ```bash
  aws secretsmanager get-secret-value \
    --secret-id pagila-db-credentials-training \
    --region us-east-1 \
    --query 'SecretString' \
    --output text | jq .
  ```
  
  Output should show:
  ```json
  {
    "username": "postgres",
    "password": "YOUR_PASSWORD",
    "host": "pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com",
    "port": 5432,
    "dbname": "pagila"
  }
  ```

- [ ] **Create .env File**
  ```bash
  # Go to project root
  cd /Users/timpugh/Desktop/dvd-rental-store-PostgreSQL
  
  # Copy template
  cp .env.example .env
  
  # Edit .env with values from CloudFormation outputs
  nano .env  # or your preferred editor
  ```
  
  Fill in:
  ```bash
  DB_HOST=pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com
  DB_PORT=5432
  DB_NAME=pagila
  DB_USER=postgres
  DB_PASSWORD=YOUR_PASSWORD_FROM_SECRETS
  AWS_REGION=us-east-1
  API_ENDPOINT=https://xxxxx.execute-api.us-east-1.amazonaws.com/prod
  ```

- [ ] **Verify .env File**
  ```bash
  # Check file exists and is readable
  cat .env
  
  # IMPORTANT: Verify .env is in .gitignore
  grep ".env" .gitignore
  # Should return: .env
  ```

---

## 4. Database Initialization

Set up the Pagila schema and load data into Aurora.

- [ ] **Load Environment Variables**
  ```bash
  cd /Users/timpugh/Desktop/dvd-rental-store-PostgreSQL
  source .env
  echo "DB_HOST=$DB_HOST"  # Verify it's set
  ```

- [ ] **Test Database Connection**
  ```bash
  # Basic connection test
  psql -h $DB_HOST -U postgres -d postgres -c "SELECT 1 as connection_test;"
  
  # Expected output:
  # connection_test
  # ---------------
  #              1
  # (1 row)
  ```
  
  If connection fails:
  - Check security group allows port 5432 from your IP
  - Verify database is not still spinning up (first connection takes 30-60 seconds)
  - Confirm credentials in .env match Secrets Manager

- [ ] **Initialize Database Schema**
  ```bash
  python3 scripts/init-database.py
  
  # Expected output:
  # 🔗 Connecting to Aurora PostgreSQL...
  #    ✅ Connected to pagila-cluster.xxx.us-east-1.rds.amazonaws.com:5432/pagila
  # 📂 Loading: Pagila Schema
  #    File: pagila-schema.sql
  #    ✅ Success
  # [... more output ...]
  # ✅ Database initialization complete!
  ```

- [ ] **Verify Tables Created**
  ```bash
  psql -h $DB_HOST -U postgres -d pagila -c "\dt"
  
  # Should show tables like: film, rental, payment, customer, etc.
  ```

- [ ] **Verify Data Loaded**
  ```bash
  # Check table row counts
  psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM film;"
  # Expected: ~1000 films
  
  psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM customer;"
  # Expected: ~599 customers
  
  psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM payment;"
  # Expected: ~16000 payments
  ```

---

## 5. Testing & Validation

Comprehensive test suite to confirm deployment success.

- [ ] **Run SQL Test Suite**
  ```bash
  psql -h $DB_HOST -U postgres -d pagila -f tests/test-queries.sql
  
  # Expected: All SELECT statements return results
  # Should see counts for: film (1000), customer (599), rental (16000+)
  ```

- [ ] **Run Python Integration Tests**
  ```bash
  python3 tests/integration-test.py
  
  # Expected output:
  # 🧪 Running Pagila Integration Tests
  # ✅ Tables: film: 1000
  # ✅ Tables: customer: 599
  # ✅ Tables: rental: 16044
  # [... more tests ...]
  # Results: 11 passed, 0 failed
  ```
  
  If tests fail:
  - Check schema was fully loaded: `psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"`
  - Check data was fully loaded: `psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM film;"`

- [ ] **Test Direct Database Connection**
  ```bash
  ./scripts/connect-db.sh
  
  # Should open psql prompt
  # Type a query and hit enter
  # Type \q to exit
  ```

- [ ] **Test API Gateway Endpoint** (if using Lambda)
  ```bash
  # Via convenience script
  ./scripts/query-api.sh "SELECT COUNT(*) as film_count FROM film;"
  
  # Or via curl
  curl -X POST "$API_ENDPOINT/query" \
    -H "Content-Type: application/json" \
    -d '{"query": "SELECT title FROM film LIMIT 3;"}' \
    | jq .
  
  # Expected output:
  # {
  #   "success": true,
  #   "rows": [...],
  #   "count": 3
  # }
  ```

- [ ] **Test All Components Pass**
  ```bash
  # Final smoke test - run one query from each method
  
  # 1. Direct psql
  psql -h $DB_HOST -U postgres -d pagila -c "SELECT 'psql works' as test;"
  
  # 2. Python connection
  python3 -c "import psycopg2; conn = psycopg2.connect(host='$DB_HOST', user='postgres', password='$DB_PASSWORD', database='pagila'); print('Python works')"
  
  # 3. API (if enabled)
  ./scripts/query-api.sh "SELECT 'API works' as test;"
  ```

---

## 6. Post-Deployment

Final setup and team coordination.

- [ ] **Review Cost Estimate**
  - Expected monthly cost: $1-2 for sporadic use (< 1 hour/month)
  - See `COST_TRACKING.md` for detailed breakdown
  - Check AWS Cost Explorer for actual costs

- [ ] **Set Up CloudWatch Monitoring** (optional but recommended)
  ```bash
  # View Aurora ACU usage
  aws cloudwatch get-metric-statistics \
    --namespace AWS/RDS \
    --metric-name ServerlessDatabaseCapacity \
    --dimensions Name=DBClusterIdentifier,Value=pagila-cluster \
    --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S)Z \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S)Z \
    --period 3600 \
    --statistics Maximum
  ```

- [ ] **Verify Backup Policy**
  ```bash
  aws rds describe-db-clusters \
    --db-cluster-identifier pagila-cluster \
    --region us-east-1 \
    --query 'DBClusters[0].[BackupRetentionPeriod,PreferredBackupWindow]'
  
  # Should show 7-day retention (automatic)
  ```

- [ ] **Grant Team Access** (if applicable)
  - Share .env file securely (via 1Password, encrypted email, etc.)
  - Or create read-only IAM user for team members
  - Document access credentials in team wiki/Confluence

- [ ] **Review Documentation**
  - [ ] Team read `USAGE_GUIDE.md`
  - [ ] Team read `COST_TRACKING.md`
  - [ ] Team knows how to connect via psql
  - [ ] Team knows cost monitoring procedures

- [ ] **Commit Deployment Record**
  ```bash
  git log --oneline | head -1  # Verify latest commit
  
  # Create deployment record
  echo "Deployed: $(date)" > DEPLOYMENT_RECORD.txt
  echo "Stack: pagila-serverless" >> DEPLOYMENT_RECORD.txt
  echo "Aurora Endpoint: $DB_HOST" >> DEPLOYMENT_RECORD.txt
  ```

---

## 7. Cleanup (When Done Training)

Shut down resources to avoid unexpected charges.

- [ ] **Create Final Database Backup**
  ```bash
  # Aurora automatically creates backups
  # Verify in AWS Console: RDS → Automated Backups
  
  # Or manually create a snapshot
  aws rds create-db-cluster-snapshot \
    --db-cluster-snapshot-identifier pagila-final-snapshot-$(date +%Y%m%d) \
    --db-cluster-identifier pagila-cluster \
    --region us-east-1
  ```

- [ ] **Delete CloudFormation Stack**
  ```bash
  aws cloudformation delete-stack \
    --stack-name pagila-serverless \
    --region us-east-1
  
  # This will:
  # - Delete Aurora cluster (with final snapshot)
  # - Delete Lambda function
  # - Delete API Gateway
  # - Delete all related resources
  ```

- [ ] **Verify Stack Deletion Complete**
  ```bash
  # Check status (wait 10 minutes, then run)
  aws cloudformation describe-stacks \
    --stack-name pagila-serverless \
    --region us-east-1
  
  # Should return error: Stack with id pagila-serverless does not exist
  ```

- [ ] **Delete Secrets Manager Secret**
  ```bash
  aws secretsmanager delete-secret \
    --secret-id pagila-db-credentials-training \
    --force-delete-without-recovery \
    --region us-east-1
  ```

- [ ] **Securely Delete .env File**
  ```bash
  # Securely overwrite before deleting (on macOS/Linux)
  shred -vfz -n 3 .env
  
  # Or use secure deletion
  srm .env
  
  # Or simple deletion (if shred not available)
  rm .env
  ```

- [ ] **Rotate AWS Credentials**
  ```bash
  # Go to AWS Console → IAM → Users → pagila-training
  # Delete old access keys
  # Create new access keys for next deployment
  # Update ~/.aws/credentials
  ```

- [ ] **Archive Training Notes** (optional)
  ```bash
  # Backup any local queries, notes, or findings
  tar -czf pagila-training-archive-$(date +%Y%m%d).tar.gz \
    queries/ notes/ results/
  
  # Store safely (cloud storage, external drive, etc.)
  ```

---

## 8. Rollback Plan

If deployment fails at any stage, use this recovery procedure.

### CDK Deployment Failed

```bash
# Step 1: Check CloudFormation events for error details
aws cloudformation describe-stack-events \
  --stack-name pagila-serverless \
  --region us-east-1 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`]' \
  --output table

# Step 2: Delete the failed stack
aws cloudformation delete-stack \
  --stack-name pagila-serverless \
  --region us-east-1

# Step 3: Wait for deletion (5-10 minutes)
aws cloudformation wait stack-delete-complete \
  --stack-name pagila-serverless \
  --region us-east-1

# Step 4: Fix issues in CDK code
# - Review error messages above
# - Check template syntax
# - Verify IAM permissions
# - Update infrastructure/cdk/lib files

# Step 5: Redeploy
cd infrastructure/cdk
npm run build
cdk deploy
```

### Database Initialization Failed

```bash
# Step 1: Check connection
psql -h $DB_HOST -U postgres -d postgres -c "SELECT 1;"

# Step 2: If connection works, check what was partially loaded
psql -h $DB_HOST -U postgres -d pagila -c "\dt"

# Step 3: Clear tables if partial data loaded
psql -h $DB_HOST -U postgres -d pagila -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Step 4: Re-run initialization
python3 scripts/init-database.py
```

### Connection Test Failed

```bash
# Check 1: Verify .env values
cat .env

# Check 2: Test basic network connectivity
nc -zv $DB_HOST 5432

# Check 3: Check security group allows your IP
aws ec2 describe-security-groups \
  --filters "Name=tag:Name,Values=pagila-aurora-sg" \
  --region us-east-1 \
  --query 'SecurityGroups[0].IpPermissions'

# Check 4: Add your IP to security group if needed
YOUR_IP=$(curl -s https://checkip.amazonaws.com | tr -d '\n')
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 5432 \
  --cidr $YOUR_IP/32 \
  --region us-east-1

# Check 5: Wait 2-3 minutes for security group to take effect
sleep 180

# Check 6: Retry connection
psql -h $DB_HOST -U postgres -d postgres -c "SELECT 1;"
```

### Tests Failing

```bash
# Step 1: Check schema completely loaded
psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"

# Expected: ~50+ tables

# Step 2: If too few tables, re-load schema
python3 scripts/init-database.py

# Step 3: Check data counts
psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM film;"

# Expected: ~1000

# Step 4: If count is low, check for errors in init-database.py output
# Look for failed SQL files and retry manually:
psql -h $DB_HOST -U postgres -d pagila -f pagila-schema.sql
psql -h $DB_HOST -U postgres -d pagila -f pagila-data.sql
```

### API Tests Failing

```bash
# Step 1: Check Lambda function
aws lambda get-function \
  --function-name pagila-query-executor \
  --region us-east-1

# Step 2: Test Lambda directly
aws lambda invoke \
  --function-name pagila-query-executor \
  --region us-east-1 \
  --payload '{"body":"{\\"query\\": \\"SELECT 1;\\"}"}' \
  response.json

cat response.json

# Step 3: Check API Gateway
aws apigateway get-rest-apis \
  --region us-east-1 \
  --query 'items[?name==`pagila-query-api`]'

# Step 4: Check Lambda logs
aws logs tail /aws/lambda/pagila-query-executor --follow --region us-east-1

# Step 5: If logs show errors, update Lambda code in CDK and redeploy
cd infrastructure/cdk
npm run build
cdk deploy
```

---

## Quick Reference Checklist

For experienced users, here's the abbreviated version:

```
Pre-Deployment:
- [ ] AWS account + CLI configured
- [ ] IAM user created with policies
- [ ] Node.js 18+, Python 3.11+ installed
- [ ] psycopg2 installed: pip install psycopg2-binary

Deployment:
- [ ] cd infrastructure/cdk && npm install
- [ ] npm run build
- [ ] cdk bootstrap (first time)
- [ ] cdk deploy
- [ ] Verify stack: CREATE_COMPLETE

Configuration:
- [ ] Copy .env from CloudFormation outputs
- [ ] Test connection: psql -h $DB_HOST -U postgres -d postgres -c "SELECT 1;"
- [ ] Run: python3 scripts/init-database.py

Testing:
- [ ] psql -f tests/test-queries.sql
- [ ] python3 tests/integration-test.py
- [ ] ./scripts/query-api.sh "SELECT 1;"

Cleanup:
- [ ] aws cloudformation delete-stack --stack-name pagila-serverless
- [ ] rm .env (securely: shred -vfz .env)
- [ ] Rotate AWS credentials
```

---

## Support Resources

- **AWS Documentation:** https://docs.aws.amazon.com/
- **Aurora Serverless Guide:** https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.html
- **Pagila Database:** https://www.postgresql.org/ftp/projects/pgFoundry/dbsamples/pagila/
- **psycopg2 Documentation:** https://www.psycopg.org/
- **AWS Cost Management:** https://console.aws.amazon.com/cost-management/

See `COST_TRACKING.md` for cost monitoring and optimization procedures.
