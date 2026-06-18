#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AethernumSiteStack } from '../lib/site-stack';

const app = new cdk.App();

// Prefer CDK_DEFAULT_* environment variables (set by the CDK CLI,
// GitHub Actions, or aws configure).  Fall back to cdk.json context
// for local development without configured AWS credentials.
const account: string =
  process.env.CDK_DEFAULT_ACCOUNT || app.node.tryGetContext('account');
const region: string =
  process.env.CDK_DEFAULT_REGION || app.node.tryGetContext('region');

new AethernumSiteStack(app, 'AethernumSiteStack', {
  env: {
    account,
    region,
  },
  description:
    'aethernum.io production site — S3 + CloudFront + ACM + Route53 (CDK-managed)',
});
