# AWS Account Setup Guide

This guide provides step-by-step instructions for setting up your AWS account and configuring local access to deploy the Pagila serverless database on AWS.

## Overview

Before deploying the infrastructure, you need to:
1. Create an AWS account
2. Install and configure AWS CLI locally
3. Create an IAM user with appropriate permissions
4. Verify AWS CLI access

**Time Estimate:** 15-30 minutes  
**Prerequisites:** Valid email address, computer with internet access

---

## Step 1: Create AWS Account

### 1.1 Create Free Tier Account

1. Visit [https://aws.amazon.com](https://aws.amazon.com)
2. Click **"Create an AWS Account"** button
3. Follow the sign-up wizard:
   - Enter email address
   - Create password (must be strong: uppercase, lowercase, numbers, symbols)
   - Fill in AWS account name (can be anything, e.g., "pagila-training")
   - Accept terms and continue

### 1.2 Billing Information

4. Enter billing address and payment method
   - AWS requires a valid credit card, even for free tier
   - You will NOT be charged for qualifying free-tier services
   - Aurora Serverless v2 is NOT free tier. It auto-pauses when idle, but the
     single-AZ Secrets Manager interface endpoint runs 24/7 (~$7/month). Run
     `cdk destroy` between sessions to avoid ongoing charges.

### 1.3 Verify Identity

5. Complete identity verification (phone or email)
6. Select a support plan (free "Basic" is sufficient)
7. Wait for email confirming account creation (1-5 minutes)

### 1.4 Login to AWS Console

8. Go to [https://console.aws.amazon.com](https://console.aws.amazon.com)
9. Login with your new email and password
10. You should see the AWS Management Console

✅ **Checkpoint:** You now have an AWS account with full access.

**Important:** The root account has unlimited permissions. Avoid using it for daily work. You'll create an IAM user next.

---

## Step 2: Configure AWS CLI Locally

### 2.1 Install AWS CLI v2

**macOS (using Homebrew):**

```bash
brew install awscliv2
```

**macOS (manual download):**

```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

**Linux:**

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

**Windows:**

Download installer from: [https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

### 2.2 Verify Installation

```bash
aws --version
```

Expected output (v2.x or higher):

```
aws-cli/2.13.25 Python/3.11.6 Darwin/23.0.0 exe/x86_64.arm64.darwin
```

✅ **Checkpoint:** AWS CLI v2 is installed and accessible.

---

## Step 3: Create IAM User for Programmatic Access

### 3.1 Access IAM Console

1. Login to [AWS Console](https://console.aws.amazon.com)
2. Search for **"IAM"** in the search bar
3. Click on **"Users"** in the left sidebar
4. Click **"Create user"** button

### 3.2 Create User

**User Details:**
- Username: `pagila-training`
- Do NOT enable AWS Management Console access (we only need programmatic access)
- Click **"Next"**

### 3.3 Attach Permissions

**Option A: Using Managed Policies (Recommended for beginners)**

On the "Add permissions" page:
1. Select **"Attach policies directly"**
2. Search for and attach these policies:
   - `AmazonRDSFullAccess` - For Aurora database management
   - `AmazonAPIGatewayFullAccess` - For API Gateway setup
   - `AWSLambdaFullAccess` - For Lambda function creation
   - `AWSCloudFormationFullAccess` - For infrastructure as code
   - `AmazonSSMFullAccess` - For Systems Manager Parameter Store

**Option B: Using Custom Policy (More restrictive)**

If you prefer least-privilege access, create this inline policy instead:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RDSAccess",
      "Effect": "Allow",
      "Action": [
        "rds:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LambdaAccess",
      "Effect": "Allow",
      "Action": [
        "lambda:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "APIGatewayAccess",
      "Effect": "Allow",
      "Action": [
        "apigateway:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudFormationAccess",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SSMAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMRoleAccess",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:DeleteRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:PassRole"
      ],
      "Resource": "arn:aws:iam::*:role/pagila-*"
    },
    {
      "Sid": "ECAccess",
      "Effect": "Allow",
      "Action": [
        "ec2:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchAccess",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:*",
        "logs:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SecretsManagerAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:*"
      ],
      "Resource": "*"
    }
  ]
}
```

### 3.4 Review and Create

1. Review the user details and attached policies
2. Click **"Create user"**
3. You'll see a success message with the user created

✅ **Checkpoint:** IAM user `pagila-training` has been created with necessary permissions.

### 3.5 Generate Access Keys

1. In the IAM Users list, click on **`pagila-training`** username
2. Go to the **"Security credentials"** tab
3. Under **"Access keys"**, click **"Create access key"**
4. Choose use case: **"Command Line Interface (CLI)"**
5. Acknowledge and click **"Create access key"**
6. You'll see a screen with:
   - Access Key ID
   - Secret Access Key

⚠️ **IMPORTANT:** Save these keys somewhere secure. You can only view the secret key once!

**NEVER share or commit these keys to version control.**

---

## Step 4: Configure AWS CLI with Credentials

### 4.1 Configure Credentials Locally

```bash
aws configure
```

When prompted, enter:

```
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

**Parameter Guide:**
- **AWS Access Key ID:** From IAM user creation (Step 3.5)
- **AWS Secret Access Key:** From IAM user creation (Step 3.5)
- **Default region:** `us-east-1` (recommended; can be changed to your nearest region)
- **Default output format:** `json` (recommended for scripting)

### 4.2 Verify Configuration

Check that credentials are stored:

```bash
ls ~/.aws/
```

Expected output:

```
config
credentials
```

View the credentials file (does not show secret key, only saved format):

```bash
cat ~/.aws/credentials
```

Expected output:

```
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

View the config file:

```bash
cat ~/.aws/config
```

Expected output:

```
[default]
region = us-east-1
output = json
```

✅ **Checkpoint:** AWS CLI is configured with your credentials.

---

## Step 5: Verify AWS CLI Access

### 5.1 Test Connection

```bash
aws sts get-caller-identity
```

**Expected output:**

```json
{
    "UserId": "AIDAI2DXXXXXXXXX:pagila-training",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/pagila-training"
}
```

If you see this output with your AWS account ID and user ARN, AWS CLI is properly configured! ✅

### 5.2 Common Connection Errors

**Error: "Unable to locate credentials"**

Solution:
```bash
# Run aws configure again
aws configure

# Or set environment variables
export AWS_ACCESS_KEY_ID=your_key_id
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=us-east-1
```

**Error: "InvalidUserID.NotFound"**

Solution:
- Verify user was created in IAM console
- Wait a few seconds for IAM to propagate
- Try again

**Error: "UnauthorizedOperation"**

Solution:
- Verify IAM user has attached policies (Step 3.3)
- Ensure policies include required services (RDS, Lambda, API Gateway, CloudFormation)

### 5.3 Test Specific Service Access

Verify RDS access (used for Aurora):

```bash
aws rds describe-db-instances --region us-east-1
```

Expected output (may be empty if no instances exist yet):

```json
{
    "DBInstances": []
}
```

Verify Lambda access:

```bash
aws lambda list-functions --region us-east-1
```

Expected output:

```json
{
    "Functions": []
}
```

✅ **Checkpoint:** AWS CLI can access your services.

---

## Step 6: Security Best Practices

### 6.1 Credential File Permissions

Ensure only you can read the credentials file:

```bash
chmod 600 ~/.aws/credentials
chmod 600 ~/.aws/config
```

Verify permissions:

```bash
ls -l ~/.aws/credentials
```

Expected output:

```
-rw------- 1 user staff 123 Jan 15 10:30 /Users/user/.aws/credentials
```

### 6.2 Avoid Hardcoding Credentials

**❌ NEVER do this:**

```bash
# Bad: hardcoded credentials in script
aws rds create-db-instance \
  --db-instance-identifier pagila \
  --db-instance-class db.serverless \
  --access-key-id AKIA... \
  --secret-access-key ...
```

**✅ DO this instead:**

```bash
# AWS CLI automatically uses credentials from ~/.aws/credentials
aws rds create-db-instance \
  --db-instance-identifier pagila \
  --db-instance-class db.serverless
```

### 6.3 Environment Variables

If needed, use environment variables (more secure than hardcoding):

```bash
export AWS_ACCESS_KEY_ID=your_access_key_id
export AWS_SECRET_ACCESS_KEY=your_secret_access_key
export AWS_DEFAULT_REGION=us-east-1

# AWS CLI will use these variables
aws sts get-caller-identity
```

### 6.4 Rotate Credentials Regularly

Every 90 days, rotate your IAM user's access keys:

1. Go to IAM → Users → pagila-training
2. Security credentials tab
3. Create new access key
4. Update ~/.aws/credentials with new key
5. Delete old access key
6. Test connection: `aws sts get-caller-identity`

### 6.5 Use IAM Roles in Production

For Lambda and other AWS services, use IAM Roles instead of embedding credentials. This is already done in the CloudFormation template.

### 6.6 .gitignore Configuration

Ensure credentials are never committed:

```bash
# Check .gitignore includes AWS credentials
grep -E "\.aws|\.env" .gitignore
```

Add to `./.gitignore` if not present:

```
# AWS credentials
.aws/
.env
.env.local
.env.*.local

# Sensitive files
**/credentials
**/config
parameters.json
```

---

## Step 7: Region Selection

### 7.1 Choosing Your Region

The example uses `us-east-1`, but you can use any region:

**Popular choices:**
- `us-east-1` (N. Virginia) - Default, cheapest in US
- `us-west-2` (Oregon) - Good for West Coast
- `eu-west-1` (Ireland) - Good for Europe
- `ap-southeast-1` (Singapore) - Good for Asia-Pacific

### 7.2 Check Available Services

Not all services are available in all regions. Verify Aurora Serverless v2 is available:

```bash
aws ec2 describe-availability-zones --region us-east-1
```

Aurora Serverless v2 is available in most regions. If you're uncertain, use `us-east-1`.

### 7.3 Update Region in Configuration

To use a different region than us-east-1:

```bash
aws configure set region us-west-2
```

Or export as environment variable:

```bash
export AWS_DEFAULT_REGION=us-west-2
```

---

## Step 8: Troubleshooting

### Problem: "InvalidClientTokenId" when running AWS CLI commands

**Cause:** Incorrect access key or secret key

**Solution:**
1. Verify credentials in AWS IAM console
2. Re-run `aws configure`
3. Double-check for trailing spaces or typos

### Problem: "UnauthorizedOperation" when deploying

**Cause:** IAM user missing required permissions

**Solution:**
1. Go to IAM → Users → pagila-training
2. Check attached policies include all 5 required policies
3. Wait a few minutes for permissions to propagate
4. Try command again

### Problem: "ResourceInUseByDeploymentException"

**Cause:** Trying to create resources that already exist

**Solution:**
1. Check AWS Console for existing resources
2. Either delete them or use different names
3. Re-run deployment

### Problem: "MissingRegion: Could not construct an endpoint"

**Cause:** Region not specified in configuration

**Solution:**
```bash
export AWS_DEFAULT_REGION=us-east-1
aws sts get-caller-identity
```

### Problem: "Unable to connect to the endpoint URL"

**Cause:** Service not available in selected region

**Solution:**
1. Check service availability for your region
2. Switch to us-east-1: `export AWS_DEFAULT_REGION=us-east-1`
3. Try again

---

## Next Steps

Once you've completed this setup guide:

1. ✅ You have an AWS account
2. ✅ AWS CLI v2 is installed and configured
3. ✅ IAM user `pagila-training` has necessary permissions
4. ✅ You can access AWS services via CLI

**Next:** Proceed to [Phase 2: Infrastructure as Code (CloudFormation)](../AWS_DEPLOYMENT_PLAN.md#phase-2-infrastructure-as-code-cloudformation) in the deployment plan to create the database infrastructure.

---

## Quick Reference

### AWS CLI Useful Commands

```bash
# Test connection
aws sts get-caller-identity

# List all RDS instances
aws rds describe-db-instances

# List all Lambda functions
aws lambda list-functions

# List all CloudFormation stacks
aws cloudformation list-stacks

# View specific CloudFormation stack status
aws cloudformation describe-stacks --stack-name pagila-serverless-stack

# Get region info
aws ec2 describe-availability-zones

# Test API endpoint
curl -X POST https://your-api-endpoint/query \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT 1;"}'
```

### Credential File Locations

- **macOS/Linux:** `~/.aws/credentials` and `~/.aws/config`
- **Windows:** `%USERPROFILE%\.aws\credentials` and `%USERPROFILE%\.aws\config`

### Important File Permissions

```bash
# Make credentials readable only by you
chmod 600 ~/.aws/credentials
chmod 600 ~/.aws/config

# Verify
ls -l ~/.aws/
```

---

## Security Checklist

- [ ] AWS account created with strong password
- [ ] MFA enabled on root account (optional but recommended)
- [ ] IAM user `pagila-training` created
- [ ] All 5 required policies attached to IAM user
- [ ] Access keys generated and saved securely
- [ ] AWS CLI v2 installed and configured
- [ ] Credentials file permissions set to 600
- [ ] `aws sts get-caller-identity` returns your account
- [ ] AWS credentials never committed to version control
- [ ] .gitignore includes .aws/ and .env files

---

## Getting Help

- **AWS CLI Documentation:** https://docs.aws.amazon.com/cli/
- **IAM User Guide:** https://docs.aws.amazon.com/iam/
- **RDS Aurora Serverless:** https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/aurora-serverless.html
- **AWS Support:** https://console.aws.amazon.com/support/

---

**Last Updated:** June 2024  
**AWS CLI Version:** v2.13+  
**Aurora Serverless Version:** v2
