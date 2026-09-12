import { Command } from 'commander';
import { banner, CliContext, opsGet } from '../aws';

export function statusCommand(): Command {
  return new Command('status').description('Environment health summary')    .action(async function (this: Command) {
      const ctx = this.optsWithGlobals() as CliContext;
    const data = (await opsGet(ctx, '/status')) as Record<string, unknown>;
    banner('AEGISCLOUD');
    printRow('Environment', data.environment);
    printRow('Region', data.region);
    printRow('Status', data.status);
    console.log('');
    console.log('NETWORK');
    printMap(data.network as Record<string, string>);
    console.log('\nCOMPUTE');
    printMap(data.compute as Record<string, string>);
    console.log('\nDATABASE');
    printMap(data.database as Record<string, string>);
    console.log('\nSECURITY');
    printMap(data.security as Record<string, string>);
    console.log('\nOPERATIONS');
    printMap(data.operations as Record<string, string>);
    console.log('');
  });
}

function printMap(value?: Record<string, unknown>) {
  if (!value) return;
  for (const [k, v] of Object.entries(value)) {
    printRow(pretty(k), v);
  }
}

function printRow(label: string, value: unknown) {
  console.log(`${label.padEnd(18)} ${value ?? '—'}`);
}

function pretty(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
