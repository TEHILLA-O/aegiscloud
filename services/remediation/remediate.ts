import {
  CreateTagsCommand,
  DescribeSecurityGroupsCommand,
  EC2Client,
  RevokeSecurityGroupIngressCommand,
} from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DescribeServicesCommand, ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import {
  GetPublicAccessBlockCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Classification, RemediationResult } from './types';

const ec2 = new EC2Client({});
const s3 = new S3Client({});
const ecs = new ECSClient({});
const sns = new SNSClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE = process.env.INCIDENTS_TABLE!;
const CLUSTER = process.env.CLUSTER_NAME!;
const SERVICES = (process.env.ECS_SERVICES || '').split(',').filter(Boolean);
const TOPIC = process.env.ALARM_TOPIC_ARN!;

interface WorkflowInput {
  classification?: Classification;
  [key: string]: unknown;
}

export const handler = async (event: WorkflowInput): Promise<RemediationResult> => {
  const c = event.classification || (event as unknown as Classification);
  let result: RemediationResult;

  switch (c.type) {
    case 'open-security-group':
      result = await revokeOpenSsh(c.resourceId);
      break;
    case 'public-s3':
      result = await closePublicBucket(c.resourceId);
      break;
    case 'cpu-spike':
      result = await scaleOut();
      break;
    case 'unhealthy-target':
      result = await forceRedeploy();
      break;
    case 'missing-tags':
      result = await applyDefaultTags(c.resourceId);
      break;
    case 'guardduty-finding':
      result = await quarantineNotice(c);
      break;
    default:
      result = {
        attempted: false,
        action: 'none',
        details: { reason: `No automatic remediator registered for ${c.type}` },
      };
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { incidentId: c.incidentId },
      UpdateExpression: 'SET #s = :s, remediation = :r, updatedAt = :u',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'REMEDIATING',
        ':r': result,
        ':u': new Date().toISOString(),
      },
    }),
  );

  return result;
};

async function revokeOpenSsh(groupId?: string): Promise<RemediationResult> {
  if (!groupId) {
    return { attempted: false, action: 'revoke-ssh', details: { error: 'missing security group id' } };
  }
  const described = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [groupId] }));
  const group = described.SecurityGroups?.[0];
  const ssh = (group?.IpPermissions || []).filter(
    (p) => p.FromPort === 22 && p.ToPort === 22 && p.IpProtocol === 'tcp',
  );
  let revoked = 0;
  for (const perm of ssh) {
    const publicRanges = (perm.IpRanges || []).filter((r) => r.CidrIp === '0.0.0.0/0');
    if (publicRanges.length === 0) continue;
    await ec2.send(
      new RevokeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: publicRanges,
          },
        ],
      }),
    );
    revoked += publicRanges.length;
  }
  return {
    attempted: true,
    action: 'revoke-ssh-0.0.0.0/0',
    details: { groupId, revoked },
  };
}

async function closePublicBucket(bucket?: string): Promise<RemediationResult> {
  const name = bucket || process.env.CHAOS_BUCKET;
  if (!name) {
    return { attempted: false, action: 'block-public-s3', details: { error: 'missing bucket' } };
  }
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: name,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  const check = await s3.send(new GetPublicAccessBlockCommand({ Bucket: name }));
  return {
    attempted: true,
    action: 'restore-s3-block-public-access',
    details: { bucket: name, configuration: check.PublicAccessBlockConfiguration },
  };
}

async function scaleOut(): Promise<RemediationResult> {
  const updates = [];
  for (const service of SERVICES) {
    const current = await ecs.send(new DescribeServicesCommand({ cluster: CLUSTER, services: [service] }));
    const desired = current.services?.[0]?.desiredCount ?? 1;
    const next = Math.min(desired + 1, 8);
    await ecs.send(
      new UpdateServiceCommand({
        cluster: CLUSTER,
        service,
        desiredCount: next,
      }),
    );
    updates.push({ service, from: desired, to: next });
  }
  return { attempted: true, action: 'ecs-scale-out', details: { updates } };
}

async function forceRedeploy(): Promise<RemediationResult> {
  const updates = [];
  for (const service of SERVICES) {
    await ecs.send(
      new UpdateServiceCommand({
        cluster: CLUSTER,
        service,
        forceNewDeployment: true,
      }),
    );
    updates.push(service);
  }
  return { attempted: true, action: 'ecs-force-redeploy', details: { services: updates } };
}

async function applyDefaultTags(resourceId?: string): Promise<RemediationResult> {
  if (!resourceId || !resourceId.startsWith('sg-') && !resourceId.startsWith('i-') && !resourceId.startsWith('vpc-')) {
    return {
      attempted: false,
      action: 'apply-default-tags',
      details: { reason: 'Tag repair currently supports EC2-addressable ids', resourceId },
    };
  }
  await ec2.send(
    new CreateTagsCommand({
      Resources: [resourceId],
      Tags: [
        { Key: 'Project', Value: 'AegisCloud' },
        { Key: 'Owner', Value: 'Portfolio' },
        { Key: 'ManagedBy', Value: 'CDK' },
        { Key: 'Environment', Value: process.env.ENVIRONMENT === 'production-demo' ? 'ProductionDemo' : 'Dev' },
      ],
    }),
  );
  return { attempted: true, action: 'apply-default-tags', details: { resourceId } };
}

async function quarantineNotice(c: Classification): Promise<RemediationResult> {
  await sns.send(
    new PublishCommand({
      TopicArn: TOPIC,
      Subject: `AegisCloud CRITICAL — quarantine workflow ${c.incidentId}`,
      Message: JSON.stringify(
        {
          incidentId: c.incidentId,
          title: c.title,
          action: 'Network isolation recommended. Automatic ENI quarantine is gated on APPROVAL for non-demo estates.',
        },
        null,
        2,
      ),
    }),
  );
  return {
    attempted: true,
    action: 'guardduty-quarantine-notify',
    details: { incidentId: c.incidentId, note: 'Destructive isolation is not implicit' },
  };
}
