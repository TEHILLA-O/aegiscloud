# Cost model

AegisCloud is a portfolio environment. The first operational requirement is that it can be turned off.

## Profiles

| | `dev` | `production-demo` |
| --- | --- | --- |
| NAT Gateways | 1 | 2 |
| Fargate (order+customer+worker) | 3 × 0.25 vCPU / 512 MiB | 5 × 0.5 vCPU / 1 GiB |
| RDS | `t4g.micro`, single-AZ, 20 GiB | `t4g.small`, Multi-AZ, 50 GiB |
| Redis | `cache.t4g.micro` × 1 | `cache.t4g.small` × 2 |
| GuardDuty / Security Hub / WAF / CloudFront | off | on |
| Weekday shutdown | scale ECS to 0 at 20:00 UTC | none |
| Budget | £25 / month | £80 / month |

Figures are orders of magnitude for `eu-west-2`, not quotes. NAT and RDS dominate.

## Always-on tax (dev, idle, weekday nights off)

Rough monthly if you leave data-plane running and park ECS overnight:

| Item | Why it costs |
| --- | --- |
| NAT Gateway | hourly + data processed — the largest surprise |
| RDS `t4g.micro` | hourly even with no connections |
| ElastiCache `t4g.micro` | hourly |
| ALB | hourly + LCU |
| AWS Config | recorder + rules + S3 delivery |
| CloudWatch | logs, alarms, Container Insights |
| Secrets Manager / KMS / S3 / DynamoDB | cents unless you store a lot |

If the bill must be near-zero between demos: `aegis destroy dev`. The command is `cdk destroy --all`. Isolated data is *not* deletion-protected in `dev`.

## Tags (every resource)

```
Project=AegisCloud
Environment=Dev | ProductionDemo
Owner=Portfolio
ManagedBy=CDK
CostCenter=Portfolio-AegisCloud
```

Applied by `applyStandardTags`. Cost Explorer and the monthly budget filter on `Project=AegisCloud`.

## Controls

- AWS Budget at 80% actual and 100% forecasted (email if `AEGIS_NOTIFY_EMAIL` is set).
- `aegis costs` reads Cost Explorer (`us-east-1` endpoint) filtered by the project tag. Data lags ~24h.
- Dev shutdown Lambda scales ECS desired count to 0 on weeknights and back to at least 1 on weekday mornings. It does **not** stop NAT/RDS — those need `destroy` or a manual stop.
- Resource inventory: `aegis resources`.

## How to keep a demo cheap

1. Work in `dev`.
2. Disable Config only if you accept losing the headline Chaos Lab path (`enableConfig` is the one detection service `dev` keeps).
3. Destroy after the interview.
4. Never enable GuardDuty "to see what happens" in an account that already has a large S3 estate — it prices by volume.

## What we will not do

- Leave a Multi-AZ `r6g.large` running "because production".
- Use NAT Gateway per-AZ in `dev`.
- Store AWS access keys in GitHub Actions to save ten minutes of OIDC setup.
