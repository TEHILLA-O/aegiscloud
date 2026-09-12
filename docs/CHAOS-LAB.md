# Chaos Lab

Four injectors. All of them mutate **real** AWS resources that belong to AegisCloud, then rely on the same detectors a production estate would use.

```
aegis chaos inject public-s3
aegis chaos inject open-security-group
aegis chaos inject ecs-failure
aegis chaos inject cpu-spike
```

| Injector | Mutation | Detector | Remediator |
| --- | --- | --- | --- |
| `public-s3` | Disables Block Public Access on the chaos-lab bucket | Config `S3_BUCKET_PUBLIC_*` | Restore the four Block Public Access flags |
| `open-security-group` | Authorises `22/tcp` from `0.0.0.0/0` on the ECS SG | Config `INCOMING_SSH_DISABLED` | `RevokeSecurityGroupIngress` |
| `ecs-failure` | `StopTask` on the order service | `RunningTaskCount` alarm | Notify + diagnostics (approval) |
| `cpu-spike` | `POST /chaos/cpu` busy-loop | ECS CPU alarm | Increment desired count (capped at 8) |

Blast radius is limited to the chaos-lab bucket, the ECS security group, and the order service. RDS, Redis, evidence and app buckets are never opened.

Config evaluation is not instant. For a live interview, inject `open-security-group` first, then `aegis incidents`. If Config is slow, the classifier also accepts a synthetic EventBridge payload with `{ "type": "open-security-group", "resourceId": "sg-..." }`.
