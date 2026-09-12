import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { Classification, IncidentType, Policy, Severity } from './types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.INCIDENTS_TABLE!;
const DEFAULT_POLICY = (process.env.DEFAULT_POLICY || 'AUTO_REMEDIATE') as Policy;

export const handler = async (event: Record<string, unknown>): Promise<Classification> => {
  const classification = classify(event);
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        ...classification,
        incidentId: classification.incidentId,
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
        ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90,
      },
    }),
  );

  return classification;
};

export function classify(event: Record<string, unknown>): Classification {
  const source = String(event.source || event['source'] || 'unknown');
  const detail = (event.detail || event) as Record<string, unknown>;

  if (source === 'aws.config') {
    return fromConfig(detail, event);
  }
  if (source === 'aws.guardduty') {
    return fromGuardDuty(detail, event);
  }
  if (source === 'aws.securityhub') {
    return fromSecurityHub(detail, event);
  }
  if (source === 'aws.cloudwatch') {
    return fromCloudWatch(detail, event);
  }
  if (typeof event.type === 'string') {
    return fromManual(event);
  }

  return base({
    type: 'unknown',
    title: 'Unclassified event',
    severity: 'LOW',
    safeToAutoRemediate: false,
    policy: 'OBSERVE',
    reason: 'Event did not match a known AegisCloud detector',
    source,
    raw: event,
  });
}

function fromConfig(detail: Record<string, unknown>, raw: unknown): Classification {
  const rule = String(
    (detail.configRuleName as string) ||
      (detail.newEvaluationResult as { configRuleName?: string } | undefined)?.configRuleName ||
      '',
  ).toLowerCase();
  const resourceId = String(
    (detail.resourceId as string) ||
      (detail.newEvaluationResult as { evaluationResultIdentifier?: { evaluationResultQualifier?: { resourceId?: string } } } | undefined)
        ?.evaluationResultIdentifier?.evaluationResultQualifier?.resourceId ||
      '',
  );
  const resourceType = String(detail.resourceType || '');

  if (rule.includes('ssh') || rule.includes('incoming_ssh') || rule.includes('restrictedssh')) {
    return base({
      type: 'open-security-group',
      title: 'SSH 22/tcp exposed to 0.0.0.0/0',
      severity: 'HIGH',
      safeToAutoRemediate: true,
      resourceId,
      resourceType: resourceType || 'AWS::EC2::SecurityGroup',
      reason: 'AWS Config NON_COMPLIANT: inbound SSH from the public internet',
      source: 'aws.config',
      raw,
    });
  }
  if (rule.includes('s3') && (rule.includes('public') || rule.includes('ssl'))) {
    return base({
      type: 'public-s3',
      title: 'S3 bucket public access detected',
      severity: 'HIGH',
      safeToAutoRemediate: true,
      resourceId,
      resourceType: resourceType || 'AWS::S3::Bucket',
      reason: 'AWS Config NON_COMPLIANT: bucket allows public read/write',
      source: 'aws.config',
      raw,
    });
  }
  if (rule.includes('requiredtags') || rule.includes('required_tags')) {
    return base({
      type: 'missing-tags',
      title: 'Required resource tags missing',
      severity: 'LOW',
      safeToAutoRemediate: true,
      resourceId,
      resourceType,
      reason: 'Resource is missing Project/ManagedBy cost-allocation tags',
      source: 'aws.config',
      raw,
    });
  }
  if (rule.includes('encrypt') || rule.includes('rds_storage') || rule.includes('encrypted')) {
    return base({
      type: 'encryption-violation',
      title: 'Encryption policy violation',
      severity: 'HIGH',
      safeToAutoRemediate: false,
      policy: 'APPROVAL_REQUIRED',
      resourceId,
      resourceType,
      reason: 'Resource is not encrypted with the required configuration',
      source: 'aws.config',
      raw,
    });
  }

  return base({
    type: 'unknown',
    title: `Config rule ${rule || 'unknown'} is NON_COMPLIANT`,
    severity: 'MEDIUM',
    safeToAutoRemediate: false,
    resourceId,
    resourceType,
    reason: 'Unhandled Config rule — recorded for operator review',
    source: 'aws.config',
    raw,
  });
}

function fromGuardDuty(detail: Record<string, unknown>, raw: unknown): Classification {
  const severity = Number(detail.severity || 0);
  const type = String(detail.type || 'GuardDuty Finding');
  const mapped: Severity = severity >= 8 ? 'CRITICAL' : severity >= 7 ? 'HIGH' : severity >= 4 ? 'MEDIUM' : 'LOW';
  return base({
    type: 'guardduty-finding',
    title: type,
    severity: mapped,
    safeToAutoRemediate: mapped === 'CRITICAL',
    policy: mapped === 'LOW' ? 'OBSERVE' : mapped === 'MEDIUM' ? 'APPROVAL_REQUIRED' : DEFAULT_POLICY,
    resourceId: String((detail.resource as { instanceDetails?: { instanceId?: string } } | undefined)?.instanceDetails?.instanceId || ''),
    reason: String(detail.description || 'GuardDuty finding'),
    source: 'aws.guardduty',
    raw,
  });
}

function fromSecurityHub(detail: Record<string, unknown>, raw: unknown): Classification {
  const findings = (detail.findings as Array<Record<string, unknown>>) || [];
  const first = findings[0] || {};
  const label = String((first.Severity as { Label?: string } | undefined)?.Label || 'MEDIUM').toUpperCase();
  const severity = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(label) ? label : 'MEDIUM') as Severity;
  return base({
    type: 'guardduty-finding',
    title: String(first.Title || 'Security Hub finding'),
    severity,
    safeToAutoRemediate: false,
    policy: severity === 'LOW' ? 'OBSERVE' : 'APPROVAL_REQUIRED',
    resourceId: String(((first.Resources as Array<{ Id?: string }>) || [])[0]?.Id || ''),
    reason: String(first.Description || 'Security Hub imported finding'),
    source: 'aws.securityhub',
    raw,
  });
}

function fromCloudWatch(detail: Record<string, unknown>, raw: unknown): Classification {
  const alarmName = String(detail.alarmName || '').toLowerCase();
  if (alarmName.includes('cpu')) {
    return base({
      type: 'cpu-spike',
      title: 'CPU overload',
      severity: 'MEDIUM',
      safeToAutoRemediate: true,
      reason: `CloudWatch alarm ${alarmName} in ALARM`,
      source: 'aws.cloudwatch',
      raw,
    });
  }
  if (alarmName.includes('running-low') || alarmName.includes('ecs')) {
    return base({
      type: 'ecs-failure',
      title: 'ECS task repeatedly failing',
      severity: 'HIGH',
      safeToAutoRemediate: false,
      policy: 'APPROVAL_REQUIRED',
      reason: `CloudWatch alarm ${alarmName} in ALARM`,
      source: 'aws.cloudwatch',
      raw,
    });
  }
  if (alarmName.includes('unhealthy')) {
    return base({
      type: 'unhealthy-target',
      title: 'Unhealthy ALB target',
      severity: 'HIGH',
      safeToAutoRemediate: DEFAULT_POLICY === 'AUTO_REMEDIATE',
      reason: `CloudWatch alarm ${alarmName} in ALARM`,
      source: 'aws.cloudwatch',
      raw,
    });
  }
  if (alarmName.includes('storage') || alarmName.includes('disk')) {
    return base({
      type: 'disk-threshold',
      title: 'RDS free storage below threshold',
      severity: 'HIGH',
      safeToAutoRemediate: false,
      policy: 'APPROVAL_REQUIRED',
      reason: `CloudWatch alarm ${alarmName} in ALARM`,
      source: 'aws.cloudwatch',
      raw,
    });
  }
  return base({
    type: 'unknown',
    title: `Alarm ${alarmName}`,
    severity: 'MEDIUM',
    safeToAutoRemediate: false,
    reason: 'Unhandled CloudWatch alarm',
    source: 'aws.cloudwatch',
    raw,
  });
}

function fromManual(event: Record<string, unknown>): Classification {
  return base({
    type: (event.type as IncidentType) || 'unknown',
    title: String(event.title || event.type || 'Manual incident'),
    severity: (event.severity as Severity) || 'HIGH',
    safeToAutoRemediate: event.safeToAutoRemediate !== false,
    resourceId: event.resourceId as string | undefined,
    resourceType: event.resourceType as string | undefined,
    reason: String(event.reason || 'Injected by Chaos Lab or CLI'),
    source: 'aegis.chaos',
    raw: event,
  });
}

function base(
  partial: Omit<Classification, 'incidentId' | 'policy'> & { policy?: Policy },
): Classification {
  const policy = partial.policy || DEFAULT_POLICY;
  return {
    incidentId: randomUUID(),
    policy,
    ...partial,
  };
}
