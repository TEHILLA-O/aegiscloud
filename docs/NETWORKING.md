# Networking

```
VPC  10.0.0.0/16

AZ-A                           AZ-B

Public                         Public
10.0.1.0/24                    10.0.2.0/24
    │                              │
   ALB / NAT                      ALB / NAT
    │                              │
────────────────────────────────────────

Private App                    Private App
10.0.11.0/24                   10.0.12.0/24
    │                              │
 ECS tasks                     ECS tasks
 Remediation Lambdas           (same)

────────────────────────────────────────

Isolated Data                  Isolated Data
10.0.21.0/24                   10.0.22.0/24
    │                              │
 RDS                           RDS
 Redis                         Redis
```

CIDRs are declared explicitly in `NetworkStack`. They are not left to CDK's sequential allocator.

## Routing

| Subnet | Default route | Purpose |
| --- | --- | --- |
| Public | `0.0.0.0/0` → Internet Gateway | ALB, NAT, nothing that holds data |
| Private App | `0.0.0.0/0` → NAT | Fargate tasks pull images and talk to AWS APIs |
| Isolated Data | none | PostgreSQL and Redis cannot initiate internet connections |

`dev` shares a single NAT in AZ-A (private AZ-B still egresses through it). `production-demo` places a NAT in each public subnet so an AZ failure does not black-hole egress.

## Security groups

Relationships, not wide CIDRs:

| Group | Ingress | Egress |
| --- | --- | --- |
| ALB | 80/443 from the internet | to ECS :8080 |
| ECS | 8080 from ALB only | AWS APIs + data tier |
| Lambda | none | AWS APIs + data tier |
| RDS | 5432 from ECS and Lambda | none |
| Redis | 6379 from ECS and Lambda | none |

There is no bastion and no SSH rule in the synthesised template. The only `0.0.0.0/0` listeners are the ALB's public HTTP/HTTPS ports — that is the intended edge.

The Chaos Lab *adds* `tcp/22` from `0.0.0.0/0` to the ECS group on demand. Config marks it `NON_COMPLIANT` and the remediator revokes it.

## Endpoints

Always-on (no hourly charge):

- S3 gateway endpoint
- DynamoDB gateway endpoint

`production-demo` also attaches interface endpoints in the app subnets for ECR, CloudWatch Logs, Secrets Manager, SSM, STS, KMS and ECS so image pulls and remediations survive a NAT outage.

## Flow logs

VPC flow logs go to CloudWatch Logs (`/aegiscloud/<env>/vpc/flow-logs`) with a two-week retention. They are an evidence source for GuardDuty-adjacent investigations, not a SIEM.

## What we refuse

- Public RDS (`PubliclyAccessible: false`, isolated subnets, no internet route).
- Hardcoded passwords (Secrets Manager generated secret, KMS-encrypted).
- `0.0.0.0/0` on data or application security groups.
- Assigning public IPs to Fargate tasks.
