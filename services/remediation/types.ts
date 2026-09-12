export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Policy = 'OBSERVE' | 'APPROVAL_REQUIRED' | 'AUTO_REMEDIATE';
export type IncidentType =
  | 'public-s3'
  | 'open-security-group'
  | 'ecs-failure'
  | 'cpu-spike'
  | 'disk-threshold'
  | 'unhealthy-target'
  | 'missing-tags'
  | 'encryption-violation'
  | 'guardduty-finding'
  | 'patch-noncompliant'
  | 'unknown';

export interface Classification {
  incidentId: string;
  type: IncidentType;
  title: string;
  severity: Severity;
  policy: Policy;
  safeToAutoRemediate: boolean;
  resourceId?: string;
  resourceType?: string;
  reason: string;
  source: string;
  raw: unknown;
}

export interface RemediationResult {
  attempted: boolean;
  action: string;
  details: Record<string, unknown>;
}

export interface ValidationResult {
  fixed: boolean;
  evidence: Record<string, unknown>;
}
