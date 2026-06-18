# Architecture Design Review — aethernum.io CDK Infrastructure

**Date:** 2026-06-18
**Branch:** `feature/cdk-s3-cloudfront-dns`
**AWS Account:** 236128511652
**AWS Region:** `us-east-1` (global services — CloudFront, ACM, Route53)
**Repository:** `brandonbque/aethernum.io`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Component-by-Component Design](#2-component-by-component-design)
   - [2.1 S3 Origin Bucket](#21-s3-origin-bucket)
   - [2.2 CloudFront Distribution](#22-cloudfront-distribution)
   - [2.3 CloudFront Function](#23-cloudfront-function)
   - [2.4 ACM Certificate](#24-acm-certificate)
   - [2.5 Route53 DNS](#25-route53-dns)
3. [CDK Stack & App Structure](#3-cdk-stack--app-structure)
4. [Cost Estimate](#4-cost-estimate)
5. [Security Review](#5-security-review)
6. [Alternatives Considered](#6-alternatives-considered)
7. [Cutover Plan](#7-cutover-plan)
8. [Engineer Implementation Checklist](#8-engineer-implementation-checklist)
9. [Appendix A: CloudFront Function Code](#appendix-a-cloudfront-function-code)
10. [Appendix B: IAM Permissions for CDK Deploy](#appendix-b-iam-permissions-for-cdk-deploy)
11. [Appendix C: GitHub Actions Deploy Pipeline](#appendix-c-github-actions-deploy-pipeline)

---

## 1. Architecture Overview

### 1.1 High-Level Diagram

```
                          Route53 Hosted Zone
                         aethernum.io (Z081843556URL5ASIU2GI)
                        ┌────────────────────────────────────┐
                        │                                    │
                        │  aethernum.io        A ALIAS ──────┤
                        │  www.aethernum.io    A ALIAS ──────┤
                        │                                    │
                        └────────────┬───────────────────────┘
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │   CloudFront Distribution             │
                        │   dXXXXXXXXXXXXX.cloudfront.net       │
                        │                                        │
                        │  ┌──────────────────────────────────┐ │
                        │  │  CloudFront Function               │ │
                        │  │  (viewer-request)                  │ │
                        │  │  ┌─────────────────────────────┐  │ │
                        │  │  │ 1. www → apex 301 redirect  │  │ │
                        │  │  │ 2. /dir/ → /dir/index.html │  │ │
                        │  │  └─────────────────────────────┘  │ │
                        │  └──────────────────────────────────┘ │
                        │                                        │
                        │  Price Class: PRICE_CLASS_100          │
                        │  HTTP/3: enabled                       │
                        │  Response Headers: HSTS + nosniff      │
                        │                                        │
                        └────────────┬───────────────────────────┘
                                     │
                                     │ Origin Access Control (OAC)
                                     │ HTTPS-only
                                     ▼
                        ┌────────────────────────┐
                        │   S3 Bucket                               │
                        │   aethernum-site-{hash}                   │
                        │                                           │
                        │   Block Public Access: BLOCK_ALL          │
                        │   Versioning: ENABLED                     │
                        │   Encryption: SSE-S3                      │
                        │   Enforce SSL: true                       │
                        │   Static Website Hosting: DISABLED        │
                        │                                           │
                        │   Contents:                                │
                        │   ├── index.html                          │
                        │   ├── projects/index.html                 │
                        │   ├── contact/index.html                  │
                        │   ├── _next/static/...                    │
                        │   └── public/...                          │
                        │                                           │
                        └──────────────────────────────────────────┘

                                     ┌──────────────────┐
                                     │  ACM Certificate │
                                     │  (us-east-1)     │
                                     │                  │
                                     │  *.aethernum.io  │
                                     │  aethernum.io    │
                                     │  www.aethernum.io│
                                     │                  │
                                     │  DNS-validated   │
                                     │  via Route53     │
                                     └──────────────────┘
```

### 1.2 Design Philosophy

This is a **greenfield CDK redesign** replacing the current import-based stack (`site-stack.ts`). The existing stack imports resources via `fromXxxAttributes` and does not create or modify anything. The new stack will **own and manage** all resources via CDK-native L2 constructs, giving us:

- **Full IaC control** — create, update, and destroy from code
- **Deterministic diffs** — `cdk diff` shows exactly what will change
- **Safe teardown** — `cdk destroy` tears down everything (with `RemovalPolicy.RETAIN` on S3 for safety)
- **Cross-region awareness** — everything in `us-east-1` avoids ACM cross-region complexity

### 1.3 Resource Groups

The stack comprises exactly **four resource groups** deployed in a single stack:

| Group | Resources | Count |
|-------|-----------|-------|
| **Origin Storage** | S3 Bucket | 1 |
| **CDN & Edge Compute** | CloudFront Distribution, CloudFront Function | 2 |
| **TLS Certificate** | ACM Certificate (DNS-validated) | 1 |
| **DNS** | Route53 A Alias records (apex + www) | 2 |

**Total CloudFormation resources:** ~6 logical resources, ~12 physical resources.

---

## 2. Component-by-Component Design

### 2.1 S3 Origin Bucket

The S3 bucket is the sole origin for all static content. It is configured for **REST endpoint access via CloudFront OAC** — no static website hosting.

#### CDK Construct

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';

const siteBucket = new s3.Bucket(this, 'SiteBucket', {
  // Bucket name auto-generated by CDK with account/region hash.
  // Physical name: aethernum-site-{account}-{region}-{hash}

  // ── Security ──
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,

  // ── Data protection ──
  encryption: s3.BucketEncryption.S3_MANAGED,
  versioned: true,

  // ── Lifecycle ──
  // RETAIN so the bucket survives stack deletion.
  // Manual cleanup required before final teardown.
  removalPolicy: cdk.RemovalPolicy.RETAIN,

  // ── OAC compatibility ──
  // No websiteIndexDocument, no websiteErrorDocument.
  // CloudFront uses the REST API endpoint, not the website endpoint.
});
```

#### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No static website hosting** | OAC requires the REST endpoint (`s3.amazonaws.com`), not the website endpoint (`s3-website-us-east-1.amazonaws.com`). Enabling website hosting on the bucket would expose a second, unnecessary endpoint. |
| **Block Public Access: BLOCK_ALL** | All four settings enabled. Even if someone accidentally adds a bucket policy, S3's account-level and bucket-level BPA settings prevent public reads. Traffic flows exclusively through CloudFront. |
| **Versioning: ENABLED** | Every `aws s3 sync` deployment creates new object versions. Rollback is as simple as pointing CloudFront at a previous version. Cost is negligible (~$0.023/GB-month for versioned data, and old versions are cleaned up by lifecycle rules in production). |
| **SSE-S3 encryption** | Server-side encryption at rest using AES-256. No KMS keys to manage. Sufficient for a public-facing static site. |
| **RemovalPolicy.RETAIN** | Prevents accidental data loss. If someone runs `cdk destroy`, the bucket (and its contents) are orphaned, not deleted. Manual `aws s3 rm --recursive` + delete-bucket required for intentional teardown. |
| **enforceSSL: true** | Rejects non-HTTPS requests at the bucket policy level. Complimentary to CloudFront's HTTPS-only configuration. |

#### OAC Configuration (in CloudFront)

The OAC is configured inside the CloudFront origin definition, not on the bucket directly:

```typescript
// The S3Origin class automatically creates the OAC.
// No separate S3OriginAccessControl construct needed in most cases.
origins: [
  new origins.S3Origin(siteBucket, {
    // OAC is the default; no originAccessIdentity needed
  }),
]
```

CDK version `aws-cdk-lib@^2.150.0` uses **Origin Access Control (OAC)** by default for `S3Origin`. This replaces the legacy Origin Access Identity (OAI). OAC supports:
- SigV4 signing (stronger than OAI's legacy signing)
- SSE-KMS encrypted buckets (OAI cannot)
- All AWS regions (OAI had regional gaps)

---

### 2.2 CloudFront Distribution

#### CDK Construct

```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
  // ── Origins ──
  defaultBehavior: {
    origin: new origins.S3Origin(siteBucket, {
      // OAC auto-created by S3Origin
    }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    responseHeadersPolicy: securityHeadersPolicy,
    functionAssociations: [
      {
        function: viewerRequestFunction,
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
      },
    ],
  },

  // ── Domain names (aliases + certificate) ──
  domainNames: ['aethernum.io', 'www.aethernum.io'],
  certificate: acmCertificate,

  // ── Performance ──
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe
  httpVersion: cloudfront.HttpVersion.HTTP3,          // HTTP/3 + HTTP/2 fallback

  // ── Default root object ──
  // NOT set — the CloudFront Function handles index.html resolution.
  defaultRootObject: undefined,

  // ── Logging ──
  // Standard logging disabled for cost optimization.
  // Enable for production troubleshooting:
  // enableLogging: true,
  // logBucket: new s3.Bucket(this, 'LogBucket', { ... }),
  // logFilePrefix: 'cdn-logs/',

  // ── Error handling ──
  errorResponses: [
    {
      httpStatus: 403,
      responseHttpStatus: 404,
      responsePagePath: '/404.html',
      ttl: cdk.Duration.seconds(10),
    },
    {
      httpStatus: 404,
      responseHttpStatus: 404,
      responsePagePath: '/404.html',
      ttl: cdk.Duration.seconds(10),
    },
  ],
});
```

#### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Price Class 100** | US, Canada, Europe edge locations only. Covers ~90% of expected traffic for a US-based LLC site. Saves ~40% on egress compared to Price Class All. |
| **HTTP/3** | Enabled for modern browsers (Chrome, Firefox, Safari all support QUIC/H3). CloudFront falls back to HTTP/2 for clients that don't support it. |
| **No defaultRootObject** | The CloudFront Function appends `index.html` to directory requests (e.g., `/projects/` → `/projects/index.html`). Using `defaultRootObject` would only handle the root path `/`, not subdirectories. |
| **HSTS preload-ready** | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` via managed response headers policy. |
| **Cache Policy: CACHING_OPTIMIZED** | AWS managed policy. Caches based on the full URL + query string. TTL defaults: min=1s, default=86400s (24h), max=31536000s (1yr). |
| **Error 403 → 404** | S3 returns 403 (not 404) for missing objects when Block Public Access is enabled (S3 doesn't reveal whether an object exists to unauthorized callers). We remap 403 → 404 for user-friendly error pages. |

#### Security Headers Policy

```typescript
const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
  this,
  'SecurityHeadersPolicy',
  {
    responseHeadersPolicyName: 'aethernum-security-headers',
    securityHeadersBehavior: {
      strictTransportSecurity: {
        override: true,
        accessControlMaxAge: cdk.Duration.seconds(63072000), // 2 years
        includeSubdomains: true,
        preload: true,
      },
      contentTypeOptions: {
        override: true, // X-Content-Type-Options: nosniff
      },
      // frameOptions omitted — no framing needed for a marketing site.
      // referrerPolicy omitted — default browser behavior is fine.
      // xssProtection omitted — deprecated in modern browsers.
    },
  },
);
```

---

### 2.3 CloudFront Function

The CloudFront Function runs at `VIEWER_REQUEST` and handles **two independent responsibilities** in a single function:

1. **Directory index resolution:** Append `index.html` when the request URI ends with `/` (e.g., `/projects/` → `/projects/index.html`). This is necessary because the Next.js static export uses `trailingSlash: true` and generates directory-based routes.

2. **www → apex redirect:** Return an HTTP 301 redirect when the `Host` header is `www.aethernum.io`, pointing to `https://aethernum.io` with the same path.

#### CDK Construct

```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';

const viewerRequestFunction = new cloudfront.Function(
  this,
  'ViewerRequestFunction',
  {
    functionName: 'aethernum-viewer-request',
    code: cloudfront.FunctionCode.fromFile({
      filePath: 'lib/functions/viewer-request.js',
    }),
    // Or inline:
    // code: cloudfront.FunctionCode.fromInline(`
    //   ...function body...
    // `),
  },
);
```

#### Full Function Code

See [Appendix A](#appendix-a-cloudfront-function-code) for the complete JavaScript function. Key behavior:

- **When Host is `www.aethernum.io`:** Return 301 to `https://aethernum.io{uri}` (preserves path). Status code 301 tells search engines this is a permanent redirect (canonicalization).
- **When URI ends with `/`:** Rewrite to `{uri}index.html` (internal rewrite, not a redirect — the browser never sees the `index.html` path).
- **Otherwise:** Pass through unmodified.

#### Why One Function, Not Two

Single function, single association at `VIEWER_REQUEST`. The www redirect runs first because it produces a response that terminates processing (CloudFront doesn't continue to the origin). The index rewrite only runs if the request passes the redirect check. No performance penalty — both checks are O(1) string operations.

---

### 2.4 ACM Certificate

#### CDK Construct

```typescript
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';

const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
  domainName: 'aethernum.io',
});

const acmCertificate = new acm.DnsValidatedCertificate(
  this,
  'SiteCertificate',
  {
    domainName: 'aethernum.io',
    subjectAlternativeNames: ['www.aethernum.io'],
    hostedZone,
    region: 'us-east-1', // CloudFront requires certificates in us-east-1
    validation: acm.CertificateValidation.fromDns(hostedZone),
  },
);
```

#### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **DnsValidatedCertificate** | Custom resource that creates the certificate and automatically creates/cleans up Route53 DNS validation records. No manual email validation. |
| **us-east-1** | CloudFront requires ACM certificates to be in us-east-1. If we deployed the stack to any other region, we'd need cross-region certificate handling (extra complexity). Deploying the entire stack to us-east-1 avoids this. |
| **Both apex + www** | SAN certificate covering both `aethernum.io` and `www.aethernum.io`. One certificate, one renewal cycle, one CloudFront association. |
| **DNS validation** | Requires Route53 hosted zone to be in the same account. The custom resource will create `_<hash>.aethernum.io.` CNAME records for validation. |

#### Certificate Renewal

ACM automatically renews certificates 60 days before expiry. Since we use DNS validation and the hosted zone is in the same account, renewal is fully automatic — no human intervention needed.

---

### 2.5 Route53 DNS

#### CDK Construct

```typescript
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';

const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
  domainName: 'aethernum.io',
});

// Apex A record (aethernum.io → CloudFront)
new route53.ARecord(this, 'ApexAlias', {
  zone: hostedZone,
  recordName: 'aethernum.io',
  target: route53.RecordTarget.fromAlias(
    new route53Targets.CloudFrontTarget(distribution),
  ),
});

// www A record (www.aethernum.io → CloudFront)
new route53.ARecord(this, 'WwwAlias', {
  zone: hostedZone,
  recordName: 'www.aethernum.io',
  target: route53.RecordTarget.fromAlias(
    new route53Targets.CloudFrontTarget(distribution),
  ),
});
```

#### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **fromLookup, not fromHostedZoneId** | `HostedZone.fromLookup()` resolves the hosted zone by domain name at synth time. If the hosted zone ID changes (unlikely but possible), the lookup still works. More maintainable than hardcoding zone IDs. |
| **A ALIAS records** | CloudFront distributions don't have a fixed IP. ALIAS records are AWS's DNS-level CNAME-for-apex feature. No charge for ALIAS queries within Route53. |
| **Both apex AND www** | The `www` subdomain gets an A ALIAS record (not a CNAME) because it's at the zone apex equivalent in terms of how ALIAS works. Both point to the same CloudFront distribution; the CloudFront Function handles the www→apex redirect. |
| **No separate www bucket** | See [Alternatives Considered](#6-alternatives-considered) — we use a CloudFront Function instead. |

---

## 3. CDK Stack & App Structure

### 3.1 File Layout

```
infra/
├── bin/
│   └── infra.ts              # CDK app entry point
├── lib/
│   ├── site-stack.ts         # AethernumSiteStack (greenfield)
│   └── functions/
│       └── viewer-request.js # CloudFront Function code
├── cdk.json                  # CDK context & config
├── package.json              # CDK dependencies
├── tsconfig.json             # TypeScript config
└── ARCHITECTURE.md           # This file
```

### 3.2 App Entry Point (`bin/infra.ts`)

```typescript
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AethernumSiteStack } from '../lib/site-stack';

const app = new cdk.App();

new AethernumSiteStack(app, 'AethernumSiteStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || app.node.tryGetContext('account'),
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description:
    'aethernum.io production — S3 + CloudFront + CloudFront Function + ACM + Route53',
});
```

### 3.3 CDK Context (`cdk.json`)

```json
{
  "app": "npx ts-node bin/infra.ts",
  "context": {
    "account": "236128511652",
    "region": "us-east-1",
    "domainName": "aethernum.io"
  }
}
```

The `bucketName` and `distributionId` context keys from the old import-based stack are **removed**. The new stack creates its own resources.

### 3.4 Bootstrapping

The account must be CDK-bootstrapped in `us-east-1`:

```bash
cd infra
npx cdk bootstrap aws://236128511652/us-east-1
```

One-time operation. Creates the CDK toolkit stack (S3 bucket for assets, IAM roles for deployment).

---

## 4. Cost Estimate

### 4.1 Monthly Cost Breakdown

| Resource | Monthly Cost | Notes |
|----------|-------------|-------|
| **CloudFront** | $0.00 | Free tier: 1 TB data transfer/month, 10M HTTP(S) requests/month. A small portfolio site with <10GB transfer is $0. |
| **S3 Storage** | ~$0.05 | ~2 GB static assets at $0.023/GB-month (+ versioned copies ~$0.02). |
| **S3 PUT/COPY/POST Requests** | ~$0.05 | ~10,000 PUTs/month (deploy sync) at $0.005/1,000. |
| **S3 GET Requests** | ~$0.01 | ~10,000 GETs at $0.0004/1,000 (mostly CloudFront cache misses). |
| **CloudFront Function** | $0.10 | 1M+ invocations/month at $0.10 per 1M. 2M page views would be $0.20. |
| **Route53 Hosted Zone** | $0.50 | Flat fee per hosted zone per month. |
| **Route53 Queries** | ~$0.01 | ~10,000 queries/month at $0.40/million. Insignificant at this scale. |
| **ACM Certificate** | $0.00 | Free for certificates used with CloudFront. |
| **Total** | **~$0.72/month** | |

### 4.2 Free Tier Caveats

- CloudFront free tier is 1 TB data transfer + 10M requests — **permanent** (not 12-month trial).
- If traffic exceeds 1 TB/month, additional egress is $0.085/GB (US/Canada) or $0.085–$0.170 (Europe).
- S3 free tier (5 GB storage, 20K GET, 2K PUT) is a 12-month trial from account creation. If the account is older, S3 costs shift to actual usage (~$0.05–$0.15/month).

### 4.3 Worst-Case Scenario

At 10 TB/month egress (extremely unlikely for this site), the bill would be ~$850 (CloudFront egress) + $0.50 (Route53) + $0.10 (S3) ≈ **$850.60/month**. CloudFront bills per-GB without surprises — no burst charges.

### 4.4 Cost Comparison: Old vs New

| Cost Factor | Old (Import-based) | New (CDK-managed) |
|-------------|-------------------|-------------------|
| S3 bucket | Existing, equivalent | Auto-created, equivalent |
| CloudFront | Existing, equivalent | Auto-created, equivalent |
| CloudFront Function | N/A | ~$0.10/month |
| Route53 | Existing (not in CDK) | CDK-managed records |
| ACM | Existing (not in CDK) | CDK-managed auto-renewal |
| **Delta** | — | **~$0.10–$0.20/month more** (Function only) |

---

## 5. Security Review

### 5.1 Trust Boundary Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        INTERNET (untrusted)                       │
│                                                                   │
│   Browser ─── HTTPS ───────► CloudFront ─── HTTPS (SigV4/OAC) ──► S3 │
│                               ▲                                   │
│                               │ (certificate validation)          │
│                           ACM (TLS)                               │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                                │
                                │ DNS
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      AWS (trusted)                                │
│                                                                   │
│   Route53 ──── ALIAS ────► CloudFront                            │
│   GitHub Actions (OIDC) ──► IAM Role (cdk deploy, s3 sync)      │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 Threat Model

| Threat | Mitigation | Layer |
|--------|-----------|-------|
| **Public S3 access** | `BlockPublicAccess.BLOCK_ALL` — no bucket policy, no ACL. Only CloudFront's OAC has access. | S3 |
| **Unencrypted transit to S3** | `enforceSSL: true` — S3 rejects HTTP. CloudFront → S3 uses HTTPS with SigV4 signing. | S3 |
| **Unencrypted transit to users** | `ViewerProtocolPolicy.REDIRECT_TO_HTTPS` + HSTS headers — browsers and crawlers are forced to HTTPS. | CloudFront |
| **MITM / downgrade attack** | HSTS preload — browsers refuse HTTP connections to the domain. | CloudFront |
| **MIME-sniffing attacks** | `X-Content-Type-Options: nosniff` — prevents browsers from guessing content types. | CloudFront |
| **Clickjacking** | Not a concern for this content-only site. Framing is harmless. If needed later, add `Content-Security-Policy: frame-ancestors 'none'`. | N/A |
| **Unauthorized deploy** | GitHub OIDC trust policy restricts to `repo:brandonbque/aethernum.io:ref:refs/heads/master`. Only pushes to master can assume the deploy role. | IAM |
| **Credential leak** | No long-lived AWS credentials stored. GitHub Actions uses OIDC for short-lived tokens (1-hour default). | CI/CD |
| **S3 data loss (accidental)** | `RemovalPolicy.RETAIN` — bucket survives `cdk destroy`. Versioning — old versions recoverable. | S3 |
| **S3 data loss (malicious)** | Versioning enables rollback. IAM deploy role restricted to `s3:PutObject`, `s3:DeleteObject` — not `s3:DeleteBucket` or `s3:DeleteObjectVersion`. | IAM + S3 |

### 5.3 IAM Permissions for CDK Deploy

The CDK deploy role (`cdk-hnb659fds-deploy-role-*` from bootstrapping) needs:

- `cloudformation:*` — Create/update/delete stacks
- `s3:*` — Create bucket, manage bucket policy for OAC
- `cloudfront:*` — Create distribution, function, OAC
- `acm:*` — Request certificate, DNS validation
- `route53:*` — Upsert A records, CNAME validation records (DNS-validated cert)
- `iam:PassRole` — Pass CDK execution role to CloudFormation

The **site deploy role** (GitHub Actions, distinct from CDK deploy) needs the [existing permissions](docs/iam-permissions-policy.json):

- `s3:PutObject`, `s3:DeleteObject` on the bucket
- `s3:ListBucket` on the bucket
- `s3:GetBucketPublicAccessBlock` on the bucket
- `cloudfront:CreateInvalidation` on the distribution

**Proposed addition:** The site deploy role should also verify the bucket's Public Access Block settings before syncing (already implemented in the deploy pipeline).

### 5.4 OAC Deep Dive

Origin Access Control works through **SigV4-signed requests** — CloudFront signs every S3 request with credentials that S3 trusts as coming from CloudFront. This is enforced at the S3 bucket policy level. When `S3Origin` is used in CDK:

1. CDK creates an `OriginAccessControl` resource
2. CDK adds a bucket policy allowing `s3:GetObject` to the CloudFront distribution's service principal via the OAC
3. The OAC ID is associated with the CloudFront origin

The resulting bucket policy looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::aethernum-site-*/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::236128511652:distribution/E*"
        }
      }
    }
  ]
}
```

### 5.5 What Security Auditors Will Ask

**Q: "Can someone access the S3 bucket directly?"**
A: No. Block Public Access is on all four settings. The bucket policy only allows CloudFront's service principal, gated by the specific distribution ARN.

**Q: "What prevents subdomain takeover?"**
A: The CloudFront distribution must exist before DNS records are created. CDK creates CloudFront first, then Route53 ALIAS records. If the distribution is accidentally deleted, the ALIAS records become dangling — but `RemovalPolicy.RETAIN` on the distribution (default) prevents this.

**Q: "Is certificate renewal automatic?"**
A: Yes. `DnsValidatedCertificate` uses DNS validation. ACM automatically renews 60 days before expiry. The custom resource Lambda will be re-triggered if the certificate is deleted or if the stack is updated.

**Q: "Can the www redirect be exploited for open redirects?"**
A: No. The CloudFront Function only rewrites the host to `aethernum.io`. It does not read any query parameter or user input to construct the redirect URL. The path is preserved as-is from the original request, which is standard and expected.

---

## 6. Alternatives Considered

### 6.1 www Redirect: CloudFront Function vs S3 Redirect Bucket

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **CloudFront Function** (chosen) | Single distribution, ~3 extra lines of JS, sub-millisecond latency, $0.10/M invocations | Requires understanding CF Functions | ✅ **Chosen** |
| **S3 redirect bucket** | Simple, no code | Second S3 bucket, second CloudFront origin (or second distribution), extra cost, more resources to manage | ❌ Rejected |
| **Lambda@Edge** | Full Node.js runtime | Cold starts (~100ms), $0.60/M invocations, separate Lambda in us-east-1, more complex deployment | ❌ Rejected |
| **Route53 ALIAS** | DNS-level | www would just serve the same content (duplicate content, SEO penalty), no redirect | ❌ Rejected |

The CloudFront Function approach is the clear winner for this use case. The function is ~30 lines of vanilla JavaScript and executes in <1ms at CloudFront edge locations.

### 6.2 Region: us-east-1 vs Other Regions

| Region | Pros | Cons | Verdict |
|--------|------|------|---------|
| **us-east-1** (chosen) | CloudFront certs available natively, no cross-region ACM handling, simpler stack | No regional flexibility | ✅ **Chosen** |
| **us-west-2** (or other) | Could colocate with other infra | ACM must be in us-east-1 anyway; cross-region cert references add complexity (custom resources, multiple stacks) | ❌ Rejected |

Since CloudFront requires ACM certificates in us-east-1, deploying the entire stack there avoids cross-region complexity. No other AWS regional resources are needed.

### 6.3 Directory Index: CloudFront Function vs S3 Website Hosting

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **CloudFront Function** (chosen) | Works with OAC (REST endpoint), single solution for both index.html + www redirect | Requires CF Function | ✅ **Chosen** |
| **S3 Static Website Hosting** | Native index document resolution | Incompatible with OAC (OAC requires REST endpoint, website hosting uses website endpoint); would need OAI instead (legacy, less secure); exposes second endpoint | ❌ Rejected |

### 6.4 CloudFront Functions vs Lambda@Edge

| Feature | CloudFront Functions | Lambda@Edge |
|---------|---------------------|-------------|
| **Runtime** | ECMAScript 5.1 (restricted) | Node.js (full) |
| **Max execution time** | <1ms | 5s (viewer) / 30s (origin) |
| **Max code size** | 10 KB | 1 MB (viewer) / 50 MB (origin) |
| **Network access** | No | Yes |
| **File system access** | No | Yes |
| **Pricing** | $0.10/M invocations | $0.60/M invocations + duration |
| **Cold start** | None | ~100ms |
| **Use case fit** | Perfect for header manipulation, URL rewrites, simple redirects | Overkill for this use case |

CloudFront Functions are the correct choice here. The index resolution and www redirect are pure string operations — no network, no filesystem, no heavy compute needed.

### 6.5 Managed vs Self-Managed Caching

We use CloudFront's `CACHING_OPTIMIZED` managed policy. Custom cache policies were considered but rejected:

- **Custom policy with longer TTLs:** Would risk stale content after deploys. The invalidation step (`/*`) already purges everything.
- **Custom policy with cache key normalization:** The site has no query-parameter-dependent content. Normalizing `Accept-Encoding` and `Authorization` headers (which `CACHING_OPTIMIZED` does) is sufficient.

---

## 7. Cutover Plan

### 7.1 Pre-Flight Checklist

- [ ] CDK bootstrapped in us-east-1
- [ ] Route53 hosted zone exists for aethernum.io
- [ ] Existing CloudFront distribution ID noted (for rollback)
- [ ] Existing S3 bucket name noted (www.aethernum.io — for rollback)
- [ ] Existing S3 bucket contents verified (full backup if concerned)
- [ ] GitHub Actions AWS_ROLE_ARN available
- [ ] GitHub OIDC provider configured in AWS IAM

### 7.2 Phase 1: Deploy New Stack Alongside Existing

**Goal:** Create all new resources without touching the existing infrastructure.

```bash
cd infra
npm ci
npx cdk synth          # Verify CloudFormation template
npx cdk diff            # Review resource changes (should be all CREATE)
npx cdk deploy          # Deploy new stack
```

**Expected outcome:**

- New S3 bucket created (empty)
- New CloudFront distribution created (serving from empty bucket)
- CloudFront Function deployed
- ACM certificate issued (DNS validation — ~5-10 minutes for validation records to propagate)
- Route53 A records **NOT yet created** (do this in Phase 2)

**Safety measure:** Temporarily comment out the Route53 ALIAS records in `site-stack.ts` during Phase 1. This prevents the new distribution from taking over DNS before we're ready.

After certificate validation completes, uncomment the Route53 records and deploy again (they'll be updates, not creates — safe).

### 7.3 Phase 2: Deploy Content & Update DNS

**Goal:** Populate the new bucket with site content, then cut over DNS.

```bash
# 1. Build the site
cd /path/to/repo
pnpm install --frozen-lockfile
pnpm build

# 2. Sync to the NEW bucket
NEW_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name AethernumSiteStack \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)

aws s3 sync out/ "s3://${NEW_BUCKET}/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable"

# 3. Invalidate the NEW CloudFront distribution
NEW_DIST=$(aws cloudformation describe-stacks \
  --stack-name AethernumSiteStack \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id "${NEW_DIST}" \
  --paths "/*"

# 4. Verify the new distribution works
curl -sI "https://${NEW_DIST}.cloudfront.net" | head -5

# 5. Deploy Route53 ALIAS records (if not already deployed)
cd infra
npx cdk deploy  # Route53 records are now part of the stack
```

**Note on DNS propagation:** Route53 ALIAS changes are typically visible within 60 seconds globally. TTL on ALIAS records is managed by Route53 (not configurable). Monitor with:

```bash
dig aethernum.io +short
# Should return CloudFront IP ranges, not the old distribution
```

### 7.4 Phase 3: Verify & Decommission

**Goal:** Confirm everything works, then tear down old resources.

```bash
# 1. Verify HTTPS works for both apex and www
curl -sI "https://aethernum.io" | head -10
curl -sI "https://www.aethernum.io" | head -10

# 2. Verify www → apex redirect
curl -sI "https://www.aethernum.io/projects/" | grep -i location
# Should show: location: https://aethernum.io/projects/

# 3. Verify HSTS header
curl -sI "https://aethernum.io" | grep -i strict-transport

# 4. Verify directory index resolution
curl -s "https://aethernum.io/projects/" | head -5
# Should return HTML content (not XML error)

# 5. Verify CDK diff shows no drift
cd infra
npx cdk diff  # Should be empty — no changes

# 6. Decommission old resources
# Option A: Delete old CloudFront distribution via AWS Console
# (must be disabled first — ~15 minutes to disable, then delete)

# Option B: If old bucket was created by the old CDK stack, run:
# cdk destroy OldStackName  # from the old import-based stack
# Note: import-based stacks can't be destroyed via CDK.
# Manual deletion required: delete distribution (console),
# empty and delete bucket (CLI).
```

**Rollback plan (if Phase 3 verification fails):**

```bash
# 1. Change Route53 ALIAS records back to old CloudFront distribution
#    (manual edit in Route53 console, or re-deploy old DNS config)
# 2. Wait 60 seconds for DNS propagation
# 3. Verify old site is serving: curl -sI https://aethernum.io
```

### 7.5 Post-Cutover Cleanup

- [ ] Delete old CloudFront distribution (`EQ8Z0TJW63VDP`) — **must disable first**
- [ ] Empty and delete old S3 bucket (`www.aethernum.io`) — **verify content is in new bucket first**
- [ ] Remove old bucket name from GitHub Actions variables
- [ ] Update `AWS_ROLE_ARN` if the deploy role changed
- [ ] Update `deploy.yml` to reference new bucket/distribution from CloudFormation stack outputs
- [ ] Archive old `site-stack.ts` (import version) for historical reference

---

## 8. Engineer Implementation Checklist

This checklist tracks implementation of task `t_f250f2c5`. Check off items as completed.

### 8.1 Stack Setup

- [ ] 1. Create `infra/lib/functions/` directory
- [ ] 2. Create `infra/lib/functions/viewer-request.js` with the CloudFront Function code (see [Appendix A](#appendix-a-cloudfront-function-code))
- [ ] 3. Rewrite `infra/lib/site-stack.ts` as a greenfield stack (replace import-based code)
- [ ] 4. Update `infra/bin/infra.ts` to instantiate the new stack
- [ ] 5. Update `infra/cdk.json` context — remove `bucketName`, `distributionId`, `distributionDomainName`; add `domainName: "aethernum.io"`
- [ ] 6. Run `npm ci` in `infra/` to ensure dependencies are installed

### 8.2 Synthesis & Validation

- [ ] 7. Run `npx tsc --noEmit` in `infra/` — should compile clean
- [ ] 8. Run `npx cdk synth` — verify CloudFormation template has all expected resources
- [ ] 9. Run `npx cdk diff` — review all resources are CREATE (no UPDATE or DELETE)
- [ ] 10. Manually inspect the synthesized template for correct OAC bucket policy, Function association, and security headers

### 8.3 Deployment (Phase 1)

- [ ] 11. Comment out Route53 ALIAS records in `site-stack.ts` for initial deploy
- [ ] 12. Run `npx cdk deploy` — wait for certificate validation (5–15 minutes)
- [ ] 13. Verify ACM certificate status is ISSUED in AWS Console
- [ ] 14. Uncomment Route53 ALIAS records, run `npx cdk deploy` again

### 8.4 Content & Cutover (Phase 2)

- [ ] 15. Build site with `pnpm build` from repo root
- [ ] 16. Sync `out/` to new S3 bucket (get bucket name from CloudFormation stack outputs)
- [ ] 17. Create CloudFront invalidation (`/*`)
- [ ] 18. Verify new CloudFront distribution serves content correctly using the `.cloudfront.net` URL

### 8.5 DNS Cutover (Phase 2 continued)

- [ ] 19. Verify Route53 ALIAS records are created and pointing to new distribution
- [ ] 20. Wait 60 seconds for DNS propagation
- [ ] 21. Verify `https://aethernum.io` serves the new distribution
- [ ] 22. Verify `https://www.aethernum.io` redirects to `https://aethernum.io` with 301

### 8.6 Verification (Phase 3)

- [ ] 23. Verify HSTS header present: `curl -sI https://aethernum.io | grep -i strict-transport`
- [ ] 24. Verify `X-Content-Type-Options: nosniff` present
- [ ] 25. Verify HTTP → HTTPS redirect: `curl -sI http://aethernum.io | grep -i location`
- [ ] 26. Verify `/projects/` returns HTML (index.html resolution working)
- [ ] 27. Verify direct S3 access is denied: try `aws s3 cp s3://<new-bucket>/index.html /tmp/` — should fail with 403
- [ ] 28. Run `npx cdk diff` — should show no drift

### 8.7 CI/CD Updates

- [ ] 29. Update `.github/workflows/deploy.yml`:
  - [ ] Replace hardcoded `BUCKET_NAME` variable with CloudFormation stack output lookup
  - [ ] Replace hardcoded `DISTRIBUTION_ID` variable with CloudFormation stack output lookup
  - [ ] Add a step to verify OAC is configured on the bucket
  - [ ] Update comment references from "imports existing" to "CDK-managed"
- [ ] 30. Update `docs/iam-permissions-policy.json` with new bucket ARN (if needed)

### 8.8 Cleanup

- [ ] 31. Disable old CloudFront distribution (`EQ8Z0TJW63VDP`) in AWS Console
- [ ] 32. Wait for distribution to finish disabling (~15 minutes)
- [ ] 33. Delete old CloudFront distribution
- [ ] 34. Empty and delete old S3 bucket (`www.aethernum.io`)
- [ ] 35. Update `README.md` to reflect CDK-managed infrastructure

### 8.9 Documentation

- [ ] 36. Verify this ARCHITECTURE.md is up-to-date with implementation details
- [ ] 37. Add deployment runbook comments to `site-stack.ts` (JSDoc on the class)

---

## Appendix A: CloudFront Function Code

**File:** `infra/lib/functions/viewer-request.js`

```javascript
/**
 * aethernum.io — CloudFront Viewer Request Function
 *
 * Responsibilities:
 *   1. Redirect www.aethernum.io → aethernum.io (301, preserves path)
 *   2. Append index.html to requests ending with /
 *
 * This function runs on every viewer request before cache lookup.
 * Execution time: <1ms. No network or filesystem access.
 *
 * @param {object} event — CloudFront viewer request event
 * @returns {object} — modified request or redirect response
 */
function handler(event) {
  var request = event.request;
  var headers = request.headers;
  var host = headers.host ? headers.host.value : '';

  // ── 1. www → apex redirect ────────────────────────────────────
  //
  // If the Host header is www.aethernum.io, return a 301 redirect
  // to the apex domain, preserving the full URI path.
  //
  // Status 301 = permanent redirect (canonicalization for SEO).
  // Status 302 = temporary. Use 302 for testing, switch to 301
  // after confirming the redirect works correctly.
  //
  if (host === 'www.aethernum.io') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: {
          value: 'https://aethernum.io' + request.uri,
        },
      },
    };
  }

  // ── 2. Append index.html to directory paths ───────────────────
  //
  // Next.js static export with trailingSlash:true generates
  // /projects/index.html, /contact/index.html, etc.
  //
  // When a browser requests /projects/, CloudFront needs to fetch
  // /projects/index.html from S3. This is an internal rewrite
  // (not a redirect) — the browser never sees index.html in the URL.
  //
  if (request.uri.endsWith('/')) {
    request.uri = request.uri + 'index.html';
  }

  return request;
}
```

**Important considerations:**

- The function must use **ECMAScript 5.1** syntax (no `const`, `let`, arrow functions, template literals). `var` and string concatenation only.
- The `host` header is checked with exact string comparison. `Host` header is always lowercased by CloudFront before reaching the function.
- CloudFront Functions have a **10 KB** code size limit and must execute in **<1ms**. This function is ~1 KB and executes in microseconds.

**Testing the www redirect (before DNS cutover):**

```bash
# Test with the distribution's cloudfront.net domain, overriding Host header
curl -sI -H "Host: www.aethernum.io" \
  "https://dXXXXXXXXXXXXX.cloudfront.net/" | head -5
```

---

## Appendix B: IAM Permissions for CDK Deploy

### B.1 CDK Bootstrap Role (created by `cdk bootstrap`)

The bootstrap role (`cdk-hnb659fds-deploy-role-*`) needs these permissions for this stack:

| Service | Actions | Resources |
|---------|---------|-----------|
| CloudFormation | `cloudformation:*` | `arn:aws:cloudformation:us-east-1:236128511652:stack/AethernumSiteStack/*` |
| S3 | `s3:CreateBucket`, `s3:PutBucketPolicy`, `s3:PutBucketPublicAccessBlock`, `s3:PutBucketVersioning`, `s3:PutBucketEncryption`, `s3:GetBucketPolicy`, `s3:DeleteBucketPolicy` | `arn:aws:s3:::aethernum-site-*` |
| CloudFront | `cloudfront:CreateDistribution`, `cloudfront:UpdateDistribution`, `cloudfront:DeleteDistribution`, `cloudfront:CreateFunction`, `cloudfront:UpdateFunction`, `cloudfront:DeleteFunction`, `cloudfront:CreateOriginAccessControl`, `cloudfront:DeleteOriginAccessControl` | `arn:aws:cloudfront::236128511652:*` |
| ACM | `acm:RequestCertificate`, `acm:DescribeCertificate`, `acm:DeleteCertificate` | `*` (certificate ARN not known in advance) |
| Route53 | `route53:ChangeResourceRecordSets`, `route53:GetHostedZone`, `route53:ListHostedZones` | `arn:aws:route53:::hostedzone/Z081843556URL5ASIU2GI` |
| IAM | `iam:PassRole` | CDK execution role ARN |

### B.2 Site Deploy Role (GitHub Actions — existing)

The site deploy role (`github-actions-deploy`) uses the [existing permissions policy](docs/iam-permissions-policy.json). After cutover, update the S3 bucket ARN and CloudFront distribution ID to match the new resources.

---

## Appendix C: GitHub Actions Deploy Pipeline

The existing deploy pipeline at `.github/workflows/deploy.yml` deploys Next.js static exports to S3. After cutover, the pipeline needs the following updates:

### C.1 Changes Required

1. **Remove hardcoded bucket/distribution references.** Replace `${{ vars.BUCKET_NAME }}` and `${{ vars.DISTRIBUTION_ID }}` with CloudFormation stack outputs.

2. **Add OAC verification step** (replaces the Public Access Block check, since CDK guarantees BPA is enabled).

3. **Updated deploy workflow snippet:**

```yaml
- name: Get stack outputs
  run: |
    BUCKET_NAME=$(aws cloudformation describe-stacks \
      --stack-name AethernumSiteStack \
      --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
      --output text)
    DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
      --stack-name AethernumSiteStack \
      --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
      --output text)

    echo "BUCKET_NAME=${BUCKET_NAME}" >> $GITHUB_ENV
    echo "DISTRIBUTION_ID=${DISTRIBUTION_ID}" >> $GITHUB_ENV

- name: Sync to S3
  run: |
    aws s3 sync out/ "s3://${BUCKET_NAME}/" \
      --delete \
      --cache-control "public, max-age=31536000, immutable"

- name: Invalidate CloudFront cache
  run: |
    aws cloudfront create-invalidation \
      --distribution-id "${DISTRIBUTION_ID}" \
      --paths "/*"
```

---

## Document Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-06-18 | 1.0 | Architecture design review | Initial greenfield CDK architecture specification |
