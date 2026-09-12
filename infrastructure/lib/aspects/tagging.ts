import { Tags } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { AegisEnvironment, STANDARD_TAGS } from '../config';

/**
 * Apply mandatory cost-allocation tags to the app (or any subtree).
 * Prefer Tags.of(app) over an IAspect — tagging Aspects easily recurse.
 */
export function applyStandardTags(scope: IConstruct, environment: AegisEnvironment): void {
  const envLabel = environment.name === 'production-demo' ? 'ProductionDemo' : 'Dev';
  Tags.of(scope).add('Project', STANDARD_TAGS.Project);
  Tags.of(scope).add('Environment', envLabel);
  Tags.of(scope).add('Owner', STANDARD_TAGS.Owner);
  Tags.of(scope).add('ManagedBy', STANDARD_TAGS.ManagedBy);
  Tags.of(scope).add('CostCenter', 'Portfolio-AegisCloud');
}
