import { Command } from 'commander';
import { injectCpuSpike } from '../../../../chaos/cpu-spike';
import { injectEcsFailure } from '../../../../chaos/ecs-failure';
import { injectOpenSecurityGroup } from '../../../../chaos/open-security-group';
import { injectPublicS3 } from '../../../../chaos/public-s3';
import { CliContext } from '../aws';

export function chaosCommand(): Command {
  const chaos = new Command('chaos').description('Controlled Chaos Lab — break AWS, then watch AegisCloud react');

  const inject = chaos.command('inject').description('Inject a known failure class');

  inject.command('public-s3').description('Disable S3 Block Public Access on the chaos-lab bucket').action(async function (this: Command) {
    const ctx = this.optsWithGlobals() as CliContext;
    await injectPublicS3(ctx);
  });

  inject
    .command('open-security-group')
    .description('Add SSH 22/tcp from 0.0.0.0/0 to the ECS security group')
    .action(async function (this: Command) {
      const ctx = this.optsWithGlobals() as CliContext;
      await injectOpenSecurityGroup(ctx);
    });

  inject.command('ecs-failure').description('Stop running tasks so the service drops below desired count').action(async function (this: Command) {
    const ctx = this.optsWithGlobals() as CliContext;
    await injectEcsFailure(ctx);
  });

  inject.command('cpu-spike').description('Burn CPU on the order service via /chaos/cpu').action(async function (this: Command) {
    const ctx = this.optsWithGlobals() as CliContext;
    await injectCpuSpike(ctx);
  });

  return chaos;
}
