import { Command } from 'commander';
import { banner, CliContext, opsGet } from '../aws';

export function incidentsCommand(): Command {
  return new Command('incidents')
    .description('Recent incidents recorded by the orchestrator')
    .action(async function (this: Command) {
      const ctx = this.optsWithGlobals() as CliContext;
      const data = (await opsGet(ctx, '/incidents')) as {
        items: Array<{
          createdAt: string;
          title: string;
          severity: string;
          status: string;
          type: string;
          incidentId: string;
        }>;
      };
      banner('AEGISCLOUD INCIDENTS');
      if (!data.items?.length) {
        console.log('No incidents recorded.');
        return;
      }
      for (const item of data.items) {
        console.log('');
        console.log(item.createdAt);
        console.log(`${item.severity.padEnd(10)} ${item.status}`);
        console.log(item.title);
        console.log(`id ${item.incidentId}  type ${item.type}`);
      }
      console.log('');
    });
}
