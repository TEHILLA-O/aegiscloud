#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { applyStandardTags } from '../lib/aspects/tagging';
import { resolveEnvironment } from '../lib/config';
import { stackName } from '../lib/config/naming';
import { ComputeStack } from '../lib/compute-stack';
import { CostStack } from '../lib/cost-stack';
import { DataStack } from '../lib/data-stack';
import { NetworkStack } from '../lib/network-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { RemediationStack } from '../lib/remediation-stack';
import { SecurityStack } from '../lib/security-stack';

const app = new cdk.App();
const aegisEnv = resolveEnvironment(app.node.tryGetContext('env'));

const env = {
  account: aegisEnv.account || process.env.CDK_DEFAULT_ACCOUNT,
  region: aegisEnv.region,
};

const network = new NetworkStack(app, stackName(aegisEnv.name, 'Network'), { aegisEnv, env });
const data = new DataStack(app, stackName(aegisEnv.name, 'Data'), { aegisEnv, network, env });
const compute = new ComputeStack(app, stackName(aegisEnv.name, 'Compute'), {
  aegisEnv,
  network,
  data,
  env,
});
const security = new SecurityStack(app, stackName(aegisEnv.name, 'Security'), {
  aegisEnv,
  data,
  compute,
  env,
});
const observability = new ObservabilityStack(app, stackName(aegisEnv.name, 'Observability'), {
  aegisEnv,
  compute,
  data,
  env,
});
const remediation = new RemediationStack(app, stackName(aegisEnv.name, 'Remediation'), {
  aegisEnv,
  network,
  data,
  compute,
  observability,
  env,
});
new CostStack(app, stackName(aegisEnv.name, 'Cost'), { aegisEnv, compute, env });

applyStandardTags(app, aegisEnv);

app.synth();
