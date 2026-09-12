import { classify } from '../services/remediation/classify';

describe('incident classifier', () => {
  it('maps restricted-SSH Config events to auto-remediable high severity', () => {
    const result = classify({
      source: 'aws.config',
      detail: {
        configRuleName: 'aegis-dev-RestrictedSsh',
        resourceId: 'sg-091823',
        resourceType: 'AWS::EC2::SecurityGroup',
        newEvaluationResult: { complianceType: 'NON_COMPLIANT' },
      },
    });

    expect(result.type).toBe('open-security-group');
    expect(result.severity).toBe('HIGH');
    expect(result.safeToAutoRemediate).toBe(true);
    expect(result.resourceId).toBe('sg-091823');
    expect(result.title).toMatch(/SSH/);
  });

  it('maps public S3 Config events to the bucket remediator', () => {
    const result = classify({
      source: 'aws.config',
      detail: {
        configRuleName: 'aegis-dev-S3PublicReadProhibited',
        resourceId: 'aegis-chaos-lab',
        resourceType: 'AWS::S3::Bucket',
      },
    });

    expect(result.type).toBe('public-s3');
    expect(result.safeToAutoRemediate).toBe(true);
  });

  it('does not auto-remediate encryption violations', () => {
    const result = classify({
      source: 'aws.config',
      detail: {
        configRuleName: 'aegis-dev-RdsEncrypted',
        resourceId: 'db-1',
      },
    });

    expect(result.type).toBe('encryption-violation');
    expect(result.safeToAutoRemediate).toBe(false);
    expect(result.policy).toBe('APPROVAL_REQUIRED');
  });

  it('classifies GuardDuty by numeric severity', () => {
    const critical = classify({
      source: 'aws.guardduty',
      detail: { severity: 8.4, type: 'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.InsideAWS' },
    });
    expect(critical.severity).toBe('CRITICAL');
    expect(critical.safeToAutoRemediate).toBe(true);

    const low = classify({
      source: 'aws.guardduty',
      detail: { severity: 2, type: 'Recon:EC2/PortProbeUnprotectedPort' },
    });
    expect(low.severity).toBe('LOW');
    expect(low.policy).toBe('OBSERVE');
  });

  it('routes CPU alarms to scale-out', () => {
    const result = classify({
      source: 'aws.cloudwatch',
      detail: { alarmName: 'dev-ecs-order-cpu', state: { value: 'ALARM' } },
    });
    expect(result.type).toBe('cpu-spike');
    expect(result.safeToAutoRemediate).toBe(true);
  });

  it('keeps ECS failure on the approval path by default', () => {
    const result = classify({
      source: 'aws.cloudwatch',
      detail: { alarmName: 'dev-ecs-order-running-low' },
    });
    expect(result.type).toBe('ecs-failure');
    expect(result.safeToAutoRemediate).toBe(false);
  });
});
