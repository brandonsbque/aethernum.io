import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

/**
 * AethernumSiteStack — provisions the full aethernum.io infrastructure:
 *
 *   1. Private S3 bucket (aethernum-website) — block public access, versioned, SSL-only.
 *   2. CloudFront Function — appends index.html to directory paths AND redirects www → apex.
 *   3. ACM certificate (DNS-validated, us-east-1) for aethernum.io + www.aethernum.io.
 *   4. CloudFront distribution — S3 REST origin + OAC, HTTPS only, Price Class 100.
 *   5. Route53 A records (alias) — apex and www both point at CloudFront.
 *
 *   All domain/config values are read from cdk.json context for portability.
 */
export class AethernumSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Context values ─────────────────────────────────────────────
    const bucketName: string =
      this.node.tryGetContext('bucketName') || 'aethernum-website';
    const domainName: string =
      this.node.tryGetContext('domainName') || 'aethernum.io';

    // ── 1. S3 Bucket ───────────────────────────────────────────────
    //
    // Private bucket — no static website hosting.  CloudFront serves
    // content via the S3 REST API endpoint (OAC, not OAI).
    const bucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
      autoDeleteObjects: false, // never auto-delete production data
    });

    // ── 2. CloudFront Function ─────────────────────────────────────
    //
    // Runs on every viewer request.  Two jobs:
    //   a) www → apex redirect (301)
    //   b) Append index.html to directory-style requests
    const cfFunction = new cloudfront.Function(this, 'IndexAndRedirectFunction', {
      code: cloudfront.FunctionCode.fromInline(`
var HOST_HEADER = 'host';

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var host = (request.headers[HOST_HEADER] && request.headers[HOST_HEADER].value) || '';

  // ── www → apex redirect ──────────────────────────
  if (host.toLowerCase().indexOf('www.') === 0) {
    var apexHost = host.slice(4);                     // strip "www."
    var redirectUrl = 'https://' + apexHost + uri;
    if (request.querystring !== '') {
      redirectUrl += '?' + request.querystring;
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: redirectUrl } },
    };
  }

  // ── directory → index.html ───────────────────────
  if (uri === '' || uri === '/' || uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    // Clean URLs without extension — treat as directory
    request.uri = uri + '/index.html';
  }

  return request;
}
`.trim()),
    });

    // ── 3. Route53 Hosted Zone ──────────────────────────────────────
    //
    // Uses fromHostedZoneAttributes when hostedZoneId is provided in
    // context (avoids needing route53:ListHostedZonesByName at synth
    // time).  Falls back to fromLookup for auto-discovery.
    const hostedZoneId: string | undefined =
      this.node.tryGetContext('hostedZoneId');
    const hostedZone = hostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
          hostedZoneId,
          zoneName: domainName,
        })
      : route53.HostedZone.fromLookup(this, 'HostedZone', {
          domainName,
        });

    // ── 4. ACM Certificate (DNS-validated, us-east-1) ──────────────
    //
    // CloudFront requires the cert in us-east-1.  Certificate with
    // CertificateValidation.fromDns() tells ACM to create the validation
    // CNAME records in Route53 automatically — no custom resource needed.
    const certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName,
      subjectAlternativeNames: ['www.' + domainName],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // ── 5. CloudFront Origin Access Control ────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, 'SiteOAC', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // ── 6. CloudFront Access Logging Bucket ─────────────────────────
    //
    // Standard logs stored in a separate S3 bucket with a 30-day
    // lifecycle policy to minimize cost (~$0.50/mo for a low-traffic
    // site).  ACLs are disabled (bucket-owner-full-control is the
    // default for new buckets).
    const logBucket = new s3.Bucket(this, 'SiteLogBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    // ── 7. Security Headers Policy ──────────────────────────────────
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(
      this,
      'SecurityHeaders',
      {
        securityHeadersBehavior: {
          strictTransportSecurity: {
            override: true,
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            // preload deferred until after verification per architect decision
          },
          contentTypeOptions: {
            override: true,
          },
          frameOptions: {
            override: true,
            frameOption: cloudfront.HeadersFrameOption.DENY,
          },
          referrerPolicy: {
            override: true,
            referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          },
          // CSP deferred — static site with no user input; add if forms/APIs are introduced
        },
      },
    );

    // ── 8. CloudFront Distribution ─────────────────────────────────
    //
    // Origin: S3 REST endpoint via OAC (no OAI, no legacy S3Origin).
    // Viewer protocol: redirect HTTP → HTTPS.
    // Price class: 100 (US/Canada/Europe — ~$0.55/mo).
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: cfFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        responseHeadersPolicy: securityHeaders,
      },
      domainNames: [domainName, 'www.' + domainName],
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultRootObject: 'index.html',
      logBucket,
      logFilePrefix: 'cloudfront/',
    });

    // ── 9. Route53 Records ─────────────────────────────────────────
    //
    // Both apex and www are A-record aliases to CloudFront.
    // The www→apex redirect is handled by the CloudFront Function above,
    // so both records share the same distribution.
    new route53.ARecord(this, 'ApexARecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.ARecord(this, 'WwwARecord', {
      zone: hostedZone,
      recordName: 'www',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    // ── Outputs ────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, 'DomainName', { value: domainName });
    new cdk.CfnOutput(this, 'LogBucketName', { value: logBucket.bucketName });
  }
}
