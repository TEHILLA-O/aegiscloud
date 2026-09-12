#!/usr/bin/env node
import { Command } from 'commander';
import { chaosCommand } from './commands/chaos';
import { costsCommand } from './commands/costs';
import { destroyCommand } from './commands/destroy';
import { deployCommand } from './commands/deploy';
import { drCommand } from './commands/dr';
import { incidentsCommand } from './commands/incidents';
import { resourcesCommand } from './commands/resources';
import { securityCommand } from './commands/security';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('aegis')
  .description('AegisCloud — inspect, break, and heal an AWS estate from the command line')
  .version('1.0.0')
  .option('-e, --env <name>', 'dev | production-demo', process.env.AEGIS_ENV || 'dev')
  .option('-r, --region <region>', 'AWS region', process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'eu-west-2');

program.addCommand(statusCommand());
program.addCommand(resourcesCommand());
program.addCommand(incidentsCommand());
program.addCommand(securityCommand());
program.addCommand(costsCommand());
program.addCommand(deployCommand());
program.addCommand(destroyCommand());
program.addCommand(chaosCommand());
program.addCommand(drCommand());

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`aegis: ${message}`);
  process.exitCode = 1;
});
