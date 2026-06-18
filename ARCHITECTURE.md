# aethernum.io — Deploy Pipeline Architecture

## Overview

This document describes the deployment architecture for `aethernum.io`, a Next.js static site served from AWS S3 + CloudFront. The engineer profile should use this as the specification for implementation — no code changes beyond what's described here belong on this branch.

## Architecture Diagram

```
┌─────────────┐     push master      ┌──────────────────┐
│  Developer   │ ──────────────────▶  │  GitHub Actions  │
│  (git push)  │                     │  (ubuntu-latest) │
└─────────────┘                      └────────┬─────────┘
                                              │
                                              ▼
                                 ┌───────────────────────┐
                                 │   Step 1: Checkout    │
                                 │  actions/checkout@v4  │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                                 ┌───────────────────────┐
                                 │   Step 2: Setup pnpm  │
                                 │  pnpm/action-setup@v4 │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                                 ┌───────────────────────┐
                                 │  Step 3: Setup Node   │
                                 │  actions/setup-node@v4│
                                 │    node-version: 20   │
                                 │    cache: pnpm        │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                                 ┌───────────────────────┐
                                 │ Step 4: Install deps  │
                                 │  pnpm install --frozen │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                                 ┌───────────────────────┐
                                 │   Step 5: Build       │
                                 │  pnpm build           │
                                 │  (static export→out/) │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                                 ┌───────────────────────┐
                                 │  Step 6: AWS Auth     │
                                 │  configure-aws-creds  │
                                 │  (OIDC + role ARN)    │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                    ┌───────────────────────────────────────┐
                    │   Step 7: Retrieve stack outputs     │
                    │  aws cloudformation describe-stacks  │
                    │  AethernumSiteStack → bucket + dist  │
                    └───────────────────┬───────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │   Step 8: Verify S3 bucket security   │
                    │  Block Public Access verification     │
                    │  (BPA already enforced by CDK,        │
                    │   verified as defense-in-depth)       │
                    └───────────────────┬───────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │   Step 9: Sync to S3                  │
                    │  aws s3 sync out/ → s3://bucket/      │
                    │  --delete --cache-control headers     │
                    └───────────────────┬───────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │   Step 10: CloudFront Invalidation    │
                    │  create-invalidation --paths "/*"     │
                    │  Distribution resolved dynamically    │
                    └───────────────────────────────────────┘
```

## Components

### 1. Source Repository
- **Repo:** `brandonsbque/aethernum.io`
- **Default branch:** `master`
- **Trigger:** Push to `master` that touches relevant paths initiates the deploy pipeline
- **Path filter:** `app/**`, `content/**`, `public/**`, config files, `util/**`, and the workflow itself

### 2. Build Environment
- **CI runner:** GitHub Actions (`ubuntu-latest`)
- **Package manager:** pnpm (latest)
- **Runtime:** Node.js 20
- **Build command:** `pnpm build` (Next.js static export, outputs to `out/`)
- **Output:** Static HTML/CSS/JS in `out/` directory

### 3. Storage
- **Bucket:** CDK-managed (`aethernum-website`, resolved at deploy time via CloudFormation stack outputs)
- **Strategy:** Full sync (`--delete`) — the bucket mirrors the build output exactly
- **Cache headers:** `public, max-age=31536000, immutable` for all static assets
  - This works because the site is fully static; content hash-based filenames mean stale versions are never served

### 4. CDN
- **Distribution:** CDK-managed (ID resolved at deploy time via CloudFormation stack outputs)
- **Invalidation:** Full (`/*`) on every deploy
  - Alternative for future optimization: invalidate only changed paths (requires diff logic)

### 5. IAM Permissions (required for the deploy role)
See `docs/iam-permissions-policy.json` for the full policy. The deploy role needs:
- `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:GetBucketPublicAccessBlock` on the site bucket
- `cloudfront:CreateInvalidation` on the CloudFront distribution (wildcard since ID is dynamic)
- `cloudformation:DescribeStacks` on the `AethernumSiteStack` to resolve bucket name and distribution ID at deploy time

## GitHub Actions Secrets & Variables Required

### Secrets

| Secret Name     | Description                                                                    |
|-----------------|--------------------------------------------------------------------------------|
| `AWS_ROLE_ARN`  | ARN of the IAM role that GitHub OIDC assumes (e.g. `arn:aws:iam::236128511652:role/github-actions-deploy-aethernum`) |

### Variables

| Variable Name      | Description                          |
|--------------------|--------------------------------------|
| `AWS_REGION`       | AWS region for all operations        |

> **Note:** `BUCKET_NAME` and `DISTRIBUTION_ID` are no longer stored as GitHub variables. They are resolved at deploy time via `aws cloudformation describe-stacks --stack-name AethernumSiteStack`, reading the CDK stack outputs (`BucketName`, `DistributionId`). This ensures the workflow always deploys to the correct resources without manual variable sync.

### Authentication

The workflow uses **GitHub OIDC** (`id-token: write` + `aws-actions/configure-aws-credentials@v4` with `role-to-assume`). No long-lived IAM user access keys are stored or used. The IAM role's trust policy must be locked to `repo:brandonsbque/aethernum.io:ref:refs/heads/master`. See `docs/iam-trust-policy.json` for the exact trust policy and `docs/iam-permissions-policy.json` for the permissions policy.

## Key Design Decisions

1. **pnpm over npm/yarn:** The repo already ships a `pnpm-lock.yaml` — use `pnpm/action-setup` for caching and consistency.
2. **Static export:** Next.js `output: "export"` is already configured in `next.config.mjs`. No Node server needed — pure static files.
3. **Full bucket sync (`--delete`):** Safe because the bucket exists solely to serve this site. Removes orphaned files from the CDN.
4. **Full cache invalidation (`/*`):** Simple and correct for the site's current size. Can be scoped to changed paths later if deploy speed becomes a concern.
5. **Long cache TTL:** `max-age=31536000` (1 year) + `immutable` is standard for content-hashed static assets. CloudFront will still serve new files immediately after invalidation.

## Implementation Notes for the Engineer

The entire implementation lives in a single GitHub Actions workflow file at `.github/workflows/deploy.yml`. The workflow:

- Resolves S3 bucket name and CloudFront distribution ID dynamically from `AethernumSiteStack` CloudFormation stack outputs (no hardcoded identifiers)
- Retrieves stack outputs via `aws cloudformation describe-stacks` after OIDC authentication
- Preserves S3 Block Public Access verification as a defense-in-depth security check
- Uses the Next.js `output: "export"` config already in `next.config.mjs`
- Triggers on pushes to `master` that touch content paths (`app/`, `content/`, `public/`, config files, `util/`, and the workflow itself)

## Non-Goals (out of scope for this deploy pipeline)

- Preview/staging deployments for PR branches
- Manual rollback mechanism (S3 versioning + CloudFront can support this later)
- Slack/email notifications on deploy status
- Lighthouse/performance CI checks
- Branch protection rules (GitHub free tier limitation)
