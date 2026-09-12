import { Command } from 'commander';
import { run } from './deploy';
import { CliContext } from '../aws';

export function destroyCommand(): Command {
  return new Command('destroy')
    .description('Tear down a disposable environment (dev is the intended target)')
    .argument('[profile]', 'dev | production-demo', 'dev')
    .action(async function (this: Command, profile: string) {
      const ctx = this.optsWithGlobals() as CliContext;
      const env = profile || ctx.env;
      if (env === 'production-demo') {
        console.log('production-demo has deletion protection on RDS. Confirm in the CloudFormation console if destroy hangs.');
      }
      await run('npx', ['cdk', 'destroy', '--all', '-c', `env=${env}`, '--force']);
    });
}
