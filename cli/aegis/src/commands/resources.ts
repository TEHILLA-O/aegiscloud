import { Command } from 'commander';
import { banner, CliContext, opsGet } from '../aws';

export function resourcesCommand(): Command {
  return new Command('resources').description('Inventory of live AegisCloud resources')    .action(async function (this: Command) {
      const ctx = this.optsWithGlobals() as CliContext;
    const data = await opsGet(ctx, '/resources');
    banner('AEGISCLOUD RESOURCES');
    console.log(JSON.stringify(data, null, 2));
  });
}
