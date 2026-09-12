import { Command } from 'commander';
import { banner, CliContext, opsGet } from '../aws';

export function securityCommand(): Command {
  return new Command('security').description('Config / GuardDuty / Security Hub posture')    .action(async function (this: Command) {
      const ctx = this.optsWithGlobals() as CliContext;
    const data = await opsGet(ctx, '/security');
    banner('AEGISCLOUD SECURITY');
    console.log(JSON.stringify(data, null, 2));
  });
}
