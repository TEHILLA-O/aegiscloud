import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export interface CliContext {
  env: string;
  region: string;
}

export function stackPrefix(env: string): string {
  return env === 'production-demo' ? 'AegisProd' : 'AegisDev';
}

export async function stackOutputs(ctx: CliContext, suffix: string): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region: ctx.region });
  const name = `${stackPrefix(ctx.env)}-${suffix}`;
  const result = await cfn.send(new DescribeStacksCommand({ StackName: name }));
  const outputs: Record<string, string> = {};
  for (const out of result.Stacks?.[0]?.Outputs || []) {
    if (out.OutputKey && out.OutputValue) outputs[out.OutputKey] = out.OutputValue;
  }
  return outputs;
}

export async function parameter(ctx: CliContext, key: string): Promise<string | undefined> {
  const ssm = new SSMClient({ region: ctx.region });
  try {
    const result = await ssm.send(
      new GetParameterCommand({ Name: `/aegiscloud/${ctx.env}/${key}` }),
    );
    return result.Parameter?.Value;
  } catch {
    return undefined;
  }
}

export async function opsGet(ctx: CliContext, path: string): Promise<unknown> {
  const url = await parameter(ctx, 'operations-api-url');
  if (!url) {
    throw new Error(
      `Operations API URL not found in SSM (/aegiscloud/${ctx.env}/operations-api-url). Deploy the Remediation stack first.`,
    );
  }
  const response = await fetch(`${url}${path}`);
  if (!response.ok) {
    throw new Error(`Operations API ${path} returned ${response.status}`);
  }
  return response.json();
}

export function banner(title: string): void {
  console.log('');
  console.log(title);
  console.log('─'.repeat(Math.max(12, title.length)));
}
