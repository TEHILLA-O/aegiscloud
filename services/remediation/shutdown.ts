import { DescribeServicesCommand, ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';

const ecs = new ECSClient({});
const CLUSTER = process.env.CLUSTER_NAME!;
const SERVICES = (process.env.ECS_SERVICES || '').split(',').filter(Boolean);

export const handler = async (event: { action?: 'stop' | 'start' }) => {
  const action = event.action || 'stop';
  const results = [];
  for (const service of SERVICES) {
    const described = await ecs.send(new DescribeServicesCommand({ cluster: CLUSTER, services: [service] }));
    const current = described.services?.[0]?.desiredCount ?? 0;
    const desired = action === 'stop' ? 0 : Math.max(current, 1);
    await ecs.send(new UpdateServiceCommand({ cluster: CLUSTER, service, desiredCount: desired }));
    results.push({ service, action, desired });
  }
  return { ok: true, results };
};
