import { ECSClient, ListTasksCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
import { CliContext, stackOutputs } from '../cli/aegis/src/aws';

export async function injectEcsFailure(ctx: CliContext): Promise<void> {
  const compute = await stackOutputs(ctx, 'Compute');
  const cluster = compute.ClusterName;
  const service = compute.OrderServiceName;
  if (!cluster || !service) throw new Error('Compute stack outputs missing ClusterName/OrderService');

  const ecs = new ECSClient({ region: ctx.region });
  const tasks = await ecs.send(new ListTasksCommand({ cluster, serviceName: service }));
  const arns = tasks.taskArns || [];
  if (arns.length === 0) {
    throw new Error(`No running tasks on ${service}. Scale the service up first.`);
  }

  await ecs.send(
    new StopTaskCommand({
      cluster,
      task: arns[0],
      reason: 'AegisCloud Chaos Lab: ecs-failure',
    }),
  );

  console.log('');
  console.log('CHAOS INJECTED  ecs-failure');
  console.log(`Cluster        ${cluster}`);
  console.log(`Service        ${service}`);
  console.log(`Stopped        ${arns[0].split('/').pop()}`);
  console.log('Expected       RunningTaskCount alarm → diagnostics + operator notification');
  console.log('');
}
