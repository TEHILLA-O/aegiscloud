# Security Policy

## Authorized systems only

AegisCloud deploys and remediates AWS resources in accounts you control. Use it only in accounts and VPCs you are authorized to operate. The Chaos Lab mutates real AWS APIs; never point injectors at shared production estates without change control.

## Supported versions

Security-relevant fixes land on the default branch (`main`).

## Reporting a vulnerability

Please open a private GitHub security advisory, or contact the maintainer via the GitHub profile, with:

- Affected stack or service (network, remediation Lambdas, chaos injectors, CLI)
- Reproduction in a disposable `dev` account
- Impact (privilege escalation, unintended public exposure, remediation bypass)

Do not publish working exploit details against live estates in public issues.

## Responsible use

- Prefer the `dev` profile for experiments. Destroy it when finished.
- Treat Secrets Manager values, notify emails, and deploy role ARNs as sensitive.
- Destructive GuardDuty-style isolation stays off the automatic path by design; do not re-enable casually.
- Review `docs/SECURITY.md` for the platform security model (Config, GuardDuty, Security Hub, IAM, encryption).

## Scope of this policy

This document covers the AegisCloud repository and its AWS automation. It does not authorize testing or remediation in third-party accounts.
