# Cost Tracking & Optimization Guide

Understand, monitor, and minimize costs for the AWS Serverless Pagila training database. This guide covers cost structure, monitoring procedures, and optimization strategies.

---

## 1. Cost Breakdown (Estimated)

### Sporadic Use (< 1 hour/month)

Most typical scenario for training use.

| Service | Unit | Quantity | Unit Cost | Total |
|---------|------|----------|-----------|-------|
| **Aurora Serverless v2** | | | | |
| Compute | ACU-second | 3,600 (1 hr) | $0.29 | $1.04 |
| Storage | GB/month | 5 | $0.20 | $1.00 |
| Data Transfer | GB | 0 | $0.09 | $0.00 |
| **Lambda** | requests/month | 10 | $0.20/million | < $0.01 |
| **API Gateway** | requests/month | 10 | $3.50/million | < $0.01 |
| **Backup Storage** | GB/month | 0 | $0.095 | $0.00 |
| **TOTAL (Monthly)** | | | | **~$2.05** |

**Key Insight:** Most cost is from Aurora storage ($1/month) which persists even when paused. Compute only charges when actively running.

### Regular Use (10-20 hours/month)

Active training with multiple sessions.

| Service | Monthly Estimate | Notes |
|---------|-----------------|-------|
| Aurora Compute | $7-14 | 2 ACUs × $0.84/ACU-hour × 10-20 hrs |
| Aurora Storage | $1.00 | Fixed 5GB data |
| Lambda | < $0.01 | Hundreds of invocations |
| API Gateway | < $0.01 | Hundreds of requests |
| **TOTAL** | **~$8-15** | |

### Peak Use (50+ hours/month)

Intensive training or production-like testing.

| Service | Monthly Estimate | Notes |
|---------|-----------------|-------|
| Aurora Compute | $42-84 | 2 ACUs × $0.84/ACU-hour × 50-100 hrs |
| Aurora Storage | $1.00 | Fixed 5GB data |
| Lambda | < $0.01 | Thousands of invocations |
| API Gateway | < $0.01 | Thousands of requests |
| **TOTAL** | **~$43-85** | Still cheaper than on-demand RDS |

### Cost Comparison Table

How serverless compares to alternatives:

| Setup | Monthly Cost | Pros | Cons |
|-------|------------|------|------|
| **Serverless (This Plan)** | $2-85 | Auto-pause, pay/second, minimal config | Need credential management |
| **RDS On-Demand** | $50-100 | Always available, AWS-managed | Billed even when idle |
| **EC2 + Self-managed PG** | $30-50 | Full control, scalable | Manual backups, patching |
| **Local PostgreSQL** | $0 | Free, full control | Hardware costs, no cloud backup |

---

## 2. Cost Monitoring

### Using AWS Console

**Method 1: Cost Explorer (Visual Dashboard)**

1. Go to AWS Console → Cost Management → Cost Explorer
2. Set date range to current month
3. Group by "Service"
4. Filter by:
   - Amazon RDS (Aurora compute + storage)
   - AWS Lambda
   - Amazon API Gateway
5. Compare to baseline estimate

**Method 2: Billing Dashboard**

1. Go to AWS Console → Billing Dashboard
2. See "Month-to-date spend" at top
3. "Forecast" shows predicted monthly total
4. Click "View Bill" for detailed breakdown

### Using AWS CLI

**Get Current Month Cost**

```bash
# Get total cost for current month
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region us-east-1
```

Expected output:
```json
{
  "ResultsByTime": [
    {
      "Total": {
        "BlendedCost": {
          "Amount": "2.15",
          "Unit": "USD"
        }
      },
      "Groups": [
        {
          "Keys": ["Amazon Relational Database Service"],
          "Metrics": {"BlendedCost": {"Amount": "2.04", "Unit": "USD"}}
        },
        {
          "Keys": ["AWS Lambda"],
          "Metrics": {"BlendedCost": {"Amount": "0.00", "Unit": "USD"}}
        }
      ]
    }
  ]
}
```

**Get Daily Cost Trend**

```bash
# See cost breakdown by day
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity DAILY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region us-east-1 \
  | jq '.ResultsByTime[] | {Date: .TimePeriod.Start, RDS: (.Groups[] | select(.Keys[0]=="Amazon Relational Database Service") | .Metrics.BlendedCost.Amount), Lambda: (.Groups[] | select(.Keys[0]=="AWS Lambda") | .Metrics.BlendedCost.Amount)}'
```

### CloudWatch Metrics

**Monitor Aurora Serverless Capacity (ACU Usage)**

```bash
# Get maximum ACU capacity used in last 24 hours
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ServerlessDatabaseCapacity \
  --dimensions Name=DBClusterIdentifier,Value=pagila-cluster \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S)Z \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)Z \
  --period 3600 \
  --statistics Maximum,Average \
  --region us-east-1
```

Expected output:
```json
{
  "Datapoints": [
    {
      "Timestamp": "2024-01-15T18:00:00Z",
      "Maximum": 2.0,
      "Average": 1.5,
      "Unit": "ACU"
    }
  ]
}
```

**Monitor Lambda Invocations**

```bash
# Get Lambda function invocations (free tier = 1M/month)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=pagila-query-executor \
  --start-time $(date -u -d '1 month ago' +%Y-%m-%dT%H:%M:%S)Z \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)Z \
  --period 86400 \
  --statistics Sum \
  --region us-east-1
```

**Monitor API Gateway Requests**

```bash
# Get API Gateway request count (only billable if > 1M/month)
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=pagila-query-api \
  --start-time $(date -u -d '1 month ago' +%Y-%m-%dT%H:%M:%S)Z \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)Z \
  --period 86400 \
  --statistics Sum \
  --region us-east-1
```

### Create a Monitoring Script

Save as `scripts/monitor-costs.sh`:

```bash
#!/bin/bash
# Monitor Pagila costs and usage

echo "=== Pagila Cost & Usage Report ==="
echo "Date: $(date)"
echo ""

echo "📊 Current Month Cost (AWS CLI)"
aws ce get-cost-and-usage \
  --time-period Start=$(date -d 'first day of month' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region us-east-1 | jq '.ResultsByTime[0].Groups[] | "\(.Keys[0]): $\(.Metrics.BlendedCost.Amount)"'

echo ""
echo "📈 Aurora Capacity (Last 24h)"
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ServerlessDatabaseCapacity \
  --dimensions Name=DBClusterIdentifier,Value=pagila-cluster \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S)Z \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)Z \
  --period 3600 \
  --statistics Maximum,Average \
  --region us-east-1 | jq '.Datapoints | .[].Maximum, .[].Average' | awk '{print "ACU: " $1}'

echo ""
echo "💾 Database Storage"
aws rds describe-db-clusters \
  --db-cluster-identifier pagila-cluster \
  --region us-east-1 | jq '.DBClusters[0] | "Storage: \(.AllocatedStorage)GB, Backup Retention: \(.BackupRetentionPeriod)d"'
```

Make executable: `chmod +x scripts/monitor-costs.sh`

Run anytime: `./scripts/monitor-costs.sh`

---

## 3. Cost Optimization Tips

### 1. Aurora Auto-Pause is Your Best Friend

**What it does:** Database automatically pauses after 15 minutes of inactivity.

```
While PAUSED:
- ✅ Only storage charged (~$0.16/day = $5/month)
- ✅ No compute costs
- ⏱️ Resume time: 30-60 seconds on first connection

While RUNNING:
- 🔴 Compute charged at $0.29/ACU-second
- 💸 2 ACUs running = $2.08/hour
```

**Status:** Enabled by default in CloudFormation template

**Verify auto-pause setting:**

```bash
aws rds describe-db-clusters \
  --db-cluster-identifier pagila-cluster \
  --region us-east-1 \
  --query 'DBClusters[0].ServerlessV2ScalingConfiguration'
```

Expected output:
```json
{
  "MinCapacity": 0.5,
  "MaxCapacity": 2.0
}
```

✅ Keep this enabled. Auto-pause is why serverless is 95% cheaper than on-demand.

### 2. Reduce Maximum ACU Capacity

**Current:** Max 2 ACUs
**Recommendation:** Reduce to 1 ACU for training (sufficient for most queries)

This cuts potential compute costs in half without affecting interactive query performance.

**Modify in CloudFormation:**

```bash
# Step 1: Edit CDK code
nano infrastructure/cdk/lib/pagila-stack.ts

# Step 2: Find ServerlessV2ScalingConfiguration
# Change: MaxCapacity: 2
# To:     MaxCapacity: 1

# Step 3: Redeploy
cd infrastructure/cdk
npm run build
cdk deploy
```

Before and after:
- 1 hour/month @ 2 ACU max: $1.04 compute
- 1 hour/month @ 1 ACU max: $0.52 compute

### 3. Use Direct psql (Avoid Lambda Overhead)

**Cost comparison for 100 queries:**

| Method | Charges | Cost |
|--------|---------|------|
| Direct psql | Networking only | $0.00 |
| Lambda + API | Lambda + Gateway + DB | $0.00-0.03 |

Lambda compute is minimal for training, but psql is cheaper AND faster.

**Recommendation:** Use psql for learning, Lambda only for web UI testing.

```bash
# ✅ Cheaper: Direct psql
psql -h $DB_HOST -U postgres -d pagila -c "SELECT * FROM film LIMIT 10;"

# 🔴 Costlier: Lambda API
./scripts/query-api.sh "SELECT * FROM film LIMIT 10;"
```

### 4. Minimize Data Transfer

**Data transfer rates:**
- Within AWS region: FREE
- Out of AWS (to your machine): $0.09/GB
- Cross-region: $0.01-0.02/GB

**Cost example:**
- Download 1 GB of results: $0.09
- Download 10 GB of results: $0.90
- Download 100 GB: $9.00 ❌

**Optimize queries to return less data:**

```sql
-- ❌ BAD: Download entire film table
SELECT * FROM film;

-- ✅ GOOD: Get only needed columns
SELECT film_id, title, rental_rate FROM film;

-- ✅ BETTER: Add WHERE clause
SELECT film_id, title FROM film 
WHERE rental_rate > 4.99;

-- ✅ BEST: Limit result set
SELECT film_id, title FROM film 
WHERE rental_rate > 4.99 LIMIT 100;
```

### 5. Delete Resources When Done

**Most important optimization:**

Once training is complete, DELETE THE ENTIRE STACK.

```bash
# This stops ALL charges immediately
aws cloudformation delete-stack \
  --stack-name pagila-serverless \
  --region us-east-1

# Remaining cost: $0.00
```

What gets deleted:
- ✅ Aurora cluster (eliminate compute + most storage)
- ✅ Lambda function
- ✅ API Gateway
- ✅ All associated resources

What persists:
- ✅ Automated backup snapshots (low cost, useful for reference)
- ❌ Manual snapshots (if you created them)

---

## 4. Budget Alerts

Set up automatic alerts to prevent unexpected charges.

### Method 1: AWS Budgets (Recommended)

Most user-friendly approach.

1. Go to AWS Console → Budgets → Create Budget
2. Select "Cost budget"
3. Configure:
   - Budget name: "Pagila Training"
   - Amount: $5.00/month
   - Alerts: Alert at $3.00 (60%) and $5.00 (100%)
   - Alert email: your@email.com
4. Create budget

Now you'll get emails when approaching limit.

### Method 2: CloudWatch Alarm + SNS

Programmatic approach for automation.

```bash
# Step 1: Create SNS topic for emails
TOPIC_ARN=$(aws sns create-topic \
  --name pagila-billing-alerts \
  --region us-east-1 \
  --query 'TopicArn' \
  --output text)

echo "SNS Topic: $TOPIC_ARN"

# Step 2: Subscribe to topic
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint your@email.com \
  --region us-east-1

# Step 3: Confirm subscription (check email)
# Click "Confirm subscription" link

# Step 4: Create billing alarm
aws cloudwatch put-metric-alarm \
  --alarm-name pagila-monthly-cost \
  --alarm-description "Alert if Pagila costs exceed $5/month" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 5.00 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions $TOPIC_ARN \
  --region us-east-1
```

Check if alarm was created:
```bash
aws cloudwatch describe-alarms \
  --alarm-names pagila-monthly-cost \
  --region us-east-1
```

### Method 3: Reserved Instances Alerts (Not Applicable Here)

Serverless Aurora doesn't support Reserved Instances, so skip this.

---

## 5. Usage Tracking Spreadsheet Template

Track actual costs against estimates to refine forecasts.

### CSV Format

```csv
Date,Service,Amount (USD),Category,Hours Used,Query Count,Notes
2024-01-15,Aurora,0.42,Compute,0.5,12,Morning training session
2024-01-15,Aurora,0.78,Storage,N/A,N/A,5GB monthly persistent
2024-01-22,Aurora,0.35,Compute,0.4,8,Afternoon practice queries
2024-01-28,Lambda,0.00,Compute,N/A,100,Free tier not exceeded
2024-01-31,Aurora,0.50,Compute,0.6,15,Final review session
,TOTAL,2.05,Monthly,1.9,135,Under budget!
```

### Spreadsheet Columns

| Column | Purpose | Example |
|--------|---------|---------|
| Date | When used | 2024-01-15 |
| Service | AWS service | Aurora, Lambda, API Gateway |
| Amount | Cost charged | 0.42 |
| Category | Cost type | Compute, Storage, Transfer |
| Hours Used | Training time | 0.5 |
| Query Count | Queries executed | 12 |
| Notes | Context | "Morning session", "Joins practice" |

### Monthly Summary Section

```
MONTH: January 2024

Actual Spend:      $2.05
Estimated Spend:   $2.00
Variance:          +$0.05 (2% over)

BREAKDOWN:
Aurora Compute:    $1.27 (61%)
Aurora Storage:    $0.78 (38%)
Lambda:            $0.00 (0%)
API Gateway:       $0.00 (0%)

USAGE METRICS:
Total Training Hours:  1.9 hours
Total Queries:         135
Avg Cost Per Query:    $0.015

ACTIONS FOR NEXT MONTH:
- [ ] Keep Max ACU at 2 (or reduce to 1)
- [ ] Continue using direct psql
- [ ] Monitor for unexpected spikes
```

---

## 6. Free Tier Considerations

**Important:** Most services are NOT free tier eligible.

### Services Included in Free Tier

| Service | Free Tier Limit | Pagila Usage | Verdict |
|---------|-----------------|-------------|---------|
| Lambda | 1 million requests/month | ~100-1000/month | ✅ Well under limit |
| CloudWatch | Basic metrics | Basic monitoring | ✅ No charge |
| CloudFormation | No charges | Used for IaC | ✅ No charge |

### Services NOT Included in Free Tier

| Service | Free Tier Status | Notes |
|---------|------------------|-------|
| Aurora Serverless | ❌ NOT free | Only standard RDS included |
| API Gateway | ❌ NOT free | $3.50 per million requests |
| Data Transfer Out | ❌ NOT free | $0.09/GB beyond 1GB/month |

### Free Tier Limits Specific to This Setup

- **RDS free tier:** Standard instances only (db.t2.micro, db.t3.micro), NOT serverless
- **Data transfer out:** First 1GB/month free, then $0.09/GB
- **Aurora Serverless storage:** Charges from day 1

### Bottom Line

**Accept ~$1/month as baseline cost for training database:**
- $0.20/hour Aurora storage (regardless of usage)
- ~$0.80/month compute for 1 hour/month training
- Total: ~$1.00/month
- **Cost context:** Less than one coffee ☕

---

## 7. Advanced Cost Analysis

### Break-Even Analysis: Serverless vs On-Demand

When does serverless become cheaper?

```
Serverless Cost = $2.05/month (storage + minimal usage)
On-Demand RDS  = $50-100/month (always running)

Break-even point: 0.1 hours/month (6 minutes!)

If you use database > 6 minutes/month total: ✅ Serverless is cheaper
If you use < 6 minutes/month: On-demand still cheaper (but barely)
```

### Compute Cost Per Hour

```
Aurora Serverless (2 ACU):   $1.68/hour (2 ACUs × $0.84)
Aurora On-Demand (db.r5.large): $2.15/hour
EC2 t3.medium + self-managed:   $0.0416/hour (but manual work)

For 1 hour/month training: Serverless wins
For 10+ hours/month:       Still Serverless wins if auto-paused
```

### Cost Scaling Example

How costs change with usage:

```
Usage Scenario              | Monthly Cost | Cost/Hour
No usage                    | $1.00        | N/A
Sporadic (1 hour/month)    | $2.05        | $2.05
Light (10 hours/month)     | $9.40        | $0.94
Regular (20 hours/month)   | $17.80       | $0.89
Heavy (50 hours/month)     | $43.00       | $0.86
```

**Key insight:** Storage dominates for light use. Compute becomes proportional for heavy use.

### Cost Attribution

Where does your money go?

```
For Sporadic Training (1 hr/month):

Aurora Storage:     $1.00  (49%) ← Largest component
Aurora Compute:     $1.04  (51%) ← Only when running
Lambda:            $0.00   (0%)
API Gateway:       $0.00   (0%)
------------------------
TOTAL:             $2.05  (100%)

Action: To cut costs, delete stack when done training
        (eliminates $1.00 storage cost)
```

---

## 8. Billing Limits & Safeguards

Prevent runaway costs with hard limits.

### Recommended Billing Limits

**For Training (Sporadic Use):**

```
Hard limit:     $5.00/month
Alert limit:    $3.00/month (60% of cap)
Expected cost:  $2.00/month
```

If you reach $5.00/month, something is wrong:

| Likely cause | Action |
|--------------|--------|
| Database left running 24/7 | Check auto-pause settings |
| Large data transfer | Minimize result sets in queries |
| Many Lambda invocations | Use direct psql instead |

**Recovery action if limit exceeded:**

```bash
# Delete stack immediately to stop charges
aws cloudformation delete-stack \
  --stack-name pagila-serverless \
  --region us-east-1
```

**For Production (Continuous Use):**

```
Hard limit:     $500/month
Alert limit:    $300/month (60% of cap)
Expected cost:  $200-400/month
```

### Set Up Hard Stop Automation

Create a Lambda function that deletes stack if costs exceed limit:

```python
# scripts/auto-shutdown.py (example)
import boto3
import os

ce_client = boto3.client('ce')
cf_client = boto3.client('cloudformation')

def check_costs():
    """Check current month costs."""
    response = ce_client.get_cost_and_usage(
        TimePeriod={
            'Start': '2024-01-01',
            'End': '2024-01-31'
        },
        Granularity='MONTHLY',
        Metrics=['BlendedCost'],
        GroupBy=[{'Type': 'DIMENSION', 'Key': 'SERVICE'}]
    )
    
    total = 0
    for group in response['ResultsByTime'][0]['Groups']:
        total += float(group['Metrics']['BlendedCost']['Amount'])
    
    return total

def shutdown_if_over_budget(limit=5.00):
    """Delete stack if costs exceed limit."""
    current_cost = check_costs()
    
    if current_cost > limit:
        print(f"⚠️  Cost ${current_cost:.2f} exceeds limit ${limit:.2f}")
        print("🛑 Shutting down stack...")
        
        cf_client.delete_stack(StackName='pagila-serverless')
        return True
    
    print(f"✅ Current cost: ${current_cost:.2f} (limit: ${limit:.2f})")
    return False

if __name__ == '__main__':
    shutdown_if_over_budget()
```

Run manually to check:
```bash
python3 scripts/auto-shutdown.py
```

Or schedule via CloudWatch Events (see DEPLOYMENT_CHECKLIST.md Step 6 for scheduling).

---

## 9. Cost Analysis Examples

Real-world scenarios with cost breakdowns.

### Scenario 1: Weekend Training

**Usage:** 2-hour session on Saturday morning

```
Duration: 2 hours
Queries: 25
Results downloaded: ~50 MB

COSTS:
Aurora Compute: 2 hrs × $0.84/hr × 2 ACU = $3.36
Aurora Storage: $0.78 (fixed)
Data Transfer: 0.05 GB × $0.09 = $0.005
Lambda/API: Negligible
------------------------
SESSION TOTAL: $4.14

Plus next 28 days with auto-pause:
Aurora Storage: $0.78/day × 28 = $21.84
------------------------
MONTH TOTAL: ~$26.00
```

✅ Still well within $50/month budget for RDS on-demand

### Scenario 2: Multi-Day Bootcamp

**Usage:** 5-day intensive training, 8 hours/day

```
Duration: 40 hours
Queries: 500
Results: 1 GB

COSTS:
Aurora Compute: 40 hrs × $0.84/hr × 2 ACU = $67.20
Aurora Storage: $0.78 (fixed)
Data Transfer: 1 GB × $0.09 = $0.90
Lambda/API: $0.00 (free tier)
------------------------
BOOTCAMP TOTAL: $68.88

COMPARISON:
Serverless: $68.88
On-demand: $100-150 (full month)
Savings: ~$40-80 ✅
```

### Scenario 3: Ongoing Development

**Usage:** 4 hours/week, full month

```
Duration: 16 hours/month
Queries: 200
Results: 500 MB

COSTS:
Aurora Compute: 16 hrs × $0.84/hr × 2 ACU = $26.88
Aurora Storage: $0.78 × 30 days = $23.40
Data Transfer: 0.5 GB × $0.09 = $0.045
Lambda/API: $0.00 (free tier)
------------------------
MONTH TOTAL: $50.30

COMPARISON:
Serverless: $50.30
On-demand RDS: $50-100 (db.r5.large)
EC2 + Self-managed: $30-50 + management time
Verdict: Serverless is competitive, lower ops burden
```

---

## 10. Cost Optimization Checklist

Before going live, verify these cost controls:

- [ ] Auto-pause enabled (verify in RDS console)
- [ ] Max ACU capacity appropriate for usage (1-2)
- [ ] Min ACU capacity at 0.5 (enables pause)
- [ ] Backup retention set to 7 days (not excessive)
- [ ] Delete stack when training complete (most important)
- [ ] CloudWatch alarms configured for $3/$5 thresholds
- [ ] Cost tracking spreadsheet created
- [ ] Team aware of cost structure
- [ ] .env with credentials secured (.gitignore)
- [ ] No open security groups (0.0.0.0/0) in production

---

## Quick Reference: Cost Commands

Copy/paste commands for common cost checks:

```bash
# Current month total
aws ce get-cost-and-usage --time-period Start=$(date -d 'first day of month' +%Y-%m-%d),End=$(date +%Y-%m-%d) --granularity MONTHLY --metrics "BlendedCost" --group-by Type=DIMENSION,Key=SERVICE --region us-east-1 | jq '.ResultsByTime[0].Total.BlendedCost'

# Aurora compute usage (last 7 days)
aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name ServerlessDatabaseCapacity --dimensions Name=DBClusterIdentifier,Value=pagila-cluster --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S)Z --end-time $(date -u +%Y-%m-%dT%H:%M:%S)Z --period 3600 --statistics Maximum --region us-east-1

# Lambda free tier status (monthly invocation count)
aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value=pagila-query-executor --start-time $(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S)Z --end-time $(date -u +%Y-%m-%dT%H:%M:%S)Z --period 86400 --statistics Sum --region us-east-1
```

---

## Resources

- **AWS Pricing Calculator:** https://calculator.aws/
- **Aurora Pricing:** https://aws.amazon.com/rds/aurora/pricing/
- **Lambda Pricing:** https://aws.amazon.com/lambda/pricing/
- **API Gateway Pricing:** https://aws.amazon.com/api-gateway/pricing/
- **Cost Explorer Guide:** https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html
- **Budgets Setup:** https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/budgets-create.html

---

## Support & Escalation

### When to Investigate Costs

| Scenario | Action |
|----------|--------|
| Cost jumps 2x month-over-month | Check CloudWatch metrics for unexpected usage |
| Hits $5/month on sporadic use | Review auto-pause setting, may be stuck "running" |
| Reaches $20/month unplanned | Check for runaway Lambda invocations or data transfer |
| Unexpected $100+ bill | Immediately delete stack, contact AWS support |

### Troubleshooting Cost Anomalies

**Database costs higher than expected:**

```bash
# Check if database is actually paused
aws rds describe-db-clusters \
  --db-cluster-identifier pagila-cluster \
  --region us-east-1 \
  --query 'DBClusters[0].Status'

# If status != "stopped", check recent activity
aws rds describe-db-cluster-endpoints \
  --filters "Name=db-cluster-id,Values=pagila-cluster" \
  --region us-east-1

# Force pause if needed (wait 15 min idle first)
sleep 900
```

**Unexpectedly high Lambda charges:**

```bash
# Check recent Lambda invocations
aws logs tail /aws/lambda/pagila-query-executor --follow --region us-east-1

# Check for errors (errors = retries = multiple charges)
aws logs filter-log-events \
  --log-group-name /aws/lambda/pagila-query-executor \
  --filter-pattern "ERROR" \
  --region us-east-1
```

**Data transfer costs:**

```bash
# Check data transfer out of AWS
aws ce get-cost-and-usage \
  --time-period Start=$(date -d 'first day of month' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --metrics "BlendedCost" \
  --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["DataTransfer-Out"]}}' \
  --region us-east-1
```

---

**Remember:** The best cost optimization is **deleting the stack when training is complete**. Aurora storage ($1/month) is the baseline cost that persists. Once you're done, total cost drops to $0.00.
