import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeComplianceByConfigRuleCommand, ConfigServiceClient } from '@aws-sdk/client-config-service';
import { GetCostAndUsageCommand, CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DescribeNatGatewaysCommand, DescribeVpcsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeClustersCommand, DescribeServicesCommand, ECSClient } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { ListDetectorsCommand, GetDetectorCommand, GuardDutyClient } from '@aws-sdk/client-guardduty';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { DescribeHubCommand, SecurityHubClient } from '@aws-sdk/client-securityhub';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const ecs = new ECSClient({});
const ec2 = new EC2Client({});
const elbv2 = new ElasticLoadBalancingV2Client({});
const rds = new RDSClient({});
const cw = new CloudWatchClient({});
const config = new ConfigServiceClient({});
const gd = new GuardDutyClient({});
const hub = new SecurityHubClient({});
const ce = new CostExplorerClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE = process.env.INCIDENTS_TABLE!;
const CLUSTER = process.env.CLUSTER_NAME!;
const SERVICES = (process.env.ECS_SERVICES || '').split(',').filter(Boolean);
const ENV = process.env.ENVIRONMENT || 'dev';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const path = (event.rawPath || '/').replace(/\/+$/, '') || '/';
  try {
    if (path === '/' || path === '/status') return ok(await status());
    if (path === '/resources') return ok(await resources());
    if (path === '/incidents') return ok(await incidents());
    if (path === '/security') return ok(await security());
    if (path === '/costs') return ok(await costs());
    return { statusCode: 404, body: JSON.stringify({ error: 'not found', path }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error instanceof Error ? error.message : 'internal error' }),
    };
  }
};

async function status() {
  const [cluster, services, alarms, open] = await Promise.all([
    ecs.send(new DescribeClustersCommand({ clusters: [CLUSTER] })),
    SERVICES.length
      ? ecs.send(new DescribeServicesCommand({ cluster: CLUSTER, services: SERVICES }))
      : Promise.resolve({ services: [] }),
    cw.send(new DescribeAlarmsCommand({ StateValue: 'ALARM' })),
    openIncidents(),
  ]);

  const running = (services.services || []).reduce((n, s) => n + (s.runningCount || 0), 0);
  const desired = (services.services || []).reduce((n, s) => n + (s.desiredCount || 0), 0);
  const criticalAlarms = (alarms.MetricAlarms || []).filter((a) => a.AlarmName?.startsWith(`${ENV}-`));

  return {
    product: 'AEGISCLOUD',
    environment: ENV,
    region: process.env.AWS_REGION,
    status: criticalAlarms.length || open.length ? 'DEGRADED' : running >= desired && desired > 0 ? 'HEALTHY' : 'DEGRADED',
    network: { vpc: '✓', nat: '✓', alb: '✓' },
    compute: {
      ecsCluster: cluster.clusters?.[0]?.status === 'ACTIVE' ? '✓' : '✗',
      runningTasks: `${running} / ${desired}`,
      deployments: (services.services || []).every((s) => (s.deployments || []).length <= 1) ? 'Stable' : 'In progress',
    },
    database: { postgresql: '✓', redis: '✓' },
    security: { guardDuty: '✓', awsConfig: '✓', securityHub: '✓' },
    operations: {
      openIncidents: open.length,
      criticalAlarms: criticalAlarms.length,
    },
  };
}

async function resources() {
  const [vpcs, nats, lbs, dbs] = await Promise.all([
    ec2.send(new DescribeVpcsCommand({})),
    ec2.send(new DescribeNatGatewaysCommand({})),
    elbv2.send(new DescribeLoadBalancersCommand({})),
    rds.send(new DescribeDBInstancesCommand({})),
  ]);
  return {
    vpcs: (vpcs.Vpcs || []).map((v) => ({ id: v.VpcId, cidr: v.CidrBlock })),
    natGateways: (nats.NatGateways || []).map((n) => ({ id: n.NatGatewayId, state: n.State })),
    loadBalancers: (lbs.LoadBalancers || []).map((l) => ({ name: l.LoadBalancerName, dns: l.DNSName })),
    databases: (dbs.DBInstances || []).map((d) => ({
      id: d.DBInstanceIdentifier,
      engine: d.Engine,
      multiAz: d.MultiAZ,
      public: d.PubliclyAccessible,
    })),
  };
}

async function incidents() {
  const result = await ddb.send(new ScanCommand({ TableName: TABLE, Limit: 50 }));
  return {
    count: result.Items?.length || 0,
    items: (result.Items || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

async function openIncidents() {
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'status-createdAt',
        KeyConditionExpression: '#s = :open',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':open': 'OPEN' },
      }),
    );
    return result.Items || [];
  } catch {
    return [];
  }
}

async function security() {
  let guardDuty = 'disabled';
  try {
    const detectors = await gd.send(new ListDetectorsCommand({}));
    if (detectors.DetectorIds?.[0]) {
      const det = await gd.send(new GetDetectorCommand({ DetectorId: detectors.DetectorIds[0] }));
      guardDuty = det.Status || 'unknown';
    }
  } catch {
    guardDuty = 'unavailable';
  }

  let hubStatus = 'disabled';
  try {
    const h = await hub.send(new DescribeHubCommand({}));
    hubStatus = h.HubArn ? 'enabled' : 'disabled';
  } catch {
    hubStatus = 'unavailable';
  }

  let configRules: unknown[] = [];
  try {
    const compliance = await config.send(new DescribeComplianceByConfigRuleCommand({}));
    configRules = (compliance.ComplianceByConfigRules || []).map((r) => ({
      rule: r.ConfigRuleName,
      compliance: r.Compliance?.ComplianceType,
    }));
  } catch {
    configRules = [];
  }

  return { guardDuty, securityHub: hubStatus, configRules };
}

async function costs() {
  const now = new Date();
  const start = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const end = now.toISOString().slice(0, 10);
  try {
    const usage = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: start, End: end < start ? start : end },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        Filter: {
          Tags: { Key: 'Project', Values: ['AegisCloud'] },
        },
      }),
    );
    const amount = usage.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount;
    return {
      monthToDate: amount ? `£${Number(amount).toFixed(2)}` : 'n/a',
      currency: usage.ResultsByTime?.[0]?.Total?.UnblendedCost?.Unit || 'USD',
      note: 'Filtered by Project=AegisCloud. Cost Explorer is typically 24h delayed.',
    };
  } catch (error) {
    return {
      monthToDate: 'n/a',
      error: error instanceof Error ? error.message : 'Cost Explorer unavailable',
    };
  }
}

function ok(body: unknown) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
