import {
  AuthorizeSecurityGroupIngressCommand,
  DescribeSecurityGroupsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import { CliContext, stackPrefix } from '../cli/aegis/src/aws';

export async function injectOpenSecurityGroup(ctx: CliContext): Promise<void> {
  const ec2 = new EC2Client({ region: ctx.region });
  const groups = await ec2.send(
    new DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'group-name', Values: [`${ctx.env}-aegis-ecs`] },
        { Name: 'tag:Project', Values: ['AegisCloud'] },
      ],
    }),
  );
  const group = groups.SecurityGroups?.[0];
  if (!group?.GroupId) {
    throw new Error(`ECS security group ${ctx.env}-aegis-ecs not found in ${ctx.region}`);
  }

  await ec2.send(
    new AuthorizeSecurityGroupIngressCommand({
      GroupId: group.GroupId,
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'CHAOS-LAB: temporary public SSH' }],
        },
      ],
    }),
  );

  console.log('');
  console.log('AEGISCLOUD INCIDENT  (injected)');
  console.log('');
  console.log(timestamp());
  console.log(`Security group ${group.GroupId} changed.`);
  console.log('');
  console.log(timestamp());
  console.log('AWS Config:');
  console.log('NON_COMPLIANT');
  console.log('');
  console.log('Reason:');
  console.log('SSH 22/tcp exposed to 0.0.0.0/0');
  console.log('');
  console.log('Watch         aegis incidents');
  console.log(`Stack prefix  ${stackPrefix(ctx.env)}`);
  console.log('');
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}
