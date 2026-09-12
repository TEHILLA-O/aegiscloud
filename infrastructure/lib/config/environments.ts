import { AegisEnvironment } from './types';

/**
 * Disposable lab profile. Single NAT, single-AZ data, no always-on edge,
 * automatic weekday shutdown. Safe default for interviews and local synth.
 */
export const DEV: AegisEnvironment = {
  name: 'dev',
  region: process.env.CDK_DEFAULT_REGION || 'eu-west-2',
  account: process.env.CDK_DEFAULT_ACCOUNT,
  currency: 'GBP',
  vpc: {
    cidr: '10.0.0.0/16',
    maxAzs: 2,
    natGateways: 1,
    enableFlowLogs: true,
    enableInterfaceEndpoints: false,
  },
  compute: {
    desiredCount: 1,
    cpu: 256,
    memoryMiB: 512,
    minCapacity: 1,
    maxCapacity: 4,
    cpuTargetPercent: 60,
  },
  data: {
    rdsInstanceType: 't4g.micro',
    redisNodeType: 'cache.t4g.micro',
    multiAz: false,
    deletionProtection: false,
    backupRetentionDays: 7,
    allocatedStorageGiB: 20,
  },
  security: {
    enableGuardDuty: false,
    enableSecurityHub: false,
    enableWaf: false,
    enableCloudFront: false,
    enableConfig: true,
  },
  edge: {},
  cost: {
    monthlyBudget: 25,
    autoShutdown: true,
    shutdownHourUtc: 20,
    startupHourUtc: 8,
  },
  remediation: {
    defaultPolicy: 'AUTO_REMEDIATE',
    notifyEmail: process.env.AEGIS_NOTIFY_EMAIL,
  },
};

/**
 * Interview / walkthrough profile. Dual NAT, Multi-AZ data, WAF, GuardDuty
 * and Security Hub. Still not a commercial production estate — no active-active
 * DR — but it is the shape you would defend in a design review.
 */
export const PRODUCTION_DEMO: AegisEnvironment = {
  name: 'production-demo',
  region: process.env.CDK_DEFAULT_REGION || 'eu-west-2',
  account: process.env.CDK_DEFAULT_ACCOUNT,
  currency: 'GBP',
  vpc: {
    cidr: '10.0.0.0/16',
    maxAzs: 2,
    natGateways: 2,
    enableFlowLogs: true,
    enableInterfaceEndpoints: true,
  },
  compute: {
    desiredCount: 2,
    cpu: 512,
    memoryMiB: 1024,
    minCapacity: 2,
    maxCapacity: 8,
    cpuTargetPercent: 55,
  },
  data: {
    rdsInstanceType: 't4g.small',
    redisNodeType: 'cache.t4g.small',
    multiAz: true,
    deletionProtection: true,
    backupRetentionDays: 14,
    allocatedStorageGiB: 50,
  },
  security: {
    enableGuardDuty: true,
    enableSecurityHub: true,
    enableWaf: true,
    enableCloudFront: true,
    enableConfig: true,
  },
  edge: {
    hostedZoneName: process.env.AEGIS_HOSTED_ZONE,
    domainName: process.env.AEGIS_DOMAIN,
  },
  cost: {
    monthlyBudget: 80,
    autoShutdown: false,
    shutdownHourUtc: 20,
    startupHourUtc: 8,
  },
  remediation: {
    defaultPolicy: 'APPROVAL_REQUIRED',
    notifyEmail: process.env.AEGIS_NOTIFY_EMAIL,
  },
};

export function resolveEnvironment(name?: string): AegisEnvironment {
  switch (name) {
    case 'production-demo':
    case 'prod':
    case 'production':
      return PRODUCTION_DEMO;
    case 'dev':
    case 'development':
    default:
      return DEV;
  }
}
