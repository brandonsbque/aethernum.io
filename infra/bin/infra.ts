#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AethernumSiteStack } from '../lib/site-stack';

const app = new cdk.App();

const account: string = app.node.tryGetContext('account');
const region: string = app.node.tryGetContext('region');

new AethernumSiteStack(app, 'AethernumSiteStack', {
  env: {
    account,
    region,
  },
  description:
    'aethernum.io production site — S3 + CloudFront + ACM + Route53 (CDK-managed)',
});
