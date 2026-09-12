import { PRODUCTION_DEMO, resolveEnvironment } from '../infrastructure/lib/config';

describe('environment profiles', () => {
  it('defaults to the disposable dev lab', () => {
    const env = resolveEnvironment();
    expect(env.name).toBe('dev');
    expect(env.vpc.natGateways).toBe(1);
    expect(env.data.multiAz).toBe(false);
    expect(env.cost.autoShutdown).toBe(true);
    expect(env.remediation.defaultPolicy).toBe('AUTO_REMEDIATE');
  });

  it('keeps production-demo on approval-required and dual NAT', () => {
    expect(PRODUCTION_DEMO.vpc.natGateways).toBe(2);
    expect(PRODUCTION_DEMO.data.multiAz).toBe(true);
    expect(PRODUCTION_DEMO.remediation.defaultPolicy).toBe('APPROVAL_REQUIRED');
    expect(PRODUCTION_DEMO.security.enableGuardDuty).toBe(true);
  });
});
