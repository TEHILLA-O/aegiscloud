# Architecture

AegisCloud is an event-driven AWS platform that deploys a realistic application estate, watches it, and remediates an approved class of failures without an operator on the call.

The application workload is intentionally modest: order, customer and worker APIs on ECS Fargate. The engineering is in the surrounding control plane: networking, IAM, detection, orchestration, cost control and a Chaos Lab that can break the estate on demand.

```
                         INTERNET
                             │
                       Route 53 / ACM   (optional)
                             │
                         CloudFront     (production-demo)
                             │
                            WAF         (production-demo)
                             │
                            ALB
                             │
                    ┌────────┴────────┐
                    │                 │
              ECS Fargate        ECS Fargate
             Order / Customer      Worker
                    │                 │
                    └────────┬────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
           PostgreSQL      Redis          S3
              RDS       ElastiCache     Storage
```

```
                    OBSERVABILITY
                         │
                     CloudWatch
                         │
              Alarms / Logs / Metrics
                         │
                     EventBridge
                         │
                  Step Functions
                         │
              ┌──────────┼─────────┐
              ↓          ↓         ↓
           Lambda       SSM       SNS
              │          │
              └──── REMEDIATE ─────┘
```

```
                     SECURITY
                         │
               ┌─────────┼─────────┐
               ↓         ↓         ↓
            Config   GuardDuty  Security Hub
               │
               └──── EventBridge
                         │
                   Remediation
```

## Stacks

| Stack | Responsibility |
| --- | --- |
| `Network` | VPC, explicit CIDRs, NAT, flow logs, gateway/interface endpoints, security groups |
| `Data` | KMS, Secrets Manager, RDS PostgreSQL, ElastiCache Redis, S3 (app / evidence / logs / chaos) |
| `Compute` | ECR, ECS Fargate, ALB, target groups, health checks, autoscaling, rolling deploys |
| `Security` | AWS Config rules, GuardDuty, Security Hub, WAF, CloudFront |
| `Observability` | Container Insights, alarms, dashboard, SNS |
| `Remediation` | DynamoDB incidents, classifier / remediator / validator Lambdas, Step Functions, operations API |
| `Cost` | Budgets, weekday shutdown of the dev profile |

CDK TypeScript is the only deployment mechanism. There is no click-ops path.

## Control-plane flow

1. A detector emits an event (Config compliance change, GuardDuty finding, Security Hub import, CloudWatch alarm).
2. EventBridge routes it to the incident-response state machine.
3. `classify` writes an incident to DynamoDB and stamps severity + policy.
4. The state machine branches:
   - `AUTO_REMEDIATE` and safe → remediator → wait → validate → close or escalate
   - `APPROVAL_REQUIRED` → SNS, leave open
   - `OBSERVE` → record and notify
5. Evidence lands in the incidents table (and the evidence bucket as dumps are added). The `aegis` CLI reads the same data the orchestrator writes.

## Why this is not a simulation

- AWS Config natively evaluates resources and can drive Systems Manager Automation or EventBridge.
- EventBridge can target Lambda, Step Functions, SNS, SQS, ECS and SSM.
- ECS Container Insights publishes cluster, service, task and container metrics that the alarms consume.
- The Chaos Lab mutates real AWS APIs (`AuthorizeSecurityGroupIngress`, `PutBucketPublicAccessBlock`, `StopTask`). The remediator uses the inverse APIs.

## Profiles

| | `dev` | `production-demo` |
| --- | --- | --- |
| NAT | 1 | 2 |
| RDS / Redis | single-AZ | Multi-AZ |
| GuardDuty / Security Hub / WAF / CloudFront | off | on |
| Default policy | `AUTO_REMEDIATE` | `APPROVAL_REQUIRED` |
| Weekday shutdown | 20:00 UTC | none |
| Monthly budget | £25 | £80 |

`dev` exists so the portfolio does not require an always-on bill. `production-demo` exists so a design review can inspect the HA and security shape.

## What this project is not

- Not a multi-region active-active platform. DR is backup + rebuild; see [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md).
- Not a generic chaos-engineering product. The injectors cover four interview-visible failure classes.
- Not an invitation to auto-remediate every GuardDuty finding. Destructive isolation is gated.

## Repository layout

```
infrastructure/   CDK entrypoint and stacks (network, compute, data, security, observability, remediation, cost)
services/demo-api/        Order / Customer / Worker (one image, SERVICE_NAME)
services/remediation/     classify, remediate, validate, operations, shutdown
workflows/incident-response/   Step Functions definition
cli/aegis/        Operator CLI (status, resources, incidents, chaos, deploy, destroy, dr)
chaos/            Controlled injectors for AegisCloud-tagged resources
dashboards/       CloudWatch-oriented views
tests/            Jest tests
docs/             architecture, networking, incident response, chaos lab, security, DR, cost
```
