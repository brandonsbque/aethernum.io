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
                                 │  (secrets.AWS_*)      │
                                 └───────────┬───────────┘
                                             │
                                             ▼
                    ┌───────────────────────────────────────┐
                    │   Step 7: Sync to S3                  │
                    │  aws s3 sync out/ → www.aethernum.io  │
                    │  --delete --cache-control headers     │
                    └───────────────────┬───────────────────┘
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │   Step 8: CloudFront Invalidation     │
                    │  create-invalidation --paths "/*"     │
                    │  Distribution: EQ8Z0TJW63VDP          │
                    └───────────────────────────────────────┘
```

## Components

### 1. Source Repository
- **Repo:** `brandonsbque/aethernum.io`
- **Default branch:** `master`
- **Trigger:** Push to `master` initiates the deploy pipeline

### 2. Build Environment
- **CI runner:** GitHub Actions (`ubuntu-latest`)
- **Package manager:** pnpm (latest)
- **Runtime:** Node.js 20
- **Build command:** `pnpm build` (Next.js static export, outputs to `out/`)
- **Output:** Static HTML/CSS/JS in `out/` directory

### 3. Storage
- **Bucket:** `www.aethernum.io` (us-east-1)
- **Strategy:** Full sync (`--delete`) — the bucket mirrors the build output exactly
- **Cache headers:** `public, max-age=31536000, immutable` for all static assets
  - This works because the site is fully static; content hash-based filenames mean stale versions are never served

### 4. CDN
- **Distribution:** `EQ8Z0TJW63VDP`
- **Invalidation:** Full (`/*`) on every deploy
  - Alternative for future optimization: invalidate only changed paths (requires diff logic)

### 5. IAM Permissions (required for the deploy user)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::www.aethernum.io",
        "arn:aws:s3:::www.aethernum.io/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::236128511652:distribution/EQ8Z0TJW63VDP"
    }
  ]
}
```

## GitHub Actions Secrets Required

| Secret Name             | Description                          |
|-------------------------|--------------------------------------|
| `AWS_ACCESS_KEY_ID`     | IAM user access key for deploy user  |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key for deploy user  |

The IAM user should have only the S3 + CloudFront permissions listed above (least privilege).

## Key Design Decisions

1. **pnpm over npm/yarn:** The repo already ships a `pnpm-lock.yaml` — use `pnpm/action-setup` for caching and consistency.
2. **Static export:** Next.js `output: "export"` is already configured in `next.config.mjs`. No Node server needed — pure static files.
3. **Full bucket sync (`--delete`):** Safe because the bucket exists solely to serve this site. Removes orphaned files from the CDN.
4. **Full cache invalidation (`/*`):** Simple and correct for the site's current size. Can be scoped to changed paths later if deploy speed becomes a concern.
5. **Long cache TTL:** `max-age=31536000` (1 year) + `immutable` is standard for content-hashed static assets. CloudFront will still serve new files immediately after invalidation.

## Implementation Notes for the Engineer

The entire implementation lives in a single GitHub Actions workflow file at `.github/workflows/deploy.yml`. The workflow:

- Must NOT reference any uncommitted secrets (use GitHub Actions secrets)
- Must use the Next.js `output: "export"` config already in `next.config.mjs`
- Must respect the existing `mkdocs.yml` (from the Chronark template) — the `on: push` trigger is `master`

## Non-Goals (out of scope for this deploy pipeline)

- Preview/staging deployments for PR branches
- Manual rollback mechanism (S3 versioning + CloudFront can support this later)
- Slack/email notifications on deploy status
- Lighthouse/performance CI checks
- Branch protection rules (GitHub free tier limitation)
