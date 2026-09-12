# Security

AegisCloud treats security as a control plane, not a checklist at the end of a README.

## Identity

- ECS execution role: pull images, write logs, read the RDS secret.
- ECS task role: S3 app bucket + the same secret. Nothing else.
- Remediation Lambda: a bounded allow-list (`RevokeSecurityGroupIngress`, `PutBucketPublicAccessBlock`, `UpdateService`, `CreateTags`, read-only describe APIs). It cannot delete the VPC, rotate account keys, or disable GuardDuty.
- GitHub Actions assumes an IAM role through OIDC. There are no long-lived access keys in repository secrets.

## Data protection

- RDS storage encrypted with a customer-managed KMS key; IAM DB authentication enabled.
- Redis encrypted at rest and in transit.
- S3: Block Public Access, TLS-only bucket policies (`enforceSSL`), versioning, KMS (app / evidence / logs).
- Secrets Manager owns the database password. Containers receive it as a task secret.

## Detection

AWS Config (always on in both profiles) evaluates:

| Rule | Intent |
| --- | --- |
| `INCOMING_SSH_DISABLED` | No public SSH |
| `S3_BUCKET_PUBLIC_READ_PROHIBITED` | No public read |
| `S3_BUCKET_PUBLIC_WRITE_PROHIBITED` | No public write |
| `S3_BUCKET_SSL_REQUESTS_ONLY` | TLS required |
| `RDS_STORAGE_ENCRYPTED` | Database encryption |
| `RDS_INSTANCE_PUBLIC_ACCESS_CHECK` | No public RDS |
| `ENCRYPTED_VOLUMES` | EBS encryption |
| `REQUIRED_TAGS` | `Project=AegisCloud`, `ManagedBy=CDK` |
| `ROOT_ACCOUNT_MFA_ENABLED` | Account hygiene |
| `IAM_PASSWORD_POLICY` | Account hygiene |

`production-demo` additionally enables GuardDuty (S3 protection, EBS malware) and Security Hub with default standards.

Findings flow:

```
GuardDuty Finding
        ↓
  Security Hub
        ↓
    EventBridge
        ↓
AegisCloud Security Orchestrator
        ↓
   Severity?
   ├── LOW      → record          (OBSERVE)
   ├── MEDIUM   → notify          (APPROVAL_REQUIRED)
   ├── HIGH     → approval/fix    (policy-dependent)
   └── CRITICAL → quarantine notify + optional remediator
```

## Remediation policies

| Policy | Behaviour |
| --- | --- |
| `OBSERVE` | Persist the incident. Do not mutate. |
| `APPROVAL_REQUIRED` | Persist + SNS. Wait for an operator. |
| `AUTO_REMEDIATE` | Mutate only if `safeToAutoRemediate` is true, then validate. |

`dev` defaults to `AUTO_REMEDIATE` so the Chaos Lab is a live demo. `production-demo` defaults to `APPROVAL_REQUIRED`.

Safe automatic classes:

- Public S3 on the chaos-lab bucket → restore Block Public Access
- Public SSH on a security group → revoke `22/tcp 0.0.0.0/0`
- CPU overload → increment desired count (capped)
- Missing EC2-addressable tags → apply the standard tag set

Not automatic:

- Encryption violations (need a rebuild, not a toggle)
- Repeated ECS crashes (collect evidence, notify)
- Disk threshold (storage modify is billed and irreversible enough to need a human)
- GuardDuty isolation of a workload (destructive; notify and optionally quarantine only when CRITICAL + AUTO)

## Edge

`production-demo` attaches a regional WAF (Common Rule Set, Known Bad Inputs, SQLi, 2000 req/5 min IP rate limit) to the ALB and a CloudFront distribution with caching disabled. Custom domains (Route 53 + ACM) are opt-in through `AEGIS_HOSTED_ZONE` / `AEGIS_DOMAIN` because they require a real zone.

CloudFront-scoped WAFs must live in `us-east-1`. This project keeps WAF regional and associated with the ALB so a single-region deploy stays honest.

## Chaos Lab blast radius

Injectors only touch resources tagged `Project=AegisCloud` or explicitly outputted by the Data/Compute stacks (chaos-lab bucket, ECS service, ECS security group). They do not open the RDS security group or disable Block Public Access on the evidence bucket.
