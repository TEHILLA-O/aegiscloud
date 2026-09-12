import { Command } from 'commander';
import { banner, CliContext, opsGet } from '../aws';

export function costsCommand(): Command {
  return new Command('costs').description('Month-to-date spend for Project=AegisCloud')    .action(async function (this: Command) {
      const ctx = this.optsWithGlobals() as CliContext;
    const data = (await opsGet(ctx, '/costs')) as { monthToDate?: string; note?: string };
    banner('MONTH-TO-DATE');
    console.log(`Estimated cost    ${data.monthToDate || 'n/a'}`);
    if (data.note) console.log(data.note);
    console.log('');
  });
}
