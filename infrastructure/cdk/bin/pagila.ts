#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PagilaStack } from '../lib/pagila-stack';

/**
 * CDK Application Instantiation
 * This file defines the entry point for the CDK application and creates the Pagila stack
 */

const app = new cdk.App();

// Create the main Pagila stack
const pagilaStack = new PagilaStack(app, 'PagilaStack', {
  description: 'Pagila PostgreSQL Training Database - Aurora Serverless v2 on AWS',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  // Override default values with context variables if needed
  // (use ?? so an explicit dbMinCapacity of 0 - scale-to-zero - is preserved)
  vpcCidr: app.node.tryGetContext('vpcCidr') ?? '10.0.0.0/16',
  dbMinCapacity: app.node.tryGetContext('dbMinCapacity') ?? 0,
  dbMaxCapacity: app.node.tryGetContext('dbMaxCapacity') ?? 2,
  dbUsername: app.node.tryGetContext('dbUsername') ?? 'postgres',
  environment: app.node.tryGetContext('environment') ?? 'training',
  allowedCidr: app.node.tryGetContext('allowedCidr') ?? '0.0.0.0/0',
  tags: {
    Project: 'Pagila',
    Environment: app.node.tryGetContext('environment') || 'training',
    ManagedBy: 'CDK',
  },
});

// Add stack tags for easy identification
cdk.Tags.of(pagilaStack).add('Stack', 'PagilaServerless');

// Synthesize CloudFormation template
app.synth();
