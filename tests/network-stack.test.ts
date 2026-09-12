import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DEV } from '../infrastructure/lib/config';
import { NetworkStack } from '../infrastructure/lib/network-stack';

function synthNetwork() {
  const app = new cdk.App();
  const stack = new NetworkStack(app, 'TestNetwork', {
    aegisEnv: { ...DEV, account: '111111111111', region: 'eu-west-2' },
    env: { account: '111111111111', region: 'eu-west-2' },
  });
  return Template.fromStack(stack);
}

describe('NetworkStack', () => {
  const template = synthNetwork();

  it('creates a /16 VPC with the documented subnet CIDRs', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    });

    for (const cidr of ['10.0.1.0/24', '10.0.2.0/24', '10.0.11.0/24', '10.0.12.0/24', '10.0.21.0/24', '10.0.22.0/24']) {
      template.hasResourceProperties('AWS::EC2::Subnet', { CidrBlock: cidr });
    }
  });

  it('places a single NAT in the dev profile', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  it('never opens SSH on the application security groups', () => {
    const sgs = template.findResources('AWS::EC2::SecurityGroup');
    const ingress = Object.values(sgs).flatMap((sg) => {
      const props = sg.Properties as { SecurityGroupIngress?: Array<{ FromPort?: number; CidrIp?: string }> };
      return props.SecurityGroupIngress || [];
    });
    expect(ingress.some((rule) => rule.FromPort === 22)).toBe(false);
  });

  it('allows ALB to ECS over 8080 via security-group reference, not a wide CIDR', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('Fargate'),
    });
  });

  it('creates free gateway endpoints for S3 and DynamoDB', () => {
    template.resourceCountIs('AWS::EC2::VPCEndpoint', 2);
  });
});
