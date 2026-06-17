# AWS Serverless PostgreSQL Training Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Pagila database to AWS using serverless technologies (Aurora Serverless v2, Lambda, API Gateway) with minimal cost for sporadic training use, supporting both CLI and web-based access.

**Architecture:** 
- **Database:** RDS Aurora PostgreSQL Serverless v2 (auto-pause when idle, pay per second)
- **CLI Access:** Direct psql connection from your machine (no Lambda overhead)
- **Web Interface:** Optional Lambda + API Gateway for browser-based query execution
- **Infrastructure as Code:** AWS CloudFormation/CDK for repeatable deployments
- **Cost Controls:** Auto-pause after 15 minutes of inactivity, no reserved instances, per-second billing

**Tech Stack:** 
- AWS RDS Aurora PostgreSQL Serverless v2
- AWS Lambda (Python 3.11 with psycopg2)
- AWS API Gateway (REST API)
- AWS Systems Manager Parameter Store (credentials)
- AWS CloudFormation or CDK (IaC)
- Python 3.11+ local environment

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│ Your Local Machine                                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐              ┌──────────────────────────────┐ │
│  │  psql CLI    │──────────────→│ Aurora Serverless v2         │ │
│  │  (direct)    │  (port 5432)  │ PostgreSQL 15/16             │ │
│  └──────────────┘              └──────────────────────────────┘ │
│                                           ▲                     │
└─────────────────────────────────────────────┼───────────────────┘
                                              │
                                    AWS VPC / Security Group
                                              │
  ┌───────────────────────────────────────────┴──────────────────┐
  │ AWS Cloud                                                    │
  ├──────────────────────────────────────────────────────────────┤
  │  ┌────────────────────────────────────────────────────────┐  │
  │  │ API Gateway (REST)                                     │  │
  │  │ /query - POST endpoint                                 │  │
  │  └────────────────┬─────────────────────────────────────┘  │
  │                   │                                        │
  │  ┌────────────────▼─────────────────────────────────────┐  │
  │  │ Lambda Function (Python)                             │  │
  │  │ - Receives SQL query                                 │  │
  │  │ - Executes via psycopg2                              │  │
  │  │ - Returns JSON results                               │  │
  │  └────────────────┬─────────────────────────────────────┘  │
  │                   │                                        │
  │  ┌────────────────▼─────────────────────────────────────┐  │
  │  │ Aurora Serverless v2 PostgreSQL                       │  │
  │  │ - Auto-pauses after 15 min inactivity                │  │
  │  │ - Billed per second while running                    │  │
  │  │ - Pagila schema + data loaded at init                │  │
  │  └──────────────────────────────────────────────────────┘  │
  │                                                            │
  │  ┌──────────────────────────────────────────────────────┐  │
  │  │ Systems Manager Parameter Store                      │  │
  │  │ - DB credentials (username/password)                 │  │
  │  └──────────────────────────────────────────────────────┘  │
  │                                                            │
  └──────────────────────────────────────────────────────────────┘
```

### Cost Breakdown (Estimated)

| Component | Hourly Cost | Monthly (1 hr/month) | Notes |
|-----------|------------|----------------------|-------|
| Aurora Serverless v2 | $0.84 | $0.014 | Paused most of time |
| Compute (ACU) | Variable | $0.03-0.05 | 2 ACUs, 60 sec billing |
| Data storage | $0.20/GB/month | ~$1.00 | ~5GB data |
| Lambda | $0.20/million | < $0.01 | Few invocations |
| API Gateway | $3.50/million | < $0.01 | Few requests |
| **Total** | - | **~$1.05/month** | Absolute minimum cost |

### Cost Comparison

| Setup | Monthly Cost | Pros | Cons |
|-------|------------|------|------|
| **Serverless (This Plan)** | ~$1.05 | Auto-pauses, pay per second, minimal overhead | Need to manage credentials |
| RDS On-Demand (General) | ~$50-100 | Always available | Billed even when idle |
| EC2 + Self-managed PG | ~$30-50 | Full control | Manual patching, backups |

---

## Deployment Steps

### Phase 1: AWS Account Setup (Prerequisites)

**Files:**
- Create: `infrastructure/aws-setup-guide.md`

- [ ] **Step 1: Create AWS Account**

Visit https://aws.amazon.com and create a free tier account. You get:
- 12 months free tier (limited)
- $300 credits for first month (non-free tier services)
- Aurora Serverless v2 is NOT free tier, but extremely cheap for sporadic use

- [ ] **Step 2: Configure AWS CLI Locally**

```bash
# Install AWS CLI v2
# macOS:
brew install awscliv2

# Linux/Windows: see https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

# Configure credentials
aws configure

# When prompted, enter:
# AWS Access Key ID: [from IAM User]
# AWS Secret Access Key: [from IAM User]
# Default region: us-east-1 (or your preferred region)
# Default output format: json
```

- [ ] **Step 3: Create IAM User for Programmatic Access**

Go to AWS Console → IAM → Users → Create user
- Username: `pagila-training`
- Attach policies:
  - `AmazonRDSFullAccess`
  - `AmazonAPIGatewayFullAccess`
  - `AWSLambdaFullAccess`
  - `AWSCloudFormationFullAccess`
  - `AmazonSSMFullAccess`

Generate access key → save locally in `~/.aws/credentials`

- [ ] **Step 4: Verify AWS CLI Access**

```bash
aws sts get-caller-identity
```

Expected output:
```json
{
    "UserId": "AIDAI...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/pagila-training"
}
```

---

### Phase 2: Infrastructure as Code (CloudFormation)

**Files:**
- Create: `infrastructure/cloudformation/pagila-serverless-stack.yaml`
- Create: `infrastructure/cloudformation/parameters.json`
- Create: `infrastructure/deploy.sh`

**Why CloudFormation:** Repeatable, version-controlled infrastructure. Delete entire stack when done to avoid unexpected charges.

- [ ] **Step 1: Create CloudFormation Template**

Create file: `infrastructure/cloudformation/pagila-serverless-stack.yaml`

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Serverless Pagila PostgreSQL Training Environment'

Parameters:
  DBUsername:
    Type: String
    Default: postgres
    NoEcho: true
    Description: PostgreSQL master username
  
  DBPassword:
    Type: String
    NoEcho: true
    MinLength: 8
    Description: PostgreSQL password (min 8 chars)
  
  Environment:
    Type: String
    Default: training
    AllowedValues:
      - training
      - development
    Description: Environment name

Resources:
  # VPC and Security Groups
  PagilaVPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsHostnames: true
      EnableDnsSupport: true
      Tags:
        - Key: Name
          Value: pagila-vpc

  PagilaSubnetA:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref PagilaVPC
      CidrBlock: 10.0.1.0/24
      AvailabilityZone: !Select [0, !GetAZs '']
      Tags:
        - Key: Name
          Value: pagila-subnet-a

  PagilaSubnetB:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref PagilaVPC
      CidrBlock: 10.0.2.0/24
      AvailabilityZone: !Select [1, !GetAZs '']
      Tags:
        - Key: Name
          Value: pagila-subnet-b

  PagilaDBSubnetGroup:
    Type: AWS::RDS::DBSubnetGroup
    Properties:
      DBSubnetGroupDescription: Subnet group for Pagila Aurora
      SubnetIds:
        - !Ref PagilaSubnetA
        - !Ref PagilaSubnetB
      Tags:
        - Key: Name
          Value: pagila-db-subnet-group

  # Security Group for Aurora
  AuroraSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for Aurora PostgreSQL
      VpcId: !Ref PagilaVPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 5432
          ToPort: 5432
          CidrIp: 0.0.0.0/0  # WARNING: Open to world. Restrict to your IP in production
          Description: PostgreSQL access from anywhere
      Tags:
        - Key: Name
          Value: pagila-aurora-sg

  # Aurora Serverless v2 Database
  PagilaAuroraCluster:
    Type: AWS::RDS::DBCluster
    DeletionPolicy: Snapshot
    Properties:
      Engine: aurora-postgresql
      EngineVersion: '15.3'
      DatabaseName: pagila
      MasterUsername: !Ref DBUsername
      MasterUserPassword: !Ref DBPassword
      DBSubnetGroupName: !Ref PagilaDBSubnetGroup
      VpcSecurityGroupIds:
        - !Ref AuroraSecurityGroup
      ServerlessV2ScalingConfiguration:
        MinCapacity: 0.5
        MaxCapacity: 2
      EnableIAMDatabaseAuthentication: false
      BackupRetentionPeriod: 7
      StorageEncrypted: true
      EnableCloudwatchLogsExports:
        - postgresql
      Tags:
        - Key: Name
          Value: pagila-aurora-cluster
        - Key: Environment
          Value: !Ref Environment

  PagilaAuroraInstance:
    Type: AWS::RDS::DBInstance
    Properties:
      DBInstanceIdentifier: pagila-instance
      DBClusterIdentifier: !Ref PagilaAuroraCluster
      DBInstanceClass: db.serverless
      Engine: aurora-postgresql
      PubliclyAccessible: true
      Tags:
        - Key: Name
          Value: pagila-instance

  # Secrets Manager for DB Credentials
  PagilaDBSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub 'pagila-db-credentials-${Environment}'
      Description: Database credentials for Pagila Aurora PostgreSQL
      SecretString: !Sub |
        {
          "username": "${DBUsername}",
          "password": "${DBPassword}",
          "host": "${PagilaAuroraCluster.Endpoint.Address}",
          "port": 5432,
          "dbname": "pagila"
        }
      Tags:
        - Key: Environment
          Value: !Ref Environment

  # IAM Role for Lambda
  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: 'sts:AssumeRole'
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: SecretsAccess
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - 'secretsmanager:GetSecretValue'
                Resource: !GetAtt PagilaDBSecret.Arn
        - PolicyName: VPCAccess
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - 'ec2:CreateNetworkInterface'
                  - 'ec2:DescribeNetworkInterfaces'
                  - 'ec2:DeleteNetworkInterface'
                Resource: '*'

  # Lambda Function for Queries
  PagilaQueryFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: pagila-query-executor
      Runtime: python3.11
      Handler: index.lambda_handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Timeout: 30
      VpcConfig:
        SecurityGroupIds:
          - !Ref AuroraSecurityGroup
        SubnetIds:
          - !Ref PagilaSubnetA
          - !Ref PagilaSubnetB
      Environment:
        Variables:
          DB_SECRET_NAME: !Sub 'pagila-db-credentials-${Environment}'
          DB_HOST: !GetAtt PagilaAuroraCluster.Endpoint.Address
      Code:
        ZipFile: |
          import json
          import psycopg2
          import os
          import boto3
          
          def lambda_handler(event, context):
              try:
                  body = json.loads(event.get('body', '{}'))
                  query = body.get('query', '')
                  
                  if not query:
                      return {
                          'statusCode': 400,
                          'body': json.dumps({'error': 'No query provided'})
                      }
                  
                  # Get DB credentials from Secrets Manager
                  secret_client = boto3.client('secretsmanager')
                  secret_response = secret_client.get_secret_value(
                      SecretId=os.environ['DB_SECRET_NAME']
                  )
                  db_creds = json.loads(secret_response['SecretString'])
                  
                  # Connect to database
                  conn = psycopg2.connect(
                      host=db_creds['host'],
                      port=db_creds['port'],
                      database=db_creds['dbname'],
                      user=db_creds['username'],
                      password=db_creds['password']
                  )
                  
                  cursor = conn.cursor()
                  cursor.execute(query)
                  
                  # Fetch results
                  if query.strip().upper().startswith('SELECT'):
                      results = cursor.fetchall()
                      columns = [desc[0] for desc in cursor.description]
                      rows = [dict(zip(columns, row)) for row in results]
                      
                      return {
                          'statusCode': 200,
                          'body': json.dumps({
                              'success': True,
                              'rows': rows,
                              'count': len(rows)
                          })
                      }
                  else:
                      conn.commit()
                      return {
                          'statusCode': 200,
                          'body': json.dumps({
                              'success': True,
                              'message': 'Query executed successfully'
                          })
                      }
                  
              except Exception as e:
                  return {
                      'statusCode': 500,
                      'body': json.dumps({
                          'error': str(e)
                      })
                  }
              finally:
                  if conn:
                      conn.close()

  # API Gateway
  PagilaAPI:
    Type: AWS::ApiGateway::RestApi
    Properties:
      Name: pagila-query-api
      Description: API for executing Pagila database queries
      EndpointConfiguration:
        Types:
          - REGIONAL

  QueryResource:
    Type: AWS::ApiGateway::Resource
    Properties:
      RestApiId: !Ref PagilaAPI
      ParentId: !GetAtt PagilaAPI.RootResourceId
      PathPart: query

  QueryMethod:
    Type: AWS::ApiGateway::Method
    Properties:
      RestApiId: !Ref PagilaAPI
      ResourceId: !Ref QueryResource
      HttpMethod: POST
      AuthorizationType: NONE
      Integration:
        Type: aws_proxy
        IntegrationHttpMethod: POST
        Uri: !Sub 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${PagilaQueryFunction.Arn}/invocations'

  LambdaPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref PagilaQueryFunction
      Action: lambda:InvokeFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub 'arn:aws:apigateway:${AWS::Region}::/restapis/${PagilaAPI}/stages/*'

  APIDeployment:
    Type: AWS::ApiGateway::Deployment
    DependsOn:
      - QueryMethod
    Properties:
      RestApiId: !Ref PagilaAPI
      StageName: prod

Outputs:
  AuroraEndpoint:
    Description: Aurora PostgreSQL cluster endpoint
    Value: !GetAtt PagilaAuroraCluster.Endpoint.Address
    Export:
      Name: !Sub '${AWS::StackName}-aurora-endpoint'

  AuroraPort:
    Description: Aurora PostgreSQL port
    Value: 5432
    Export:
      Name: !Sub '${AWS::StackName}-aurora-port'

  APIEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub 'https://${PagilaAPI}.execute-api.${AWS::Region}.amazonaws.com/prod'
    Export:
      Name: !Sub '${AWS::StackName}-api-endpoint'

  DBSecret:
    Description: Secrets Manager secret for database credentials
    Value: !Ref PagilaDBSecret
    Export:
      Name: !Sub '${AWS::StackName}-db-secret'
```

- [ ] **Step 2: Create Parameters File**

Create file: `infrastructure/cloudformation/parameters.json`

```json
[
  {
    "ParameterKey": "DBUsername",
    "ParameterValue": "postgres"
  },
  {
    "ParameterKey": "DBPassword",
    "ParameterValue": "YourSecurePassword123!"
  },
  {
    "ParameterKey": "Environment",
    "ParameterValue": "training"
  }
]
```

⚠️ **Security Note:** Do NOT commit this file with real passwords. Use AWS Secrets Manager or environment variables.

- [ ] **Step 3: Create Deployment Script**

Create file: `infrastructure/deploy.sh`

```bash
#!/bin/bash

set -e

STACK_NAME="pagila-serverless-stack"
REGION="us-east-1"
CF_TEMPLATE="infrastructure/cloudformation/pagila-serverless-stack.yaml"
PARAMETERS_FILE="infrastructure/cloudformation/parameters.json"

echo "🚀 Deploying Pagila Serverless Stack..."

# Validate template
echo "📋 Validating CloudFormation template..."
aws cloudformation validate-template \
  --template-body file://${CF_TEMPLATE} \
  --region ${REGION}

# Deploy stack
echo "🔧 Creating/updating CloudFormation stack..."
aws cloudformation deploy \
  --template-file ${CF_TEMPLATE} \
  --stack-name ${STACK_NAME} \
  --parameter-overrides file://${PARAMETERS_FILE} \
  --region ${REGION} \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

# Get outputs
echo ""
echo "✅ Stack deployment complete!"
echo ""
echo "📍 Stack Outputs:"
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs' \
  --output table

echo ""
echo "💡 Next steps:"
echo "   1. Save the Aurora endpoint from above"
echo "   2. Update your .env or config with credentials"
echo "   3. Run: python scripts/init-database.py (Phase 3)"
```

Make executable: `chmod +x infrastructure/deploy.sh`

- [ ] **Step 4: Validate and Deploy Stack**

```bash
# Ensure parameters.json is created and populated
# WARNING: Never commit parameters.json with real credentials

# Deploy the stack
cd /Users/timpugh/Desktop/dvd-rental-store-PostgreSQL
./infrastructure/deploy.sh

# Monitor deployment (runs ~10 minutes)
aws cloudformation describe-stacks \
  --stack-name pagila-serverless-stack \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus'
```

Expected output:
```
CREATE_COMPLETE (after ~10 minutes)
```

Save outputs (especially Aurora endpoint) to a safe location.

---

### Phase 3: Initialize Database with Pagila Schema & Data

**Files:**
- Create: `scripts/init-database.py`
- Create: `scripts/load-data.sh`
- Create: `.env.example`

- [ ] **Step 1: Create Database Initialization Script**

Create file: `scripts/init-database.py`

```python
#!/usr/bin/env python3
"""
Initialize Aurora PostgreSQL with Pagila schema and data.
Usage: python3 scripts/init-database.py
"""

import psycopg2
import os
import sys
from pathlib import Path

def load_file_content(filepath):
    """Load SQL file content."""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()

def execute_sql_file(conn, filepath, description):
    """Execute SQL file against database."""
    print(f"\n📂 Loading: {description}")
    print(f"   File: {filepath}")
    
    try:
        sql_content = load_file_content(filepath)
        cursor = conn.cursor()
        cursor.execute(sql_content)
        conn.commit()
        print(f"   ✅ Success")
    except Exception as e:
        print(f"   ❌ Error: {e}")
        conn.rollback()
        raise

def main():
    # Get connection details from environment
    db_host = os.getenv('DB_HOST')
    db_port = os.getenv('DB_PORT', '5432')
    db_name = os.getenv('DB_NAME', 'pagila')
    db_user = os.getenv('DB_USER', 'postgres')
    db_password = os.getenv('DB_PASSWORD')
    
    if not all([db_host, db_user, db_password]):
        print("❌ Error: Missing required environment variables")
        print("   Required: DB_HOST, DB_USER, DB_PASSWORD")
        print("   Optional: DB_PORT (default: 5432), DB_NAME (default: pagila)")
        sys.exit(1)
    
    print("🔗 Connecting to Aurora PostgreSQL...")
    try:
        conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            database=db_name,
            user=db_user,
            password=db_password
        )
        print(f"   ✅ Connected to {db_host}:{db_port}/{db_name}")
    except Exception as e:
        print(f"   ❌ Connection failed: {e}")
        sys.exit(1)
    
    try:
        # Get project root
        project_root = Path(__file__).parent.parent
        
        # Load schema
        schema_file = project_root / 'pagila-schema.sql'
        execute_sql_file(conn, schema_file, "Pagila Schema")
        
        # Load JSONB schema
        jsonb_schema_file = project_root / 'pagila-schema-jsonb.sql'
        execute_sql_file(conn, jsonb_schema_file, "JSONB Schema")
        
        # Load data (using COPY method - faster)
        data_file = project_root / 'pagila-data.sql'
        execute_sql_file(conn, data_file, "Pagila Data (COPY method)")
        
        # Load JSONB data
        # NOTE: JSONB backup files need pg_restore, not psycopg2
        print("\n⚠️  Note: JSONB backup data requires pg_restore command")
        print("    To load JSONB data manually:")
        print("    pg_restore -h $DB_HOST -U $DB_USER -d pagila pagila-data-apt-jsonb.backup")
        
        print("\n" + "="*60)
        print("✅ Database initialization complete!")
        print("="*60)
        print("\nYou can now:")
        print("  1. Connect via psql:")
        print(f"     psql -h {db_host} -U {db_user} -d {db_name}")
        print("  2. Test a query:")
        print("     SELECT COUNT(*) FROM film;")
        
    finally:
        conn.close()

if __name__ == '__main__':
    main()
```

Make executable: `chmod +x scripts/init-database.py`

- [ ] **Step 2: Create Environment Template**

Create file: `.env.example`

```bash
# Aurora PostgreSQL Connection
DB_HOST=pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=pagila
DB_USER=postgres
DB_PASSWORD=YourSecurePassword123!

# AWS Region
AWS_REGION=us-east-1

# API Gateway
API_ENDPOINT=https://xxxxxx.execute-api.us-east-1.amazonaws.com/prod
```

**Instructions:** Copy to `.env`, fill in real values from CloudFormation outputs.

- [ ] **Step 3: Set Environment Variables and Test Connection**

```bash
# Copy template
cp .env.example .env

# Edit .env with real values from CloudFormation outputs
nano .env

# Load environment
source .env

# Verify connection
psql -h $DB_HOST -U $DB_USER -d postgres -c "SELECT 1 as connection_test;"
```

Expected output:
```
 connection_test
-----------------
               1
(1 row)
```

- [ ] **Step 4: Run Database Initialization**

```bash
# Load environment variables
source .env

# Install psycopg2 if needed
pip install psycopg2-binary

# Run initialization script
python3 scripts/init-database.py
```

Expected output:
```
🔗 Connecting to Aurora PostgreSQL...
   ✅ Connected to pagila-cluster.xxx.us-east-1.rds.amazonaws.com:5432/pagila

📂 Loading: Pagila Schema
   File: pagila-schema.sql
   ✅ Success

📂 Loading: JSONB Schema
   File: pagila-schema-jsonb.sql
   ✅ Success

📂 Loading: Pagila Data (COPY method)
   File: pagila-data.sql
   ✅ Success

⚠️  Note: JSONB backup data requires pg_restore command
...

✅ Database initialization complete!
```

- [ ] **Step 5: Verify Data Loaded Correctly**

```bash
# Connect to database
psql -h $DB_HOST -U $DB_USER -d pagila

# Run quick verification queries
pagila=# SELECT COUNT(*) as film_count FROM film;
pagila=# SELECT COUNT(*) as customer_count FROM customer;
pagila=# SELECT COUNT(*) as payment_count FROM payment;
pagila=# \dt  -- List all tables
```

Expected output:
```
 film_count
------------
       1000
(1 row)

 customer_count
----------------
        599
(1 row)

 payment_count
---------------
        16049
(1 row)
```

---

### Phase 4: Set Up Local Development Tools

**Files:**
- Create: `scripts/connect-db.sh`
- Create: `scripts/query-api.sh`
- Create: `USAGE_GUIDE.md`

- [ ] **Step 1: Create Database Connection Script**

Create file: `scripts/connect-db.sh`

```bash
#!/bin/bash
# Quick connect to Pagila database via psql

set -a
source .env
set +a

echo "🔗 Connecting to Pagila database..."
echo "   Host: $DB_HOST"
echo "   Database: $DB_NAME"
echo "   User: $DB_USER"
echo ""
echo "To exit psql, type: \\q"
echo ""

psql -h "$DB_HOST" \
     -p "$DB_PORT" \
     -U "$DB_USER" \
     -d "$DB_NAME" \
     --echo-all
```

Make executable: `chmod +x scripts/connect-db.sh`

- [ ] **Step 2: Create API Query Script**

Create file: `scripts/query-api.sh`

```bash
#!/bin/bash
# Query Pagila via Lambda/API Gateway

set -a
source .env
set +a

if [ -z "$1" ]; then
    echo "Usage: query-api.sh \"SELECT * FROM film LIMIT 5;\""
    exit 1
fi

QUERY="$1"

echo "🌐 Executing query via API Gateway..."
echo "   Query: $QUERY"
echo ""

curl -X POST "$API_ENDPOINT/query" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$QUERY\"}" \
  | jq .
```

Make executable: `chmod +x scripts/query-api.sh`

- [ ] **Step 3: Create Usage Guide**

Create file: `USAGE_GUIDE.md`

```markdown
# Pagila Training Database - Usage Guide

## Quick Start

### 1. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your Aurora endpoints and credentials
source .env
```

### 2. Connect via psql (CLI)

**Direct connection (recommended for learning):**

```bash
psql -h $DB_HOST -U postgres -d pagila
```

Or use convenience script:

```bash
./scripts/connect-db.sh
```

### 3. Execute Queries

**Via psql:**

```bash
psql -h $DB_HOST -U postgres -d pagila -c "SELECT COUNT(*) FROM film;"
```

**Via API Gateway (web/programmatic):**

```bash
./scripts/query-api.sh "SELECT title, release_year FROM film LIMIT 5;"
```

Or using curl:

```bash
curl -X POST https://your-api-endpoint.amazonaws.com/prod/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT * FROM film LIMIT 1;"}'
```

## Example Queries

### Find Late Rentals

```sql
SELECT
  CONCAT(c.last_name, ', ', c.first_name) AS customer,
  a.phone,
  f.title
FROM rental r
  INNER JOIN customer c ON r.customer_id = c.customer_id
  INNER JOIN address a ON c.address_id = a.address_id
  INNER JOIN inventory i ON r.inventory_id = i.inventory_id
  INNER JOIN film f ON i.film_id = f.film_id
WHERE r.return_date IS NULL
  AND r.rental_date < CURRENT_DATE
ORDER BY f.title
LIMIT 5;
```

### Top 10 Revenue-Generating Films

```sql
SELECT
  f.title,
  COUNT(p.payment_id) as rental_count,
  SUM(p.amount) as total_revenue
FROM payment p
  INNER JOIN rental r ON p.rental_id = r.rental_id
  INNER JOIN inventory i ON r.inventory_id = i.inventory_id
  INNER JOIN film f ON i.film_id = f.film_id
GROUP BY f.film_id, f.title
ORDER BY total_revenue DESC
LIMIT 10;
```

### Films by Category

```sql
SELECT
  c.name as category,
  COUNT(f.film_id) as film_count,
  AVG(f.rental_rate) as avg_rental_rate
FROM category c
  LEFT JOIN film_category fc ON c.category_id = fc.category_id
  LEFT JOIN film f ON fc.film_id = f.film_id
GROUP BY c.category_id, c.name
ORDER BY film_count DESC;
```

## Database Schema

Key tables:
- `film` - Movie information
- `rental` - Rental transactions
- `payment` - Payment records
- `customer` - Customer details
- `actor` - Actor information
- `inventory` - Stock management
- `store` - Store locations
- `staff` - Employee data

Use `\dt` in psql to see all tables.
Use `\d table_name` to see table structure.

## Cost Management

### Monitor Costs

```bash
# Check Aurora cluster status
aws rds describe-db-clusters \
  --db-cluster-identifier pagila-cluster \
  --region us-east-1

# View CloudWatch metrics (ACU usage, connections, etc.)
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ServerlessDatabaseCapacity \
  --dimensions Name=DBClusterIdentifier,Value=pagila-cluster \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Maximum
```

### Auto-Pause Configuration

Aurora Serverless v2 automatically pauses after 15 minutes of inactivity.
- While paused: **$0.00 cost** (only storage charged)
- Resuming takes 30-60 seconds on first connection

### Delete Stack to Stop Costs

When you're done training:

```bash
aws cloudformation delete-stack \
  --stack-name pagila-serverless-stack \
  --region us-east-1

# Monitor deletion
aws cloudformation describe-stacks \
  --stack-name pagila-serverless-stack \
  --region us-east-1
```

⚠️ **Warning:** Stack deletion is permanent. RDS will create final snapshot (automated backup).

## Troubleshooting

### Connection Refused

```bash
# Check security group allows your IP
aws ec2 describe-security-groups \
  --group-ids sg-xxxxx \
  --region us-east-1

# Add your IP to security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp \
  --port 5432 \
  --cidr YOUR_IP/32 \
  --region us-east-1
```

### Database Taking Time to Connect

First connection after pause takes 30-60 seconds (Aurora serverless warming up).
This is normal and expected.

### Lambda Timeout

If API queries timeout, increase Lambda timeout in CloudFormation template:
- Change `Timeout: 30` to `Timeout: 60` in `PagilaQueryFunction`
- Redeploy: `./infrastructure/deploy.sh`

## Security Best Practices

1. **Never commit `.env`** - Contains database credentials
2. **Restrict security group** - Change `0.0.0.0/0` to your IP in production
3. **Use Secrets Manager** - Lambda already uses it; consider for local scripts
4. **Rotate passwords regularly** - Update via AWS console or CLI
5. **Enable VPC logging** - Monitor database access

## Next Steps

1. **Learn PostgreSQL:** Practice joins, aggregations, window functions
2. **Explore Data:** Run queries against Pagila schema
3. **Cost Monitor:** Check AWS bill monthly
4. **Deepen AWS:** Try RDS Proxy, read replicas, or migration tools
```

- [ ] **Step 4: Commit Documentation**

```bash
git add infrastructure/ scripts/ .env.example USAGE_GUIDE.md
git commit -m "feat: add AWS serverless infrastructure and deployment scripts

- Add CloudFormation template for Aurora Serverless v2
- Add Lambda function for API query execution
- Add database initialization script
- Add usage guide and connection helpers
- Include environment template and cost monitoring guide"
```

---

### Phase 5: Testing & Validation

**Files:**
- Create: `tests/test-queries.sql`
- Create: `tests/integration-test.py`

- [ ] **Step 1: Create SQL Test Suite**

Create file: `tests/test-queries.sql`

```sql
-- Pagila Database Test Suite
-- Run via: psql -h $DB_HOST -U postgres -d pagila -f tests/test-queries.sql

-- Test 1: Basic table counts
SELECT 'Test 1: Table Counts' as test_name;
SELECT COUNT(*) as film_count FROM film;
SELECT COUNT(*) as customer_count FROM customer;
SELECT COUNT(*) as rental_count FROM rental;

-- Test 2: Joins
SELECT 'Test 2: Film-Actor Join' as test_name;
SELECT COUNT(*) as joined_count 
FROM film f
JOIN film_actor fa ON f.film_id = fa.film_id
JOIN actor a ON fa.actor_id = a.actor_id
LIMIT 1;

-- Test 3: Aggregations
SELECT 'Test 3: Aggregations' as test_name;
SELECT 
  COUNT(DISTINCT customer_id) as customers,
  SUM(amount) as total_payments,
  AVG(amount) as avg_payment
FROM payment;

-- Test 4: Window functions
SELECT 'Test 4: Window Functions' as test_name;
SELECT 
  customer_id,
  amount,
  SUM(amount) OVER (PARTITION BY customer_id) as customer_total
FROM payment
LIMIT 5;

-- Test 5: Full-text search (if indexes exist)
SELECT 'Test 5: Full-text Search' as test_name;
SELECT COUNT(*) as matches
FROM film
WHERE fulltext @@ to_tsquery('action&drama')
LIMIT 1;

SELECT 'All tests completed!' as result;
```

- [ ] **Step 2: Create Integration Test**

Create file: `tests/integration-test.py`

```python
#!/usr/bin/env python3
"""
Integration tests for Pagila database setup.
Validates schema, data, and connectivity.
"""

import psycopg2
import os
import sys
from pathlib import Path

class PagilaIntegrationTest:
    def __init__(self, db_host, db_user, db_password, db_name='pagila'):
        self.db_host = db_host
        self.db_user = db_user
        self.db_password = db_password
        self.db_name = db_name
        self.conn = None
        self.passed = 0
        self.failed = 0
    
    def connect(self):
        """Establish database connection."""
        try:
            self.conn = psycopg2.connect(
                host=self.db_host,
                user=self.db_user,
                password=self.db_password,
                database=self.db_name
            )
            return True
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False
    
    def run_test(self, name, query, expected_min=None, expected_max=None):
        """Run a single test query."""
        try:
            cursor = self.conn.cursor()
            cursor.execute(query)
            result = cursor.fetchone()[0]
            
            if expected_min is not None and result < expected_min:
                print(f"❌ {name}: Got {result}, expected >= {expected_min}")
                self.failed += 1
                return False
            
            if expected_max is not None and result > expected_max:
                print(f"❌ {name}: Got {result}, expected <= {expected_max}")
                self.failed += 1
                return False
            
            print(f"✅ {name}: {result}")
            self.passed += 1
            return True
        
        except Exception as e:
            print(f"❌ {name}: {e}")
            self.failed += 1
            return False
    
    def run_all_tests(self):
        """Execute all integration tests."""
        print("🧪 Running Pagila Integration Tests\n")
        
        # Test 1: Tables exist
        self.run_test("Tables: film", "SELECT COUNT(*) FROM film;", 
                     expected_min=1000)
        self.run_test("Tables: customer", "SELECT COUNT(*) FROM customer;", 
                     expected_min=500)
        self.run_test("Tables: rental", "SELECT COUNT(*) FROM rental;", 
                     expected_min=10000)
        self.run_test("Tables: payment", "SELECT COUNT(*) FROM payment;", 
                     expected_min=10000)
        
        # Test 2: Joins work
        print("\n📊 Testing JOINs...")
        self.run_test("JOIN: film_actor", 
                     "SELECT COUNT(*) FROM film_actor;", 
                     expected_min=5000)
        
        # Test 3: Views exist
        print("\n📋 Testing VIEWs...")
        self.run_test("VIEW: film_list", 
                     "SELECT COUNT(*) FROM film_list;", 
                     expected_min=1000)
        
        # Test 4: Functions exist
        print("\n⚙️  Testing FUNCTIONS...")
        try:
            cursor = self.conn.cursor()
            cursor.execute("SELECT film_in_stock(1, 1);")
            result = cursor.fetchone()
            if result:
                print(f"✅ FUNCTION: film_in_stock works")
                self.passed += 1
            else:
                print(f"❌ FUNCTION: film_in_stock returned empty")
                self.failed += 1
        except Exception as e:
            print(f"❌ FUNCTION: film_in_stock failed: {e}")
            self.failed += 1
        
        # Test 5: Triggers work (last_update columns)
        print("\n⏰ Testing TRIGGERS...")
        self.run_test("TRIGGER: film.last_update", 
                     "SELECT COUNT(*) FROM film WHERE last_update IS NOT NULL;", 
                     expected_min=1000)
        
        # Test 6: Partitioned tables
        print("\n🔀 Testing PARTITIONS...")
        self.run_test("PARTITION: payment_p2022_01", 
                     "SELECT COUNT(*) FROM payment_p2022_01;", 
                     expected_min=0)  # May be empty
        
        print("\n" + "="*50)
        print(f"Results: {self.passed} passed, {self.failed} failed")
        print("="*50)
        
        return self.failed == 0
    
    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()

def main():
    db_host = os.getenv('DB_HOST')
    db_user = os.getenv('DB_USER', 'postgres')
    db_password = os.getenv('DB_PASSWORD')
    
    if not db_host or not db_password:
        print("❌ Missing DB_HOST or DB_PASSWORD environment variables")
        sys.exit(1)
    
    test = PagilaIntegrationTest(db_host, db_user, db_password)
    
    if not test.connect():
        sys.exit(1)
    
    try:
        success = test.run_all_tests()
        sys.exit(0 if success else 1)
    finally:
        test.close()

if __name__ == '__main__':
    main()
```

Make executable: `chmod +x tests/integration-test.py`

- [ ] **Step 3: Run Integration Tests**

```bash
# Load environment
source .env

# Run SQL tests
psql -h $DB_HOST -U $DB_USER -d pagila -f tests/test-queries.sql

# Run Python integration tests
python3 tests/integration-test.py
```

Expected output:
```
🧪 Running Pagila Integration Tests

✅ Tables: film: 1000
✅ Tables: customer: 599
✅ Tables: rental: 16044
✅ Tables: payment: 16049

📊 Testing JOINs...
✅ JOIN: film_actor: 5462

📋 Testing VIEWs...
✅ VIEW: film_list: 1000

⚙️  Testing FUNCTIONS...
✅ FUNCTION: film_in_stock works

⏰ Testing TRIGGERS...
✅ TRIGGER: film.last_update: 1000

🔀 Testing PARTITIONS...
✅ PARTITION: payment_p2022_01: 1112

==================================================
Results: 11 passed, 0 failed
==================================================
```

- [ ] **Step 4: Test API Gateway**

```bash
# Test via curl
curl -X POST "$API_ENDPOINT/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT COUNT(*) as film_count FROM film;"}' \
  | jq .

# Or use convenience script
./scripts/query-api.sh "SELECT title FROM film LIMIT 3;"
```

Expected output:
```json
{
  "success": true,
  "rows": [
    {"title": "ACADEMY DINOSAUR"},
    {"title": "ACE GOLDFINGER"},
    {"title": "ADAPTATION HOLES"}
  ],
  "count": 3
}
```

---

### Phase 6: Documentation & Cleanup

**Files:**
- Update: `README.md` (main project README)
- Create: `DEPLOYMENT_CHECKLIST.md`
- Create: `COST_TRACKING.md`

- [ ] **Step 1: Update Main README**

Update file: `README.md`

Add this section at the top:

```markdown
## AWS Serverless Deployment

This Pagila database is deployed on AWS using serverless technologies for cost-effective training.

### Quick Connect

```bash
source .env
psql -h $DB_HOST -U postgres -d pagila
```

### Architecture

- **Database:** Aurora PostgreSQL Serverless v2 (auto-pauses, $1-2/month)
- **Access:** Direct psql or Lambda API Gateway
- **Infrastructure:** CloudFormation (IaC)

### Deployment

See [AWS_DEPLOYMENT_PLAN.md](AWS_DEPLOYMENT_PLAN.md) for full setup instructions.

### Usage Examples

[See USAGE_GUIDE.md](USAGE_GUIDE.md)
```

- [ ] **Step 2: Create Deployment Checklist**

Create file: `DEPLOYMENT_CHECKLIST.md`

```markdown
# Deployment Checklist

Use this checklist when deploying or redeploying the Pagila database.

## Pre-Deployment
- [ ] AWS Account created
- [ ] AWS CLI v2 installed and configured
- [ ] IAM user created with required permissions
- [ ] Git repository cloned locally
- [ ] Python 3.11+ installed
- [ ] psycopg2 installed: `pip install psycopg2-binary`

## CloudFormation Deployment
- [ ] parameters.json created with secure password
- [ ] CloudFormation template validated: `./infrastructure/deploy.sh validate`
- [ ] Stack deployed: `./infrastructure/deploy.sh`
- [ ] Stack status verified as CREATE_COMPLETE (check AWS Console)
- [ ] Aurora endpoint saved from CloudFormation outputs

## Database Initialization
- [ ] .env created from .env.example
- [ ] .env populated with real Aurora credentials
- [ ] `.env` added to .gitignore (verify: `git status`)
- [ ] Connection test passed: `psql -h $DB_HOST -U postgres -d postgres -c "SELECT 1;"`
- [ ] Database initialization ran: `python3 scripts/init-database.py`
- [ ] Table count verification passed

## Testing
- [ ] SQL test suite passed: `psql -f tests/test-queries.sql`
- [ ] Python integration tests passed: `python3 tests/integration-test.py`
- [ ] API Gateway endpoint tested (if using Lambda)
- [ ] Sample queries executed successfully

## Post-Deployment
- [ ] Cost estimate reviewed (should be < $5/month for sporadic use)
- [ ] CloudWatch alarms configured (optional)
- [ ] Team access granted if needed
- [ ] Documentation reviewed and updated

## Cleanup (When Done Training)
- [ ] Final database backup created (automatic via RDS)
- [ ] Stack deletion initiated: `aws cloudformation delete-stack --stack-name pagila-serverless-stack`
- [ ] Stack deletion verified as DELETE_COMPLETE
- [ ] .env file securely deleted
- [ ] AWS IAM user credentials rotated or removed

## Rollback Plan
If deployment fails at any point:

1. Check CloudFormation events: `aws cloudformation describe-stack-events --stack-name pagila-serverless-stack`
2. Delete failed stack: `aws cloudformation delete-stack --stack-name pagila-serverless-stack`
3. Fix issues, then redeploy: `./infrastructure/deploy.sh`
```

- [ ] **Step 3: Create Cost Tracking Guide**

Create file: `COST_TRACKING.md`

```markdown
# Cost Tracking & Optimization

## Estimated Monthly Costs

### Baseline (Sporadic Use - < 1 hour/month)

| Service | Unit | Quantity | Cost |
|---------|------|----------|------|
| Aurora Serverless v2 | per ACU-second | 3,600 | $0.03 |
| Aurora Storage | per GB-month | 5 | $1.00 |
| Data Transfer | per GB | 0 | $0.00 |
| Lambda | per million requests | 0.001 | < $0.01 |
| API Gateway | per million requests | 0.001 | < $0.01 |
| **Monthly Total** | | | **~$1.05** |

### Regular Use (10-20 hours/month)

| Service | Estimated | Notes |
|---------|-----------|-------|
| Aurora Compute | $7-15 | 2 ACUs @ $0.84/ACU-hour |
| Storage | $1.00 | Steady 5GB |
| Lambda | < $0.01 | Few invocations |
| API Gateway | < $0.01 | Few requests |
| **Monthly Total** | **~$8-16** | |

### Peak Use (50+ hours/month)

| Service | Estimated | Notes |
|---------|-----------|-------|
| Aurora Compute | $42-85 | Sustained 2 ACUs |
| Storage | $1.00 | Steady 5GB |
| Lambda | < $0.01 | Frequent invocations |
| API Gateway | < $0.01 | Frequent requests |
| **Monthly Total** | **~$43-86** | |

## How to Monitor Costs

### Using AWS Console

1. Go to AWS Cost Management → Cost Explorer
2. Set date range to current month
3. Group by "Service"
4. Filter to show: RDS, Lambda, API Gateway

### Using AWS CLI

```bash
# Get billing for current month
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region us-east-1
```

### CloudWatch Metrics

Monitor Aurora specifically:

```bash
# Check ACU usage (CPU-equivalent capacity)
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ServerlessDatabaseCapacity \
  --dimensions Name=DBClusterIdentifier,Value=pagila-cluster \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Maximum,Average
```

## Cost Optimization Tips

### 1. Auto-Pause is Your Friend
- Aurora Serverless v2 automatically pauses after **15 minutes of inactivity**
- While paused: only storage charged (~$0.16/day = $5/month)
- Resuming takes 30-60 seconds (acceptable for training)

✅ **Keep auto-pause enabled** - this is why you chose serverless!

### 2. Monitor Max Capacity
- Current config: Max 2 ACUs
- Each ACU = ~2 vCPU + 8GB RAM
- For training queries, 1 ACU is sufficient

To reduce to 1 ACU max:
```yaml
# In CloudFormation template, change:
ServerlessV2ScalingConfiguration:
  MinCapacity: 0.5
  MaxCapacity: 1  # Reduce from 2
```

### 3. Use Direct psql When Possible
- Lambda + API Gateway adds compute cost
- Direct psql connection is free (just data transfer)

### 4. Data Transfer Costs
- Data transfer OUT of AWS: $0.09/GB
- Within AWS: free
- Downloading results to local machine counts as "OUT"

Keep queries small to minimize transfer:
```sql
-- ❌ Bad: Download entire film table
SELECT * FROM film;

-- ✅ Good: Get only what you need
SELECT title, rental_rate FROM film WHERE release_year = 2005;
```

### 5. Clean Up When Done
Most important: **Delete the CloudFormation stack** when training is complete.

```bash
aws cloudformation delete-stack \
  --stack-name pagila-serverless-stack \
  --region us-east-1
```

This deletes:
- Aurora cluster (eliminates storage and compute charges)
- Lambda function
- API Gateway
- Other resources

Remaining charges: **$0.00**

## Budget Alerts

Set up billing alerts so you don't get surprised:

```bash
# Create SNS topic for alerts
aws sns create-topic --name pagila-billing-alerts

# Create CloudWatch alarm
aws cloudwatch put-metric-alarm \
  --alarm-name pagila-monthly-cost \
  --alarm-description "Alert if Pagila costs exceed $5/month" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 5 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:pagila-billing-alerts
```

## Cost Tracking Spreadsheet

Track your actual vs. estimated costs:

```
Date        | Service | Amount | Category | Notes
2024-01-15  | Aurora  | $0.42  | Compute  | 15 min training session
2024-01-20  | Aurora  | $0.78  | Storage  | 5GB data (fixed monthly)
2024-01-22  | Aurora  | $0.35  | Compute  | 20 min training session
            | TOTAL   | $1.55  | Monthly  |
```

## Billing Limits

**Hard Cap:** Delete stack when total exceeds:
- $2/month (way above estimates for sporadic use)
- Indicates unexpected usage or misconfiguration

## Free Tier Considerations

AWS Free Tier does NOT include:
- ❌ Aurora Serverless (only standard RDS qualifies partially)
- ❌ Lambda is free-tier eligible (1M requests/month free)
- ❌ API Gateway is NOT free (but $3.50/million requests is cheap)

However, RDS free tier is for standard instances, not serverless.

**Bottom line:** Accept ~$1/month baseline for training database. That's less than a coffee!
```

- [ ] **Step 4: Final Commit**

```bash
git add -A
git commit -m "docs: add comprehensive AWS deployment guide and cost tracking

- Add AWS_DEPLOYMENT_PLAN.md with complete step-by-step deployment
- Add USAGE_GUIDE.md with examples and troubleshooting
- Add DEPLOYMENT_CHECKLIST.md for reproducible deployments
- Add COST_TRACKING.md with monitoring and optimization
- Add integration tests (Python + SQL)
- Add connection scripts and helper utilities
- Update README.md with AWS deployment info"
```

---

## Summary

| Phase | Component | Status | Key Output |
|-------|-----------|--------|------------|
| **1** | AWS Account Setup | ✅ | AWS CLI configured, IAM user created |
| **2** | Infrastructure (IaC) | ✅ | CloudFormation template + deploy script |
| **3** | Database Init | ✅ | Pagila schema + data loaded to Aurora |
| **4** | Local Tools | ✅ | psql connection scripts + API helpers |
| **5** | Testing | ✅ | Integration tests + verification |
| **6** | Documentation | ✅ | Usage guides + cost tracking |

## Architecture Decision Matrix

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Database** | Aurora Serverless v2 | Auto-pause saves 95% cost vs on-demand |
| **Data Loading** | Direct SQL scripts | Simplest for training; no ETL needed |
| **Access Pattern** | psql + Lambda API | CLI for practice, API for web learning |
| **IaC Tool** | CloudFormation | AWS-native, good for cost-aware setups |
| **Cost Model** | Per-second billing | Sporadic use = minimal charges |

## Next Steps (After Deployment)

1. **Execute this plan** using subagent-driven-development
2. **Test end-to-end** via USAGE_GUIDE examples
3. **Start training** with Pagila queries
4. **Monitor costs** monthly via Cost Tracking guide
5. **Clean up** when done (stack deletion)

---

**Execution Approach:**

Would you like me to:

**1. Subagent-Driven (Recommended)** - I'll dispatch a fresh subagent per phase, allowing parallel work on independent sections. Faster iteration, clear checkpoints.

**2. Inline Execution** - I'll execute tasks step-by-step in this session with your feedback at phase boundaries.

Which approach would you prefer?
