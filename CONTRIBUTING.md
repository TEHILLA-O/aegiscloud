# Contributing

Thanks for helping with AegisCloud. Keep infrastructure changes reproducible through CDK.

## Prerequisites

- Node.js 20 or newer (see `.nvmrc`)
- npm
- AWS CDK v2 (installed locally via `npm i`)
- An AWS account and profile that can create IAM, VPC, ECS, and RDS
- Docker for image builds during `cdk deploy` (synth in CI can skip it)

## Setup

```bash
cp .env.example .env
npm install
```

## Test and synth

```bash
npm test
npm run lint
npm run synth
```

## Deploy a disposable lab

```bash
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
npm run deploy:dev
npm run aegis -- status
```

Set `AEGIS_NOTIFY_EMAIL` before deploy if you want alarm and budget mail.

Tear down:

```bash
npm run destroy:dev
```

## Chaos Lab

Only inject against AegisCloud-tagged resources or stack outputs, as documented in `docs/CHAOS-LAB.md`:

```bash
npm run aegis -- chaos inject open-security-group
```

## Guidelines

- Do not widen auto-remediation to destructive isolation without an explicit design review.
- Keep `dev` and `production-demo` profile differences accurate in docs and code.
- Prefer OIDC federation for GitHub Actions deploy roles (no long-lived access keys in secrets).
- Keep commit messages short and human.
