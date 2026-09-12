# Disaster recovery

AegisCloud does not run active-active across regions. For a portfolio estate that would be theatre — you would pay for a second NAT pair, a second Multi-AZ database and a traffic-shift story nobody is paging you about.

The credible strategy is **backup + rebuild**.

## Recovery time / point (dev)

| | Target | Mechanism |
| --- | --- | --- |
| RPO | ≤ 24 hours (dev), ≤ 15 minutes of WAL-equivalent via automated backups (production-demo) | RDS automated backups, S3 versioning |
| RTO | ≤ 2 hours for the full stack in one region | `cdk deploy --all` + RDS snapshot restore |

## What is protected

- **RDS** — automated backups (`7d` dev, `14d` production-demo), storage encrypted, Multi-AZ on production-demo. No public access.
- **S3** — versioning on app, evidence, logs and chaos-lab buckets. TLS-only. KMS on the data plane buckets.
- **Secrets** — Secrets Manager, KMS-encrypted. `aegis dr test` confirms the master secret is readable.
- **Infrastructure** — the entire estate is in this repository. Reconstruction is a CDK deploy, not a memory exercise.

## `aegis dr test`

A non-destructive readiness probe:

1. RDS backup retention > 0 and storage encrypted
2. Automated snapshots visible (or retention about to produce them)
3. App bucket versioning `Enabled`
4. RDS master secret retrievable
5. Reconstruction path documented (`cdk deploy --all`)
6. Database restore procedure documented (below)

It does not perform a real failover. A real restore is an operator action.

## Database restore procedure

1. Identify the snapshot (`aws rds describe-db-snapshots --db-instance-identifier <id>`).
2. Restore into the isolated data subnets (`10.0.21.0/24`, `10.0.22.0/24`) with the existing RDS security group. Do not make it public.
3. Rotate the Secrets Manager secret and grant the execution / task roles access to the new secret version.
4. Point the ECS task definition at the new secret (CDK update) and roll the services (`circuitBreaker.rollback = true`).
5. Run `aegis status` and hit `/health` on each service through the ALB.
6. Only after health checks pass, delete the failed instance.

## Regional loss

If `eu-west-2` is gone:

1. `cdk deploy --all -c env=production-demo` in a second region (edit `CDK_DEFAULT_REGION`).
2. Restore the latest RDS snapshot that was copied (copy-snapshots is a documented follow-up, not enabled by default — it doubles backup cost).
3. Repoint Route 53 if a hosted zone was configured.

Until snapshot copy is enabled, regional loss is bounded by whatever you exported. That limitation is stated here on purpose.

## What we will not claim

- Zero RPO.
- Automatic cross-region failover.
- "Multi-region" because there is a CloudFront distribution.

Those claims would be false. Interviewers notice.
