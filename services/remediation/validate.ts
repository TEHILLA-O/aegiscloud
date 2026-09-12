import { DescribeSecurityGroupsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DescribeServicesCommand, ECSClient } from '@aws-sdk/client-ecs';
import { GetPublicAccessBlockCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Classification, ValidationResult } from './types';

const ec2 = new EC2Client({});
const s3 = new S3Client({});
const ecs = new ECSClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.INCIDENTS_TABLE!;
const CLUSTER = process.env.CLUSTER_NAME!;
const SERVICES = (process.env.ECS_SERVICES || '').split(',').filter(Boolean);

interface WorkflowInput {
  classification?: Classification;
  [key: string]: unknown;
}

export const handler = async (event: WorkflowInput): Promise<ValidationResult> => {
  const c = event.classification || (event as unknown as Classification);
  let result: ValidationResult;

  switch (c.type) {
    case 'open-security-group':
      result = await sshClosed(c.resourceId);
      break;
    case 'public-s3':
      result = await bucketPrivate(c.resourceId || process.env.CHAOS_BUCKET);
      break;
    case 'cpu-spike':
    case 'unhealthy-target':
    case 'ecs-failure':
      result = await ecsStable();
      break;
    default:
      result = { fixed: true, evidence: { skipped: true, type: c.type } };
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { incidentId: c.incidentId },
      UpdateExpression: 'SET #s = :s, validation = :v, updatedAt = :u',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': result.fixed ? 'AUTO-REMEDIATED' : 'ESCALATED',
        ':v': result,
        ':u': new Date().toISOString(),
      },
    }),
  );

  return result;
};

async function sshClosed(groupId?: string): Promise<ValidationResult> {
  if (!groupId) return { fixed: false, evidence: { error: 'missing group id' } };
  const described = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [groupId] }));
  const open = (described.SecurityGroups?.[0]?.IpPermissions || []).some(
    (p) =>
      p.FromPort === 22 &&
      p.ToPort === 22 &&
      (p.IpRanges || []).some((r) => r.CidrIp === '0.0.0.0/0'),
  );
  return { fixed: !open, evidence: { groupId, publicSsh: open } };
}

async function bucketPrivate(bucket?: string): Promise<ValidationResult> {
  if (!bucket) return { fixed: false, evidence: { error: 'missing bucket' } };
  const block = await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
  const cfg = block.PublicAccessBlockConfiguration;
  const locked = !!(cfg?.BlockPublicAcls && cfg.IgnorePublicAcls && cfg.BlockPublicPolicy && cfg.RestrictPublicBuckets);
  return { fixed: locked, evidence: { bucket, configuration: cfg } };
}

async function ecsStable(): Promise<ValidationResult> {
  const described = await ecs.send(new DescribeServicesCommand({ cluster: CLUSTER, services: SERVICES }));
  const services = (described.services || []).map((s) => ({
    name: s.serviceName,
    running: s.runningCount,
    desired: s.desiredCount,
    deployments: s.deployments?.length,
  }));
  const fixed = services.every((s) => (s.running || 0) >= 1);
  return { fixed, evidence: { services } };
}
