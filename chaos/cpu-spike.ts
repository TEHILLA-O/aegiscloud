import { CliContext, stackOutputs } from '../cli/aegis/src/aws';

export async function injectCpuSpike(ctx: CliContext): Promise<void> {
  const compute = await stackOutputs(ctx, 'Compute');
  const dns = compute.AlbDns;
  if (!dns) throw new Error('AlbDns output missing. Deploy the Compute stack first.');

  const url = `http://${dns}/chaos/cpu`;
  console.log(`Burning CPU via ${url} …`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ms: 20000 }),
  });
  const body = await response.text();
  console.log('');
  console.log('CHAOS INJECTED  cpu-spike');
  console.log(`HTTP           ${response.status}`);
  console.log(`Body           ${body}`);
  console.log('Expected       CPU alarm → ECS scale-out remediator');
  console.log('');
}
