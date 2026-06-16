import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';

/**
 * AethernumSiteStack — imports the existing production S3 bucket and
 * CloudFront distribution into the CDK app using fromXxxAttributes.
 *
 * This stack does NOT create or modify resources. It models the live
 * infrastructure so CDK can validate, diff, and document the configuration
 * without disrupting the running site.
 *
 * All account-specific values are read from cdk.json context:
 *   bucketName, distributionId, distributionDomainName, account, region
 */
export class AethernumSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucketName: string = this.node.tryGetContext('bucketName');
    const distributionId: string = this.node.tryGetContext('distributionId');
    const domainName: string = this.node.tryGetContext('distributionDomainName');

    if (!bucketName) {
      throw new Error('cdk.json context missing: bucketName');
    }
    if (!distributionId) {
      throw new Error('cdk.json context missing: distributionId');
    }

    // ── Import existing S3 bucket ──────────────────────────────────
    //
    // Uses Bucket.fromBucketAttributes so CDK reads the bucket by name
    // without attempting to create or reconfigure it (zero disruption).
    //
    // The live bucket MUST have:
    //   • Block Public Access enabled (all four settings)
    //   • No public bucket policy / ACL granting read access
    //   • Traffic served exclusively via CloudFront Origin Access Control
    const bucket = s3.Bucket.fromBucketAttributes(this, 'SiteBucket', {
      bucketName,
    });

    // ── Import existing CloudFront distribution ─────────────────────
    //
    // Uses Distribution.fromDistributionAttributes so CDK references
    // the distribution by ID without modifying it. domainName is optional
    // (needed only for alias/Route53 integration — not used here).
    const distribution = cloudfront.Distribution.fromDistributionAttributes(
      this,
      'SiteDistribution',
      {
        distributionId,
        domainName,
      },
    );

    // ── Outputs (human-readable in cdk synth / CloudFormation console) ──
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
    });
  }
}
