import { spawn } from 'child_process';
import { Command } from 'commander';
import { CliContext } from '../aws';

export function deployCommand(): Command {
  return new Command('deploy')
    .description('cdk deploy --all for the selected profile')
    .action(async function (this: Command) {
      const ctx = this.optsWithGlobals() as CliContext;
      await run('npx', ['cdk', 'deploy', '--all', '-c', `env=${ctx.env}`]);
    });
}

export function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}
