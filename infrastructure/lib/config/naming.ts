import { EnvironmentName } from './types';

export function stackName(env: EnvironmentName, suffix: string): string {
  const prefix = env === 'production-demo' ? 'AegisProd' : 'AegisDev';
  return `${prefix}-${suffix}`;
}

export function resourceName(env: EnvironmentName, suffix: string): string {
  const prefix = env === 'production-demo' ? 'aegis-prod' : 'aegis-dev';
  return `${prefix}-${suffix}`;
}
