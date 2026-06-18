import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
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
 * PagilaStack - AWS CDK infrastructure for the Pagila PostgreSQL training database.
 *
 * Private / web-only shape (production-style):
 * - Aurora PostgreSQL Serverless v2 with scale-to-zero, NOT publicly accessible,
 *   in private isolated subnets
 * - Lambda runs INSIDE the VPC (private subnets); its security group is the only
 *   thing allowed to reach Aurora on 5432
 * - A Secrets Manager interface VPC endpoint lets the in-VPC Lambda fetch the DB
 *   credentials without a NAT gateway
 * - API Gateway REST API is the only entry point (no direct psql from a laptop)
 *
 * Note: because Aurora is private, the database must be seeded from inside the VPC
 * (e.g. a one-off seeder Lambda/CodeBuild). Running scripts/init-database.py from a
 * laptop will not reach it.
 */
export class PagilaStack extends cdk.Stack {
  public readonly auroraEndpoint: string;
  public readonly auroraPort: number;
  public readonly apiEndpoint: string;
  public readonly dbSecretArn: string;
  public readonly lambdaFunctionName: string;

  constructor(scope: Construct, id: string, props?: PagilaStackProps) {
    super(scope, id, props);

    // Configuration (use ?? so an explicit 0 min-capacity is preserved)
    const vpcCidr = props?.vpcCidr ?? this.node.tryGetContext('vpcCidr') ?? '10.0.0.0/16';
    const dbMinCapacity = props?.dbMinCapacity ?? this.node.tryGetContext('dbMinCapacity') ?? 0;
    const dbMaxCapacity = props?.dbMaxCapacity ?? this.node.tryGetContext('dbMaxCapacity') ?? 2;
    const dbUsername = props?.dbUsername ?? 'postgres';
    const environment = props?.environment ?? this.node.tryGetContext('environment') ?? 'training';
    const bedrockModelId =
      this.node.tryGetContext('bedrockModelId') ?? 'anthropic.claude-haiku-4-5';
    const dbName = 'pagila';
    const dbPort = 5432;

    // ========================================
    // 1. VPC & SECURITY GROUPS
    // Private isolated subnets only: no internet gateway, no NAT. Everything the
    // Lambda needs is reached in-VPC (Aurora) or via an interface endpoint (Secrets
    // Manager). CloudWatch Logs from Lambda do not traverse the VPC, so no log
    // endpoint is required.
    // ========================================
    const vpc = new ec2.Vpc(this, 'PagilaVpc', {
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // SG for the Lambda (source of all DB + endpoint traffic)
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Pagila query Lambda',
      allowAllOutbound: true,
    });

    // SG for Aurora: only the Lambda SG may connect on 5432
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc,
      description: 'Aurora PostgreSQL (Pagila) - Lambda access only',
      allowAllOutbound: true,
    });
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(dbPort),
      'PostgreSQL from the query Lambda'
    );

    // SG for the interface endpoint: HTTPS from the Lambda SG
    const endpointSecurityGroup = new ec2.SecurityGroup(this, 'EndpointSecurityGroup', {
      vpc,
      description: 'Secrets Manager interface endpoint',
      allowAllOutbound: true,
    });
    endpointSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(443),
      'HTTPS from the query Lambda'
    );

    // Single AZ for everything in the data path. Aurora's subnet group still
    // spans both isolated subnets (RDS requires >=2 AZs), but the endpoint and
    // both Lambdas are pinned to ONE subnet/AZ so there is no cross-AZ traffic
    // (and the endpoint only bills for one AZ).
    const singleAzSubnets: ec2.SubnetSelection = { subnets: [vpc.isolatedSubnets[0]] };

    // Interface endpoint so the in-VPC Lambda can call Secrets Manager (no NAT).
    const secretsEndpoint = vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      securityGroups: [endpointSecurityGroup],
      privateDnsEnabled: true,
      subnets: singleAzSubnets,
    });

    // ========================================
    // 2. AURORA POSTGRESQL - SERVERLESS V2 (private, scale-to-zero)
    // ========================================
    const dbCluster = new rds.DatabaseCluster(this, 'PagilaCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_6,
      }),
      credentials: rds.Credentials.fromGeneratedSecret(dbUsername, {
        secretName: `pagila/${environment}/db-credentials`,
      }),
      defaultDatabaseName: dbName,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      serverlessV2MinCapacity: dbMinCapacity, // 0 => auto-pause when idle
      serverlessV2MaxCapacity: dbMaxCapacity,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        publiclyAccessible: false,
        autoMinorVersionUpgrade: true,
      }),
      backup: { retention: cdk.Duration.days(7) },
      cloudwatchLogsExports: ['postgresql'],
      storageEncrypted: true,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    const dbSecret = dbCluster.secret!;

    this.auroraEndpoint = dbCluster.clusterEndpoint.hostname;
    this.auroraPort = dbPort;
    this.dbSecretArn = dbSecret.secretArn;

    // ========================================
    // 3. LAMBDA - QUERY EXECUTOR (bundled, in private subnets)
    // ========================================
    const queryFunction = new NodejsFunction(this, 'PagilaQueryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'query-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60), // allow for first-query Aurora resume from pause
      memorySize: 256,
      vpc,
      vpcSubnets: singleAzSubnets,
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_SECRET_NAME: dbSecret.secretArn,
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbPort.toString(),
        DB_NAME: dbName,
      },
      bundling: {
        minify: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
      },
      logGroup: new logs.LogGroup(this, 'PagilaQueryFunctionLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      description: 'Executes SQL against Pagila Aurora; handler for POST /query',
    });

    // Allow the function to read the database credentials
    dbSecret.grantRead(queryFunction);

    this.lambdaFunctionName = queryFunction.functionName;

    // ========================================
    // 3b. ONE-TIME DATABASE SEEDER (custom resource)
    // Aurora is private, so it is seeded from inside the VPC on deploy. The SQL
    // files are copied next to the handler at bundle time and loaded by pg.
    // ========================================
    const repoRoot = path.join(__dirname, '..', '..', '..');
    const seederFunction = new lambda.DockerImageFunction(this, 'PagilaSeeder', {
      code: lambda.DockerImageCode.fromImageAsset(repoRoot, {
        file: 'infrastructure/cdk/seeder/Dockerfile',
        exclude: [
          'infrastructure/cdk/node_modules',
          'infrastructure/cdk/cdk.out',
          'infrastructure/cdk/dist',
          '.git',
          'docs',
          'pgadmin',
        ],
      }),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      vpc,
      vpcSubnets: singleAzSubnets,
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_SECRET_NAME: dbSecret.secretArn,
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbPort.toString(),
        DB_NAME: dbName,
      },
      logGroup: new logs.LogGroup(this, 'PagilaSeederLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      description: 'One-time Pagila seeder (container: psql + pg_restore, incl. JSONB)',
    });
    dbSecret.grantRead(seederFunction);

    const seederProvider = new cr.Provider(this, 'PagilaSeederProvider', {
      onEventHandler: seederFunction,
    });

    const seed = new cdk.CustomResource(this, 'PagilaSeed', {
      serviceToken: seederProvider.serviceToken,
      properties: { version: '2' }, // bump to force a re-seed attempt
    });
    // Seed only after the database and the Secrets Manager endpoint exist.
    seed.node.addDependency(dbCluster);
    seed.node.addDependency(secretsEndpoint);

    // ========================================
    // 4. API GATEWAY - REST API (only entry point)
    // ========================================
    const api = new apigateway.RestApi(this, 'PagilaAPI', {
      restApiName: 'pagila-query-api',
      description: 'API for executing Pagila database queries',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
      },
    });

    api.root
      .addResource('query')
      .addMethod('POST', new apigateway.LambdaIntegration(queryFunction, { proxy: true }));

    // ---- NL -> SQL "ask" Lambda (outside the VPC; reaches Bedrock + invokes query Lambda) ----
    const askFunction = new NodejsFunction(this, 'PagilaAskFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'ask-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(28), // under the API Gateway 29s ceiling
      memorySize: 256,
      environment: {
        BEDROCK_MODEL_ID: bedrockModelId,
        QUERY_FUNCTION_NAME: queryFunction.functionName,
      },
      bundling: { minify: true, target: 'node20', externalModules: ['@aws-sdk/*'] },
      logGroup: new logs.LogGroup(this, 'PagilaAskFunctionLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      description: 'NL -> SQL orchestrator (Bedrock Converse + invokes the query Lambda)',
    });
    queryFunction.grantInvoke(askFunction);
    askFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/anthropic.*',
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }),
    );
    api.root.addResource('ask').addMethod('POST', new apigateway.LambdaIntegration(askFunction, { proxy: true }));

    new cdk.CfnOutput(this, 'AskEndpoint', {
      value: `${api.url}ask`,
      description: 'NL query endpoint (POST {prompt})',
    });

    // ---- Static frontend: private S3 bucket served via CloudFront ----
    const siteBucket = new s3.Bucket(this, 'PagilaSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'PagilaSiteDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    new s3deploy.BucketDeployment(this, 'PagilaSiteDeployment', {
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'frontend')),
        s3deploy.Source.data('config.js', `window.PAGILA_API=${JSON.stringify(`${api.url}ask`)};`),
      ],
    });

    new cdk.CfnOutput(this, 'SiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Pagila natural-language query frontend',
    });

    this.apiEndpoint = api.url;

    // ========================================
    // 5. OUTPUTS
    // ========================================
    new cdk.CfnOutput(this, 'AuroraEndpoint', {
      value: dbCluster.clusterEndpoint.hostname,
      description: 'Aurora PostgreSQL cluster endpoint (private - reachable only inside the VPC)',
    });
    new cdk.CfnOutput(this, 'AuroraPort', {
      value: dbPort.toString(),
      description: 'Aurora PostgreSQL port',
    });
    new cdk.CfnOutput(this, 'DatabaseName', {
      value: dbName,
      description: 'Aurora database name',
    });
    new cdk.CfnOutput(this, 'DBSecretArn', {
      value: dbSecret.secretArn,
      description: 'Secrets Manager secret with the database credentials',
    });
    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL for query execution',
    });
  }
}
