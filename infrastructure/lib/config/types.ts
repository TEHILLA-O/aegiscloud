export type EnvironmentName = 'dev' | 'production-demo';

export type RemediationPolicy = 'OBSERVE' | 'APPROVAL_REQUIRED' | 'AUTO_REMEDIATE';

export interface AegisEnvironment {
  readonly name: EnvironmentName;
  readonly account?: string;
  readonly region: string;
  readonly currency: 'GBP' | 'USD';
  readonly vpc: {
    readonly cidr: string;
    readonly maxAzs: 2;
    readonly natGateways: number;
    readonly enableFlowLogs: boolean;
    readonly enableInterfaceEndpoints: boolean;
  };
  readonly compute: {
    readonly desiredCount: number;
    readonly cpu: number;
    readonly memoryMiB: number;
    readonly minCapacity: number;
    readonly maxCapacity: number;
    readonly cpuTargetPercent: number;
  };
  readonly data: {
    readonly rdsInstanceType: string;
    readonly redisNodeType: string;
    readonly multiAz: boolean;
    readonly deletionProtection: boolean;
    readonly backupRetentionDays: number;
    readonly allocatedStorageGiB: number;
  };
  readonly security: {
    readonly enableGuardDuty: boolean;
    readonly enableSecurityHub: boolean;
    readonly enableWaf: boolean;
    readonly enableCloudFront: boolean;
    readonly enableConfig: boolean;
  };
  readonly edge: {
    readonly hostedZoneName?: string;
    readonly domainName?: string;
  };
  readonly cost: {
    readonly monthlyBudget: number;
    readonly autoShutdown: boolean;
    readonly shutdownHourUtc: number;
    readonly startupHourUtc: number;
  };
  readonly remediation: {
    readonly defaultPolicy: RemediationPolicy;
    readonly notifyEmail?: string;
  };
}

export const STANDARD_TAGS = {
  Project: 'AegisCloud',
  Owner: 'Portfolio',
  ManagedBy: 'CDK',
} as const;
