# Operations API

HTTP API in front of `services/remediation/operations.ts`.

Deployed by `RemediationStack` as an API Gateway HTTP API. The `aegis` CLI reads `/aegiscloud/<env>/operations-api-url` from SSM and calls:

| Path | Purpose |
| --- | --- |
| `/status` | Health summary |
| `/resources` | Inventory |
| `/incidents` | DynamoDB incident log |
| `/security` | Config / GuardDuty / Security Hub |
| `/costs` | Month-to-date Cost Explorer |

Read-only. Mutations go through Chaos Lab injectors and the Step Functions remediator.
