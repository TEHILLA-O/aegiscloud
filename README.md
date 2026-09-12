# AegisCloud

**AWS self-healing infrastructure, security and operations platform.**

AegisCloud deploys a realistic application environment, monitors it continuously, detects operational and security problems, and automatically fixes an approved class of those problems.

The standout feature is a controlled Chaos Lab: you break AWS on purpose, then watch the platform put it back.

```
aegis chaos inject open-security-group
```

```
AEGISCLOUD INCIDENT

14:02:10  Security group sg-091823 changed.
14:02:11  AWS Config: NON_COMPLIANT
          Reason: SSH 22/tcp exposed to 0.0.0.0/0
14:02:11  EventBridge: security event received
14:02:12  Step Functions: remediation workflow started
14:02:13  Risk classification: HIGH
14:02:14  Remediator: removing unsafe ingress rule
14:02:17  AWS Config: COMPLIANT

Incident duration   ~7s
Status              AUTO-REMEDIATED
```

This follows real AWS operational patterns — Config, EventBridge, Step Functions, Systems Manager, GuardDuty, Security Hub — not a mocked portfolio diagram.

---

## What you can talk about in an interview

AWS VPC · subnets · routing · IAM · ECS · Fargate · ECR · ALB · RDS · ElastiCache · S3 · CloudFront · Route 53 · ACM · WAF · Lambda · EventBridge · Step Functions · Systems Manager · AWS Config · GuardDuty · Security Hub · CloudWatch · SNS · Secrets Manager · KMS · CDK · Docker · CI/CD (GitHub OIDC) · autoscaling · HA · observability · incident response · self-healing infrastructure · cloud security · disaster recovery · FinOps

The application is deliberately small. The engineering is the estate around it.

---

## Repository

```
├── infrastructure/
│   ├── bin/aegiscloud.ts
│   └── lib/
│       ├── network-stack.ts
│       ├── compute-stack.ts
│       ├── data-stack.ts
│       ├── security-stack.ts
│       ├── observability-stack.ts
│       ├── remediation-stack.ts
│       └── cost-stack.ts
├── services/
│   ├── demo-api/          Order / Customer / Worker (one image, SERVICE_NAME)
│   └── remediation/       classify · remediate · validate · operations · shutdown
├── workflows/incident-response/
├── cli/aegis/
├── chaos/
├── dashboards/
├── tests/
└── docs/
```

## Architecture (short)

Internet → (optional CloudFront / WAF) → ALB → ECS Fargate (order, customer, worker) in private app subnets. RDS PostgreSQL and ElastiCache Redis live in isolated data subnets with **no internet route**. Credentials come from Secrets Manager. Every resource is tagged `Project=AegisCloud`.

Detection (CloudWatch, Config, GuardDuty, Security Hub) emits to EventBridge, which starts a Step Functions state machine. The machine classifies, then remediates or notifies, then validates.

Full diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Networking

VPC `10.0.0.0/16`, two AZs, explicit CIDRs:

| Tier | AZ-A | AZ-B |
| --- | --- | --- |
| Public (ALB / NAT) | `10.0.1.0/24` | `10.0.2.0/24` |
| Private app (ECS / Lambda) | `10.0.11.0/24` | `10.0.12.0/24` |
| Isolated data (RDS / Redis) | `10.0.21.0/24` | `10.0.22.0/24` |

Security groups reference each other. There is no public database, no hardcoded password, and no SSH anywhere in the synthesised template.

[docs/NETWORKING.md](docs/NETWORKING.md)

## Self-healing

```
Classify → safe to auto-remediate?
               │
         YES   │   NO
          ↓    │    ↓
     Remediate │  Notify
          ↓
      Validate → close or escalate
```

Three policies: `OBSERVE` · `APPROVAL_REQUIRED` · `AUTO_REMEDIATE`.

`dev` ships `AUTO_REMEDIATE` so the Chaos Lab is a live demo. `production-demo` ships `APPROVAL_REQUIRED`. Destructive actions (GuardDuty isolation, encryption rebuilds, storage growth) stay off the automatic path.

[docs/INCIDENT-RESPONSE.md](docs/INCIDENT-RESPONSE.md) · [docs/SECURITY.md](docs/SECURITY.md)

## Chaos Lab

```
aegis chaos inject public-s3
aegis chaos inject open-security-group
aegis chaos inject ecs-failure
aegis chaos inject cpu-spike
```

Injectors only touch AegisCloud-tagged resources or stack outputs (chaos-lab bucket, ECS service, ECS security group). Walkthrough: [docs/CHAOS-LAB.md](docs/CHAOS-LAB.md).

## CLI

```
aegis status
aegis resources
aegis incidents
aegis security
aegis costs
aegis deploy
aegis destroy dev
aegis dr test
```

`aegis status` prints the environment, network, compute, database, security and open-incident summary. `aegis destroy dev` is the cost off-switch.

## Cost

| Profile | Intent | Budget | Notes |
| --- | --- | --- | --- |
| `dev` | Disposable lab | £25 | 1 NAT, single-AZ data, weekday ECS shutdown |
| `production-demo` | Interview HA shape | £80 | 2 NAT, Multi-AZ, WAF, GuardDuty, Security Hub |

Do not leave `production-demo` running between conversations.

[docs/COST-MODEL.md](docs/COST-MODEL.md)

## Disaster recovery

Backup + rebuild. Not active-active. `aegis dr test` checks RDS backups, S3 versioning, secret availability and the reconstruction path.

[docs/DISASTER-RECOVERY.md](docs/DISASTER-RECOVERY.md)

## Prerequisites

- Node.js 20+
- AWS CDK v2 (`npm i` installs the CLI locally)
- An AWS account and a profile that can create IAM, VPC, ECS, RDS
- Docker, for image builds during `cdk deploy` (synth in CI can skip it)

```bash
cp .env.example .env
npm install
npm test
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
npm run synth
npm run deploy:dev
npm run aegis -- status
```

Set `AEGIS_NOTIFY_EMAIL` before deploy if you want alarm and budget mail.

Tear down:

```bash
npm run destroy:dev
# or
npx ts-node cli/aegis/src/index.ts destroy dev
```

## CI/CD

GitHub Actions: test → `tsc` → `cdk synth` → deploy `dev` on `main` using **OIDC federation**. No long-lived access keys in repository secrets. Create an IAM role that trusts `token.actions.githubusercontent.com` and store its ARN as `AWS_DEPLOY_ROLE_ARN`.

## Related work

| Repo | Language | Story |
| --- | --- | --- |
| LedgerX | C# | FinTech / distributed systems |
| Sentinel | C# | Kafka / fraud / real-time |
| Atlas | Python | LangGraph / RAG / agents |
| VPSForge | Rust | Linux / VPS provisioning |
| **AegisCloud** | **TypeScript / AWS** | **Cloud architecture, DevOps, security, self-healing** |
