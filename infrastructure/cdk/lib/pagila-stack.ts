import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface PagilaStackProps extends cdk.StackProps {
  vpcCidr?: string;
  dbMinCapacity?: number;
  dbMaxCapacity?: number;
  dbUsername?: string;
  environment?: string;
}

/**
 * PagilaStack - AWS CDK Infrastructure for Pagila PostgreSQL Training Database
 *
 * Deploys a complete serverless PostgreSQL environment with:
 * - Aurora PostgreSQL cluster with serverless scaling
 * - Lambda function for query execution
 * - API Gateway REST API for web access
 * - VPC with security groups for networking
 * - Secrets Manager for credential storage
 * - IAM roles with proper permissions
 */
export class PagilaStack extends cdk.Stack {
  // Public properties for outputs
  public readonly auroraEndpoint: string;
  public readonly auroraPort: number;
  public readonly apiEndpoint: string;
  public readonly dbSecretArn: string;
  public readonly lambdaFunctionName: string;

  constructor(scope: Construct, id: string, props?: PagilaStackProps) {
    super(scope, id, props);

    // Configuration
    const vpcCidr = props?.vpcCidr || this.node.tryGetContext('vpcCidr') || '10.0.0.0/16';
    const dbMinCapacity = props?.dbMinCapacity || this.node.tryGetContext('dbMinCapacity') || 0.5;
    const dbMaxCapacity = props?.dbMaxCapacity || this.node.tryGetContext('dbMaxCapacity') || 2;
    const dbUsername = props?.dbUsername || 'postgres';
    const environment = props?.environment || this.node.tryGetContext('environment') || 'training';
    const dbName = 'pagila';
    const dbPort = 5432;

    // ========================================
    // 1. VPC & NETWORKING
    // ========================================
    console.log('🔨 Creating VPC and networking infrastructure...');

    // Create VPC with DNS support enabled (required for Aurora)
    const vpc = new ec2.Vpc(this, 'PagilaVpc', {
      cidr: vpcCidr,
      maxAzs: 2, // Multi-AZ for high availability
      natGateways: 0, // No NAT needed for training environment
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Create a security group for Aurora that allows inbound on port 5432
    const auroraSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc,
      description: 'Security group for Aurora PostgreSQL',
      allowAllOutbound: true,
    });

    // Allow inbound on PostgreSQL port from anywhere (for direct access)
    // NOTE: In production, restrict this to specific IPs or security groups
    auroraSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(dbPort),
      'PostgreSQL access from anywhere'
    );

    // ========================================
    // 2. SECRETS MANAGER - DB CREDENTIALS
    // ========================================
    console.log('🔐 Creating Secrets Manager for database credentials...');

    // Create secret in Secrets Manager with auto-generated password
    const dbSecret = new secretsmanager.Secret(this, 'PagilaDbSecret', {
      secretName: `pagila-db-credentials-${environment}`,
      description: 'Database credentials for Pagila Aurora PostgreSQL',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: dbUsername,
          dbname: dbName,
        }),
        generateStringKey: 'password',
        passwordLength: 32,
        excludeCharacters: '"@/\\',
      },
    });

    // ========================================
    // 3. AURORA POSTGRESQL CLUSTER
    // ========================================
    console.log('🗄️  Creating Aurora PostgreSQL cluster...');

    // Create DB cluster
    const dbCluster = new rds.DatabaseCluster(this, 'PagilaCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_3,
      }),
      credentials: rds.Credentials.fromSecret(dbSecret),
      defaultDatabaseName: dbName,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [auroraSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      backup: {
        retention: cdk.Duration.days(7),
      },
      cloudwatchLogsExports: ['postgresql'],
      iamAuthentication: false,
      deletionProtection: false,
      storageEncrypted: true,
      writer: rds.ClusterInstance.provisioned('Instance', {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.BURSTABLE4_GRAVITON,
          ec2.InstanceSize.MEDIUM
        ),
        publiclyAccessible: true,
        autoMinorVersionUpgrade: true,
      }),
    });

    // Store cluster endpoint for output
    this.auroraEndpoint = dbCluster.clusterEndpoint.hostname;
    this.auroraPort = dbPort;
    this.dbSecretArn = dbSecret.secretArn;

    // ========================================
    // 4. IAM ROLE FOR LAMBDA
    // ========================================
    console.log('👤 Creating IAM role for Lambda...');

    // Create execution role for Lambda
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for Pagila query Lambda function',
    });

    // Add VPC execution policy
    lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AWSLambdaVPCAccessExecutionRole'
      )
    );

    // Add policy to read database credentials from Secrets Manager
    dbSecret.grantRead(lambdaExecutionRole);

    // Add inline policy for EC2 permissions (needed for VPC access)
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:CreateNetworkInterface',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DeleteNetworkInterface',
        ],
        resources: ['*'],
      })
    );

    // ========================================
    // 5. LAMBDA FUNCTION - QUERY EXECUTOR
    // ========================================
    console.log('⚡ Creating Lambda function for query execution...');

    // Create Lambda function - inline code for simplicity
    const queryFunction = new lambda.Function(this, 'PagilaQueryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      role: lambdaExecutionRole,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DB_SECRET_NAME: dbSecret.secretName,
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbPort.toString(),
        DB_NAME: dbName,
        NODE_ENV: 'production',
      },
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [auroraSecurityGroup],
      description: 'Handles POST requests to /query endpoint',
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.lambdaFunctionName = queryFunction.functionName;

    // ========================================
    // 6. API GATEWAY - REST API
    // ========================================
    console.log('🌐 Creating API Gateway REST API...');

    // Create REST API
    const api = new apigateway.RestApi(this, 'PagilaAPI', {
      restApiName: 'pagila-query-api',
      description: 'API for executing Pagila database queries',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type'],
      },
    });

    // Create /query resource
    const queryResource = api.root.addResource('query');

    // Create POST method with Lambda proxy integration
    queryResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(queryFunction, {
        proxy: true,
      })
    );

    this.apiEndpoint = api.url;

    // ========================================
    // 7. STACK OUTPUTS
    // ========================================
    console.log('📋 Creating stack outputs...');

    new cdk.CfnOutput(this, 'AuroraEndpoint', {
      value: dbCluster.clusterEndpoint.hostname,
      description: 'Aurora PostgreSQL cluster endpoint',
      exportName: `${this.stackName}-aurora-endpoint`,
    });

    new cdk.CfnOutput(this, 'AuroraPort', {
      value: dbPort.toString(),
      description: 'Aurora PostgreSQL port',
      exportName: `${this.stackName}-aurora-port`,
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: dbName,
      description: 'Aurora database name',
      exportName: `${this.stackName}-db-name`,
    });

    new cdk.CfnOutput(this, 'DatabaseUsername', {
      value: dbUsername,
      description: 'Aurora database master username',
      exportName: `${this.stackName}-db-username`,
    });

    new cdk.CfnOutput(this, 'DBSecretArn', {
      value: dbSecret.secretArn,
      description: 'ARN of Secrets Manager secret with database credentials',
      exportName: `${this.stackName}-db-secret-arn`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: queryFunction.functionName,
      description: 'Lambda function name for query execution',
      exportName: `${this.stackName}-lambda-function`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: queryFunction.functionArn,
      description: 'Lambda function ARN',
      exportName: `${this.stackName}-lambda-arn`,
    });

    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL for query execution',
      exportName: `${this.stackName}-api-endpoint`,
    });

    new cdk.CfnOutput(this, 'VPCId', {
      value: vpc.vpcId,
      description: 'VPC ID for the infrastructure',
      exportName: `${this.stackName}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'ConnectionString', {
      value: `postgresql://${dbUsername}@${dbCluster.clusterEndpoint.hostname}:${dbPort}/${dbName}`,
      description: 'PostgreSQL connection string',
      exportName: `${this.stackName}-connection-string`,
    });

    console.log('✅ Pagila CDK Stack created successfully!');
  }
}
