# Pagila Training Database - Comprehensive Usage Guide

Welcome to the Pagila training database deployed on AWS Aurora Serverless v2. This guide covers everything you need to connect, query, and manage the database.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Connection Methods](#connection-methods)
3. [Example Queries](#example-queries)
4. [Database Schema Overview](#database-schema-overview)
5. [Cost Management](#cost-management)
6. [Troubleshooting](#troubleshooting)
7. [Security Best Practices](#security-best-practices)
8. [Advanced Topics](#advanced-topics)

---

## Quick Start

### 1. Set Up Environment Variables

First, create a `.env` file with your database credentials:

```bash
# Copy the template
cp .env.example .env

# Edit .env with your actual values
nano .env  # or vim, code, etc.
```

Fill in the following values from your AWS deployment:

```bash
# Aurora PostgreSQL Connection
DB_HOST=pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=pagila
DB_USER=postgres
DB_PASSWORD=YourSecurePassword123!

# API Gateway
API_ENDPOINT=https://xxxxxx.execute-api.us-east-1.amazonaws.com/prod

# AWS Region
AWS_REGION=us-east-1
```

### 2. Connect via Direct Database Connection

```bash
# Use the connection helper script
./scripts/connect-db.sh

# You'll see output like:
# 🔗 Connecting to Pagila database...
#    Host: pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com
#    Database: pagila
#    User: postgres
#
# To exit psql, type: \q
#
# psql (15.0, server 15.3)
# Type "help" for help.
#
# pagila=#
```

### 3. Execute Your First Query

Once connected via psql:

```sql
-- Count total films in the database
SELECT COUNT(*) as total_films FROM film;

-- Expected output:
--  total_films 
-- ─────────────
--          1000
-- (1 row)
```

---

## Connection Methods

### Method 1: Direct psql Connection (Recommended for Training)

**Recommended for:** Interactive queries, learning SQL, exploratory analysis

**Prerequisites:**
- PostgreSQL client tools installed (`psql`)
- Network access to Aurora cluster (security group configured)

**Connection:**

```bash
# Option A: Using the helper script
./scripts/connect-db.sh

# Option B: Manual command-line connection
PGPASSWORD='YourSecurePassword123!' psql \
  --host=pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com \
  --port=5432 \
  --username=postgres \
  --dbname=pagila

# Option C: Using .pgpass file (more secure)
# Create ~/.pgpass with:
# pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com:5432:pagila:postgres:YourSecurePassword123!
# chmod 600 ~/.pgpass
# Then connect:
psql -h pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com -U postgres -d pagila
```

**Useful psql Commands:**

```sql
\dt                     -- List all tables
\d film                 -- Describe the 'film' table structure
\dt rental*             -- List tables matching pattern
\d+ film                -- Detailed table description (with storage info)
\x                      -- Toggle expanded output (better for wide tables)
\timing                 -- Show query execution time
\q                      -- Quit psql
```

### Method 2: API Gateway / Lambda (Web/Programmatic Access)

**Recommended for:** Web applications, external integrations, serverless functions

**Prerequisites:**
- Lambda function deployed
- API Gateway endpoint configured
- curl and jq installed

**Usage:**

```bash
# Execute a query via the API
./scripts/query-api.sh "SELECT COUNT(*) FROM film;"

# Example output:
# 🌐 Executing query via API Gateway...
#    Query: SELECT COUNT(*) FROM film;
#
# {
#   "success": true,
#   "rows": [
#     {
#       "count": "1000"
#     }
#   ],
#   "count": 1,
#   "executionTime": 145
# }
```

**Direct curl Example:**

```bash
# Using curl without the helper script
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT COUNT(*) FROM film;"}' \
  https://xxxxx.execute-api.us-east-1.amazonaws.com/prod

# Response:
# {
#   "success": true,
#   "rows": [{"count": "1000"}],
#   "count": 1,
#   "executionTime": 145
# }
```

**Python Example:**

```python
import requests
import json

api_endpoint = "https://xxxxx.execute-api.us-east-1.amazonaws.com/prod"
query = "SELECT COUNT(*) FROM film;"

response = requests.post(
    api_endpoint,
    headers={"Content-Type": "application/json"},
    json={"query": query}
)

result = response.json()
print(json.dumps(result, indent=2))
```

**Node.js Example:**

```javascript
const axios = require('axios');

const apiEndpoint = 'https://xxxxx.execute-api.us-east-1.amazonaws.com/prod';
const query = 'SELECT COUNT(*) FROM film;';

axios.post(apiEndpoint, { query })
  .then(response => {
    console.log(JSON.stringify(response.data, null, 2));
  })
  .catch(error => {
    console.error('Error:', error.message);
  });
```

---

## Example Queries

### Basic Queries

#### 1. Find All Films

```sql
-- List first 10 films with basic info
SELECT 
    film_id,
    title,
    release_year,
    rating,
    length
FROM film
ORDER BY title
LIMIT 10;
```

#### 2. Count Films by Rating

```sql
-- Show distribution of film ratings
SELECT 
    rating,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percentage
FROM film
GROUP BY rating
ORDER BY count DESC;
```

#### 3. Find Films by Category

```sql
-- List all Action films
SELECT 
    f.film_id,
    f.title,
    f.release_year,
    f.length
FROM film f
JOIN film_category fc ON f.film_id = fc.film_id
JOIN category c ON fc.category_id = c.category_id
WHERE c.name = 'Action'
ORDER BY f.title
LIMIT 20;
```

### Advanced Queries

#### 4. Late Rentals (Original README Example)

```sql
-- Find rentals that were returned late
SELECT 
    c.customer_id,
    c.first_name || ' ' || c.last_name as customer_name,
    r.rental_id,
    r.rental_date,
    r.return_date,
    f.title as film_title,
    EXTRACT(DAY FROM r.return_date - r.rental_date) as rental_days
FROM rental r
JOIN inventory i ON r.inventory_id = i.inventory_id
JOIN film f ON i.film_id = f.film_id
JOIN customer c ON r.customer_id = c.customer_id
WHERE r.return_date IS NOT NULL
    AND (r.return_date - r.rental_date) > '3 days'::interval
ORDER BY rental_days DESC
LIMIT 20;
```

#### 5. Top 10 Revenue-Generating Films

```sql
-- Films that generated the most revenue
SELECT 
    f.film_id,
    f.title,
    COUNT(DISTINCT r.rental_id) as rental_count,
    SUM(p.amount) as total_revenue,
    ROUND(AVG(p.amount), 2) as avg_payment
FROM film f
JOIN inventory i ON f.film_id = i.film_id
JOIN rental r ON i.inventory_id = r.inventory_id
JOIN payment p ON r.customer_id = p.customer_id
GROUP BY f.film_id, f.title
ORDER BY total_revenue DESC
LIMIT 10;
```

#### 6. Customer Spending Analysis

```sql
-- Top spending customers
SELECT 
    c.customer_id,
    c.first_name || ' ' || c.last_name as customer_name,
    COUNT(DISTINCT p.payment_id) as payment_count,
    SUM(p.amount) as total_spent,
    ROUND(AVG(p.amount), 2) as avg_payment,
    MAX(p.payment_date) as last_payment_date
FROM customer c
JOIN payment p ON c.customer_id = p.customer_id
GROUP BY c.customer_id, c.first_name, c.last_name
ORDER BY total_spent DESC
LIMIT 10;
```

#### 7. Rental Trends by Month

```sql
-- Monthly rental activity
SELECT 
    DATE_TRUNC('month', r.rental_date)::date as month,
    COUNT(DISTINCT r.rental_id) as total_rentals,
    COUNT(DISTINCT r.customer_id) as unique_customers,
    ROUND(SUM(p.amount), 2) as monthly_revenue
FROM rental r
LEFT JOIN inventory i ON r.inventory_id = i.inventory_id
LEFT JOIN payment p ON r.customer_id = p.customer_id
GROUP BY DATE_TRUNC('month', r.rental_date)
ORDER BY month DESC;
```

### Fulltext Search Example

#### 8. Search Films by Title or Description

```sql
-- Fulltext search across film titles and descriptions
SELECT 
    film_id,
    title,
    description,
    release_year,
    TS_RANK(to_tsvector('english', title || ' ' || description), 
            plainto_tsquery('english', 'adventure')) as relevance
FROM film
WHERE to_tsvector('english', title || ' ' || description) @@ 
      plainto_tsquery('english', 'adventure')
ORDER BY relevance DESC
LIMIT 20;
```

### Window Functions Example

#### 9. Rental History with Ranking

```sql
-- Show each customer's rental history with dense rank
SELECT 
    c.customer_id,
    c.first_name || ' ' || c.last_name as customer_name,
    f.title,
    r.rental_date,
    DENSE_RANK() OVER (
        PARTITION BY c.customer_id 
        ORDER BY r.rental_date DESC
    ) as rental_sequence,
    LAG(r.rental_date) OVER (
        PARTITION BY c.customer_id 
        ORDER BY r.rental_date
    ) as previous_rental_date
FROM rental r
JOIN customer c ON r.customer_id = c.customer_id
JOIN inventory i ON r.inventory_id = i.inventory_id
JOIN film f ON i.film_id = f.film_id
WHERE c.customer_id = 1  -- Example: customer 1
ORDER BY r.rental_date DESC;
```

#### 10. Running Total of Store Revenue

```sql
-- Calculate cumulative daily revenue per store
SELECT 
    s.store_id,
    s.address_id,
    DATE(p.payment_date) as payment_date,
    SUM(p.amount) as daily_revenue,
    SUM(SUM(p.amount)) OVER (
        PARTITION BY s.store_id 
        ORDER BY DATE(p.payment_date)
    ) as cumulative_revenue
FROM payment p
JOIN rental r ON p.rental_id = r.rental_id
JOIN inventory i ON r.inventory_id = i.inventory_id
JOIN store s ON i.store_id = s.store_id
GROUP BY s.store_id, s.address_id, DATE(p.payment_date)
ORDER BY s.store_id, DATE(p.payment_date) DESC;
```

---

## Database Schema Overview

### Core Tables

#### **film**
Main films table - contains movie information

```sql
\d film
```

Key columns:
- `film_id` - Unique identifier
- `title` - Film title
- `description` - Plot summary
- `release_year` - Year released
- `language_id` - Foreign key to language
- `rental_duration` - Days available for rental
- `rental_rate` - Price per rental
- `length` - Duration in minutes
- `replacement_cost` - Cost to replace if damaged
- `rating` - MPAA rating (G, PG, PG-13, R, NC-17)
- `special_features` - Array of features (Trailers, Commentaries, Deleted Scenes, Behind the Scenes)
- `last_update` - Timestamp

#### **rental**
Rental transactions - tracks when films are rented and returned

```sql
\d rental
```

Key columns:
- `rental_id` - Unique identifier
- `rental_date` - When film was rented
- `inventory_id` - Foreign key to inventory
- `customer_id` - Foreign key to customer
- `return_date` - When film was returned (NULL if not returned)
- `staff_id` - Foreign key to staff member who processed rental
- `last_update` - Timestamp

#### **payment**
Payment transactions - tracks all payments

```sql
\d payment
```

Key columns:
- `payment_id` - Unique identifier
- `customer_id` - Foreign key to customer
- `staff_id` - Foreign key to staff member
- `rental_id` - Foreign key to rental
- `amount` - Payment amount
- `payment_date` - When payment was made
- `last_update` - Timestamp

#### **customer**
Customer information - people who rent films

```sql
\d customer
```

Key columns:
- `customer_id` - Unique identifier
- `first_name` - First name
- `last_name` - Last name
- `email` - Email address
- `address_id` - Foreign key to address
- `active` - Boolean (1 = active, 0 = inactive)
- `create_date` - Account creation date
- `last_update` - Timestamp

#### **actor**
Actor/actress information

```sql
\d actor
```

Key columns:
- `actor_id` - Unique identifier
- `first_name` - First name
- `last_name` - Last name
- `last_update` - Timestamp

#### **inventory**
Physical copies of films in stores

```sql
\d inventory
```

Key columns:
- `inventory_id` - Unique identifier
- `film_id` - Foreign key to film
- `store_id` - Foreign key to store
- `last_update` - Timestamp

#### **store**
Store locations

```sql
\d store
```

Key columns:
- `store_id` - Unique identifier
- `manager_staff_id` - Foreign key to manager
- `address_id` - Foreign key to address
- `last_update` - Timestamp

#### **staff**
Store staff members

```sql
\d staff
```

Key columns:
- `staff_id` - Unique identifier
- `first_name` - First name
- `last_name` - Last name
- `address_id` - Foreign key to address
- `email` - Email address
- `store_id` - Foreign key to store
- `active` - Boolean
- `username` - Login username
- `password` - Password hash
- `last_update` - Timestamp

### Supporting Tables

- **category** - Film categories (Action, Comedy, Drama, etc.)
- **film_actor** - Junction table linking films to actors
- **film_category** - Junction table linking films to categories
- **address** - Address information
- **city** - City information
- **country** - Country information
- **language** - Language information

### Schema Diagram

To view the complete schema:

```bash
# Connect to database
./scripts/connect-db.sh

# List all tables
\dt

# Describe specific table
\d film
\d rental
\d payment

# Show relationships
\d+ film_actor
\d+ film_category

# Export schema
pg_dump --schema-only -h host -U postgres -d pagila > schema.sql
```

---

## Cost Management

### Understanding Your Costs

The Pagila database uses **AWS Aurora Serverless v2**, which offers variable pricing based on actual usage:

#### Pricing Components

**1. Aurora Capacity Units (ACUs)**
- Billed for actual usage, not provisioned capacity
- Each ACU provides 2 GB RAM and associated CPU
- Minimum: 0.5 ACU, Maximum: configurable
- Pricing: ~$0.06 per ACU-hour (varies by region)

**2. Data Storage**
- Billed per GB stored
- Pricing: ~$0.10 per GB-month
- Includes automatic backups (35-day retention)

**3. Data Transfer**
- Outbound to internet: ~$0.02 per GB
- Outbound to other AWS services (same region): Free
- Inbound: Free

**4. Backups & Snapshots**
- Automated backups: Included
- Manual snapshots: ~$0.10 per GB-month

### Monitor Your Costs

#### CloudWatch Dashboard

1. Go to AWS Console → CloudWatch
2. Create custom dashboard with:
   - **ServerlessDatabaseCapacity** metric
   - **DatabaseConnections** metric
   - **CPUUtilization** metric
   - **VolumeBytesUsed** metric

#### CloudWatch Metrics Commands

```bash
# Requires AWS CLI configured
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ServerlessDatabaseCapacity \
  --dimensions Name=DBClusterIdentifier,Value=pagila-cluster \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-08T00:00:00Z \
  --period 3600 \
  --statistics Average,Maximum
```

#### AWS Billing Console

1. Go to AWS Console → Billing → Bills
2. Filter by service: "Amazon RDS"
3. Review charges by region and resource
4. Set up **Budget Alerts**:
   - Billing → Budgets → Create Budget
   - Set monthly limit (e.g., $10)
   - Email notifications at threshold

### Cost Optimization Tips

#### 1. Auto-Pause Configuration

Serverless v2 can automatically pause when inactive:

```bash
# View current auto-pause setting
aws rds describe-db-clusters \
  --db-cluster-identifier pagila-cluster

# Modify auto-pause (requires CDK/CLI update)
aws rds modify-db-cluster \
  --db-cluster-identifier pagila-cluster \
  --auto-minor-version-upgrade \
  --engine-version 15.3
```

**Auto-pause benefits:**
- Zero cost when not in use
- 60-300 second wake-up time
- Automatic after 5 minutes of inactivity (configurable)

#### 2. Query Optimization

Poorly written queries consume more ACUs:

```sql
-- BAD: Full table scan
SELECT * FROM rental WHERE year(rental_date) = 2023;

-- GOOD: Uses index on rental_date
SELECT * FROM rental 
WHERE rental_date >= '2023-01-01' 
  AND rental_date < '2024-01-01';
```

#### 3. Connection Pooling

Each connection consumes resources. Use connection pooling:

```bash
# Via PgBouncer (recommended)
# In infrastructure/lib/pagila-stack.ts:
# Enable RDS Proxy for connection pooling
```

#### 4. Data Transfer

Keep data transfers within AWS when possible:

```python
# BAD: Pulling all data to local machine
# SELECT * FROM large_table;

# GOOD: Process in Lambda/EC2 (no egress charges)
# Or use RDS Proxy with application in VPC
```

#### 5. Storage Management

```sql
-- Monitor table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Budget Alerts

#### Set Up Email Notifications

```bash
# Via AWS Console
1. Billing → Budgets → Create Budget
2. Set up budget for RDS
3. Configure SNS topic for alerts
4. Choose threshold (e.g., 80% of limit)

# Via AWS CLI
aws budgets create-budget \
  --account-id 123456789012 \
  --budget file://budget.json \
  --notifications-with-subscribers file://notifications.json
```

### Stack Cleanup

To stop incurring costs, delete the CloudFormation stack:

```bash
# Via AWS Console
1. CloudFormation → Stacks
2. Select pagila-serverless-stack
3. Delete → Confirm

# Via AWS CLI
aws cloudformation delete-stack \
  --stack-name pagila-serverless-stack \
  --region us-east-1

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name pagila-serverless-stack \
  --region us-east-1
```

**Important:** This will delete all data. Take snapshots first if needed:

```bash
# Create final snapshot
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier pagila-cluster \
  --db-cluster-snapshot-identifier pagila-final-backup

# List snapshots
aws rds describe-db-cluster-snapshots \
  --region us-east-1
```

---

## Troubleshooting

### Connection Issues

#### Problem: "Connection refused"

```
psql: could not connect to server: Connection refused
```

**Solutions:**

1. **Verify database is running:**
   ```bash
   aws rds describe-db-clusters \
     --db-cluster-identifier pagila-cluster \
     --query 'DBClusters[0].Status'
   ```

2. **Check security group rules:**
   ```bash
   aws ec2 describe-security-groups \
     --filter "Name=group-name,Values=pagila-*" \
     --query 'SecurityGroups[0].IpPermissions'
   ```

3. **Verify .env configuration:**
   ```bash
   grep DB_HOST .env
   grep DB_PORT .env
   ```

4. **Test network connectivity:**
   ```bash
   nc -zv pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com 5432
   ```

#### Problem: "FATAL: no pg_hba.conf entry"

Database is running but authentication failed.

**Solutions:**

1. **Verify credentials:**
   ```bash
   # Check DB_PASSWORD in .env
   grep DB_PASSWORD .env
   ```

2. **Reset master password:**
   ```bash
   aws rds modify-db-cluster \
     --db-cluster-identifier pagila-cluster \
     --master-user-password "NewPassword123!" \
     --apply-immediately
   ```

### Database Warming Up

#### Problem: "Slow first query after idle period"

Serverless v2 pauses after 5 minutes of inactivity.

**Expected behavior:**
- First connection after pause: 30-60 seconds to warm up
- Subsequent queries: Normal speed

**Solution:** Just wait for the database to warm up. This is normal for Serverless v2.

### Lambda/API Issues

#### Problem: "Lambda timeout" via API

```
{
  "error": "Task timed out after 30 seconds"
}
```

**Solutions:**

1. **Optimize query:**
   ```sql
   -- Use LIMIT to reduce result size
   SELECT * FROM rental LIMIT 1000;
   ```

2. **Increase Lambda timeout:**
   ```bash
   # In infrastructure/lib/pagila-stack.ts
   # Increase timeout property
   ```

3. **Use database indexes:**
   ```sql
   -- Check slow queries
   SELECT * FROM pg_stat_statements 
   ORDER BY mean_time DESC LIMIT 10;
   ```

#### Problem: "Cold start delay"

First Lambda invocation is slow due to VPC ENI attachment.

**Expected:** 5-15 seconds for first invocation
**Solution:** This is normal. Subsequent invocations are faster.

### Security Group Issues

#### Problem: "Connection timed out"

Security group denying inbound traffic.

**Solution:**

```bash
# Add your IP to security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 5432 \
  --cidr YOUR_IP/32

# Example: YOUR_IP might be obtained from:
curl http://checkip.amazonaws.com/
```

### Check Database Status

```bash
# Get cluster status
aws rds describe-db-clusters \
  --db-cluster-identifier pagila-cluster \
  --query 'DBClusters[0].[Status,Endpoint,Port]'

# Check recent events
aws rds describe-events \
  --source-type cluster \
  --source-identifier pagila-cluster \
  --query 'Events[0:10]'

# Get parameter group settings
aws rds describe-db-cluster-parameter-groups \
  --db-cluster-parameter-group-name default.aurora-postgresql15 \
  --query 'DBClusterParameterGroups[0]'
```

---

## Security Best Practices

### 1. Never Commit .env

The `.env` file contains sensitive credentials.

**Verify .gitignore:**

```bash
# Check if .env is ignored
grep "\.env" .gitignore
```

**If .env was accidentally committed:**

```bash
# Remove from git history (careful!)
git filter-branch --tree-filter 'rm -f .env' HEAD

# Or use git-filter-repo
git filter-repo --invert-paths --paths .env
```

### 2. Restrict Security Group to Your IP (Production)

```bash
# Current rule (too permissive)
# 0.0.0.0/0 - Anyone on the internet

# Better approach
YOUR_IP=$(curl -s http://checkip.amazonaws.com/)

aws ec2 revoke-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 5432 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxx \
  --protocol tcp \
  --port 5432 \
  --cidr $YOUR_IP/32
```

### 3. Use AWS Secrets Manager

Store credentials securely in AWS Secrets Manager instead of .env:

```bash
# Create secret
aws secretsmanager create-secret \
  --name pagila/database \
  --secret-string '{
    "host":"pagila-cluster.xxxxx.us-east-1.rds.amazonaws.com",
    "port":5432,
    "username":"postgres",
    "password":"YourSecurePassword123!"
  }'

# Retrieve secret (from Lambda/EC2)
aws secretsmanager get-secret-value \
  --secret-id pagila/database \
  --query SecretString | jq '.password'
```

### 4. Rotate Passwords Regularly

```bash
# Rotate master password every 90 days
aws rds modify-db-cluster \
  --db-cluster-identifier pagila-cluster \
  --master-user-password "NewPassword$(date +%s)!" \
  --apply-immediately
```

### 5. Enable VPC Logging

Monitor network access to database:

```bash
# Enable VPC Flow Logs
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids vpc-xxxxxxxx \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/pagila
```

### 6. Principle of Least Privilege

Create restricted database users:

```sql
-- Connect as postgres superuser
./scripts/connect-db.sh

-- Create read-only user
CREATE USER analyst PASSWORD 'SecurePassword123!';
GRANT CONNECT ON DATABASE pagila TO analyst;
GRANT USAGE ON SCHEMA public TO analyst;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analyst;

-- Create application user (limited permissions)
CREATE USER app_user PASSWORD 'SecurePassword456!';
GRANT SELECT, INSERT ON film, rental, payment TO app_user;
REVOKE DELETE ON film, rental, payment FROM app_user;

-- Verify permissions
\du  -- List users
\dp  -- List permissions
```

### 7. Enable Encryption

Verify encryption is enabled:

```bash
# Check encryption at rest
aws rds describe-db-clusters \
  --db-cluster-identifier pagila-cluster \
  --query 'DBClusters[0].StorageEncrypted'

# Enable encryption (if not already enabled)
aws rds modify-db-cluster \
  --db-cluster-identifier pagila-cluster \
  --storage-encrypted \
  --kms-key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

### 8. Regular Backups and Recovery Testing

```bash
# List automated backups
aws rds describe-db-cluster-snapshots \
  --region us-east-1

# Test restore from snapshot
aws rds restore-db-cluster-from-snapshot \
  --db-cluster-identifier pagila-restore-test \
  --snapshot-identifier rds:pagila-cluster-2024-01-01-12-00
```

---

## Advanced Topics

### Understanding Aurora Serverless v2

Aurora Serverless v2 is a variable-capacity option designed for unpredictable workloads:

**Advantages:**
- Auto-scales between min and max ACUs
- Pays only for what you use
- 15-second scale-up time
- Auto-pauses to zero cost when inactive (configurable)

**How it works:**
1. Minimum capacity (e.g., 0.5 ACU) always running
2. Demand spikes trigger rapid scale-up
3. Demand drops trigger scale-down
4. After idle timeout (5 min default), auto-pauses

**Cost implications:**
- Constant minimum cost (0.5 ACU × $0.06 = $0.03/hour minimum)
- Variable cost based on peak usage
- No cost during pause periods

### Lambda Concurrency and VPC Cold Starts

Lambda functions in VPCs experience slower cold starts:

**Problem:**
- First invocation: Attach ENI to Lambda (5-15 seconds)
- Subsequent: Reuse ENI (warm start ~100ms)

**Solutions:**

1. **Provisioned Concurrency:**
   ```bash
   aws lambda put-provisioned-concurrency-config \
     --function-name pagila-query \
     --provisioned-concurrent-executions 5 \
     --qualifier LIVE
   ```

2. **Connection Pooling:**
   ```javascript
   // Reuse database connection across invocations
   let connection = null;

   exports.handler = async (event) => {
     if (!connection) {
       connection = await getConnection();
     }
     // Use connection
   };
   ```

3. **Lambda@Edge for Caching:**
   Use CloudFront to cache frequently-accessed queries

### Performance Optimization

#### 1. Query Analysis

```sql
-- Enable query analysis
EXPLAIN ANALYZE
SELECT * FROM rental 
WHERE rental_date > '2023-01-01'
LIMIT 10;

-- Look for:
-- - Sequential Scans (slow) vs Index Scans (fast)
-- - High actual vs planned rows (bad estimates)
-- - N-Loop Joins on large tables (slow)
```

#### 2. Create Strategic Indexes

```sql
-- Common indexes for Pagila workloads
CREATE INDEX idx_rental_customer ON rental(customer_id);
CREATE INDEX idx_rental_inventory ON rental(inventory_id);
CREATE INDEX idx_rental_date ON rental(rental_date);
CREATE INDEX idx_payment_customer ON payment(customer_id);
CREATE INDEX idx_film_category ON film_category(film_id, category_id);
CREATE INDEX idx_actor_name ON actor(last_name, first_name);

-- Verify indexes exist
SELECT * FROM pg_indexes WHERE schemaname = 'public';
```

#### 3. Analyze Query Plans

```sql
-- Find slow queries
SELECT 
    query,
    calls,
    mean_time,
    total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Clear stats
SELECT pg_stat_statements_reset();
```

### Monitoring with CloudWatch

**Key Metrics to Monitor:**

```javascript
// CloudWatch metrics for Aurora Serverless v2
const metrics = {
  // Capacity and resources
  'ServerlessDatabaseCapacity': 'Current ACU usage',
  'CPUUtilization': 'CPU percentage',
  'DatabaseConnections': 'Active connections',
  
  // Performance
  'ReadThroughput': 'Bytes read/sec',
  'WriteThroughput': 'Bytes written/sec',
  'DMLLatency': 'Write latency',
  'SelectLatency': 'Read latency',
  
  // Storage
  'VolumeBytesUsed': 'Total storage used',
  'VolumeBytesUsedByLogs': 'Log storage used',
  
  // Replication (for Aurora replicas if configured)
  'AuroraBinlogReplicaLag': 'Replica lag in milliseconds',
};
```

**CloudWatch Dashboard Script:**

```bash
# Create dashboard with key metrics
aws cloudwatch put-dashboard \
  --dashboard-name pagila-monitoring \
  --dashboard-body file://dashboard-config.json
```

**Example dashboard-config.json:**

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/RDS", "ServerlessDatabaseCapacity", {"stat": "Average"}],
          [".", "CPUUtilization", {"stat": "Average"}],
          [".", "DatabaseConnections", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Aurora Serverless Metrics"
      }
    }
  ]
}
```

### Advanced Features

#### 1. Read Replicas

For read-heavy workloads, create Aurora read replicas:

```bash
aws rds create-db-cluster-read-replica \
  --db-cluster-identifier pagila-replica \
  --source-db-cluster-identifier pagila-cluster
```

#### 2. Cross-Region Replication

For disaster recovery:

```bash
aws rds create-db-cluster-read-replica \
  --db-cluster-identifier pagila-replica-dr \
  --source-db-cluster-identifier pagila-cluster \
  --region us-west-2
```

#### 3. Parameter Groups

Tune database performance:

```bash
# View current parameters
aws rds describe-db-cluster-parameters \
  --db-cluster-parameter-group-name default.aurora-postgresql15

# Modify parameter
aws rds modify-db-cluster-parameter-group \
  --db-cluster-parameter-group-name pagila-params \
  --parameters "ParameterName=max_connections,ParameterValue=100,ApplyMethod=immediate"
```

---

## Additional Resources

- **PostgreSQL Documentation:** https://www.postgresql.org/docs/15/
- **AWS RDS Documentation:** https://docs.aws.amazon.com/rds/
- **Aurora Serverless v2:** https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless.html
- **Pagila Dataset:** https://github.com/devrimgunduz/pagila
- **psql Command Reference:** https://www.postgresql.org/docs/15/app-psql.html

## Getting Help

- **AWS Support:** Contact AWS Support for infrastructure issues
- **Database Issues:** Connect via psql and use `\?` for help
- **Application Issues:** Check CloudWatch Logs in AWS Console
- **Cost Questions:** AWS Billing & Cost Management Console

---

**Last Updated:** 2024
**Database Version:** PostgreSQL 15.3 on Aurora
**Pagila Version:** Standard (1000 films, 16,000+ customers)
