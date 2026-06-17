import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface PagilaStackProps extends cdk.StackProps {
  vpcCidr?: string;
  dbMinCapacity?: number;
  dbMaxCapacity?: number;
  dbUsername?: string;
  environment?: string;
  /** CIDR allowed to reach Aurora on 5432 (direct psql + Lambda). */
  allowedCidr?: string;
}

/**
 * PagilaStack - AWS CDK infrastructure for the Pagila PostgreSQL training database.
 *
 * Minimum-cost serverless shape:
 * - Aurora PostgreSQL Serverless v2 with scale-to-zero (auto-pauses when idle)
 * - Publicly accessible (security-group restricted) so a laptop can connect with psql
 * - Lambda (bundled with esbuild) runs OUTSIDE the VPC, so there is no NAT gateway
 *   and no interface endpoints to pay for - it reaches Secrets Manager and the
 *   Aurora public endpoint directly
 * - API Gateway REST API for the web/query path
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
    const allowedCidr = props?.allowedCidr ?? this.node.tryGetContext('allowedCidr') ?? '0.0.0.0/0';
    const dbName = 'pagila';
    const dbPort = 5432;

    if (allowedCidr === '0.0.0.0/0') {
      cdk.Annotations.of(this).addWarning(
        'Aurora is reachable from 0.0.0.0/0 on 5432 (protected only by the DB password). ' +
        'For tighter security set -c allowedCidr=<your.ip>/32 (note: this also restricts the ' +
        'web/Lambda path, which connects from AWS IP space).'
      );
    }

    // ========================================
    // 1. VPC & NETWORKING
    // Public subnets only, no NAT gateway (NAT would cost ~$32/mo each and defeat
    // the "minimum cost" goal). Aurora lives here and is publicly accessible.
    // ========================================
    const vpc = new ec2.Vpc(this, 'PagilaVpc', {
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc,
      description: 'Security group for Aurora PostgreSQL (Pagila)',
      allowAllOutbound: true,
    });
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(allowedCidr),
      ec2.Port.tcp(dbPort),
      'PostgreSQL access (psql + Lambda)'
    );

    // ========================================
    // 2. AURORA POSTGRESQL - SERVERLESS V2 (scale-to-zero)
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
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [dbSecurityGroup],
      // Serverless v2 capacity range. minCapacity 0 => auto-pause when idle.
      serverlessV2MinCapacity: dbMinCapacity,
      serverlessV2MaxCapacity: dbMaxCapacity,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        publiclyAccessible: true,
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
    // 3. LAMBDA - QUERY EXECUTOR (bundled, outside the VPC)
    // NodejsFunction transpiles query-handler.ts and bundles `pg` via esbuild.
    // @aws-sdk/* is provided by the Node 20 runtime, so it is left external.
    // ========================================
    const queryFunction = new NodejsFunction(this, 'PagilaQueryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', 'lambda', 'query-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60), // allow for first-query Aurora resume from pause
      memorySize: 256,
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
    // 4. API GATEWAY - REST API
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

    this.apiEndpoint = api.url;

    // ========================================
    // 5. OUTPUTS
    // ========================================
    new cdk.CfnOutput(this, 'AuroraEndpoint', {
      value: dbCluster.clusterEndpoint.hostname,
      description: 'Aurora PostgreSQL cluster endpoint',
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
    new cdk.CfnOutput(this, 'GetSecretCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${dbSecret.secretArn} --query SecretString --output text`,
      description: 'Command to retrieve the generated DB password',
    });
  }
}
