# Incident response

This is the heart of AegisCloud.

```
CloudWatch Alarm / Config / GuardDuty / Security Hub
      ↓
EventBridge
      ↓
Step Functions  (aegiscloud-<env>-incident-response)
      ↓
Classify incident
      ↓
┌─────────────────────────┐
│ Safe to auto-remediate? │
└────────────┬────────────┘
             │
       YES   │   NO
        ↓    │    ↓
     Remediate   Notify
        ↓
     Validate
        ↓
   Fixed?
   ↓     ↓
 YES     NO
 ↓       ↓
Close   Escalate
```

The Amazon States Language contract is checked in at `workflows/incident-response/definition.asl.json`. CDK is the deployable source of truth.

## First-wave incidents

| Detector | Classification | Default action (`dev`) |
| --- | --- | --- |
| Public S3 | `public-s3` | Restore Block Public Access |
| Dangerous security-group rule | `open-security-group` | Revoke `22/tcp 0.0.0.0/0` |
| ECS task repeatedly failing | `ecs-failure` | Diagnostics + notify |
| CPU overload | `cpu-spike` | Scale out |
| Disk / storage threshold | `disk-threshold` | Notify (approval) |
| Unhealthy ALB target | `unhealthy-target` | Force new deployment if AUTO |
| Noncompliant EC2 patch state | `patch-noncompliant` | SSM workflow / notify (Fargate-first estate) |
| GuardDuty high-severity finding | `guardduty-finding` | Severity ladder |
| Missing required tags | `missing-tags` | Apply defaults |
| Encryption policy violation | `encryption-violation` | Raise, do not flip bits |

## Interview walkthrough

```
aegis chaos inject open-security-group
```

```
AEGISCLOUD INCIDENT

14:02:10
Security group sg-091823 changed.

14:02:11
AWS Config:
NON_COMPLIANT

Reason:
SSH 22/tcp exposed to 0.0.0.0/0

14:02:11
EventBridge:
Security event received

14:02:12
Step Functions:
Remediation workflow started

14:02:13
Risk Classification:
HIGH

14:02:14
SSM / Lambda:
Removing unsafe ingress rule

14:02:17
AWS Config:
COMPLIANT

Incident duration:
~7 seconds

Status:
AUTO-REMEDIATED
```

Watch it live:

```
aegis incidents
aegis security
```

Config evaluation is not instantaneous. In a demo, allow 1–3 minutes for the Config rule to flip, or invoke the state machine with a synthetic payload (the classifier accepts a manual `type` field for that reason).

## Evidence

Every classification, remediator result and validation write back to `aegiscloud-<env>-incidents`. The remediator also has write access to the evidence bucket for future dump-to-S3 extensions (ECS `DescribeTasks`, target-health snapshots).

## Operator commands

```
aegis status
aegis incidents
aegis security
```

There is no `aegis approve` in v1. Approval is SNS + a human re-running the remediator or flipping the Config rule once the change is understood. That is deliberate: a portfolio should show restraint.
