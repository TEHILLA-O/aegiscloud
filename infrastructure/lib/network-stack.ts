import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { AegisEnvironment } from './config';

export interface NetworkStackProps extends cdk.StackProps {
  readonly aegisEnv: AegisEnvironment;
}

/**
 * Two-AZ VPC with an explicit CIDR plan:
 *
 *   10.0.0.0/16
 *     Public        10.0.1.0/24  10.0.2.0/24     ALB / NAT / endpoints of last resort
 *     Private App   10.0.11.0/24 10.0.12.0/24    ECS Fargate
 *     Isolated Data 10.0.21.0/24 10.0.22.0/24    RDS / Redis  (no internet route)
 *
 * Security groups reference each other. Broad CIDR ingress is rejected by design.
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly appSubnets: ec2.ISubnet[];
  public readonly dataSubnets: ec2.ISubnet[];
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;
  public readonly redisSecurityGroup: ec2.SecurityGroup;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { aegisEnv } = props;
    const azs = cdk.Fn.getAzs();
    const azA = cdk.Fn.select(0, azs);
    const azB = cdk.Fn.select(1, azs);

    const cfnVpc = new ec2.CfnVPC(this, 'Vpc', {
      cidrBlock: aegisEnv.vpc.cidr,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: [{ key: 'Name', value: `${aegisEnv.name}-aegis-vpc` }],
    });

    const igw = new ec2.CfnInternetGateway(this, 'InternetGateway', {
      tags: [{ key: 'Name', value: `${aegisEnv.name}-aegis-igw` }],
    });
    const igwAttach = new ec2.CfnVPCGatewayAttachment(this, 'IgwAttachment', {
      vpcId: cfnVpc.ref,
      internetGatewayId: igw.ref,
    });

    const publicA = this.publicSubnet('PublicA', cfnVpc.ref, azA, '10.0.1.0/24', `${aegisEnv.name}-public-a`);
    const publicB = this.publicSubnet('PublicB', cfnVpc.ref, azB, '10.0.2.0/24', `${aegisEnv.name}-public-b`);
    this.defaultRouteToIgw('PublicADefault', publicA.routeTable.ref, igw.ref, igwAttach);
    this.defaultRouteToIgw('PublicBDefault', publicB.routeTable.ref, igw.ref, igwAttach);

    const natCount = Math.max(1, Math.min(2, aegisEnv.vpc.natGateways));
    const natA = this.natGateway('NatA', publicA.subnet.ref, `${aegisEnv.name}-nat-a`);
    const natB = natCount > 1 ? this.natGateway('NatB', publicB.subnet.ref, `${aegisEnv.name}-nat-b`) : natA;

    const appA = this.privateSubnet('AppA', cfnVpc.ref, azA, '10.0.11.0/24', `${aegisEnv.name}-app-a`);
    const appB = this.privateSubnet('AppB', cfnVpc.ref, azB, '10.0.12.0/24', `${aegisEnv.name}-app-b`);
    this.defaultRouteToNat('AppADefault', appA.routeTable.ref, natA.ref);
    this.defaultRouteToNat('AppBDefault', appB.routeTable.ref, natB.ref);

    const dataA = this.privateSubnet('DataA', cfnVpc.ref, azA, '10.0.21.0/24', `${aegisEnv.name}-data-a`);
    const dataB = this.privateSubnet('DataB', cfnVpc.ref, azB, '10.0.22.0/24', `${aegisEnv.name}-data-b`);

    this.publicSubnets = [
      ec2.Subnet.fromSubnetAttributes(this, 'PublicARef', {
        subnetId: publicA.subnet.ref,
        availabilityZone: azA,
        routeTableId: publicA.routeTable.ref,
        ipv4CidrBlock: '10.0.1.0/24',
      }),
      ec2.Subnet.fromSubnetAttributes(this, 'PublicBRef', {
        subnetId: publicB.subnet.ref,
        availabilityZone: azB,
        routeTableId: publicB.routeTable.ref,
        ipv4CidrBlock: '10.0.2.0/24',
      }),
    ];
    this.appSubnets = [
      ec2.Subnet.fromSubnetAttributes(this, 'AppARef', {
        subnetId: appA.subnet.ref,
        availabilityZone: azA,
        routeTableId: appA.routeTable.ref,
        ipv4CidrBlock: '10.0.11.0/24',
      }),
      ec2.Subnet.fromSubnetAttributes(this, 'AppBRef', {
        subnetId: appB.subnet.ref,
        availabilityZone: azB,
        routeTableId: appB.routeTable.ref,
        ipv4CidrBlock: '10.0.12.0/24',
      }),
    ];
    this.dataSubnets = [
      ec2.Subnet.fromSubnetAttributes(this, 'DataARef', {
        subnetId: dataA.subnet.ref,
        availabilityZone: azA,
        routeTableId: dataA.routeTable.ref,
        ipv4CidrBlock: '10.0.21.0/24',
      }),
      ec2.Subnet.fromSubnetAttributes(this, 'DataBRef', {
        subnetId: dataB.subnet.ref,
        availabilityZone: azB,
        routeTableId: dataB.routeTable.ref,
        ipv4CidrBlock: '10.0.22.0/24',
      }),
    ];

    this.vpc = ec2.Vpc.fromVpcAttributes(this, 'VpcRef', {
      vpcId: cfnVpc.ref,
      vpcCidrBlock: aegisEnv.vpc.cidr,
      availabilityZones: [azA, azB],
      publicSubnetIds: this.publicSubnets.map((s) => s.subnetId),
      publicSubnetRouteTableIds: [publicA.routeTable.ref, publicB.routeTable.ref],
      privateSubnetIds: this.appSubnets.map((s) => s.subnetId),
      privateSubnetRouteTableIds: [appA.routeTable.ref, appB.routeTable.ref],
      isolatedSubnetIds: this.dataSubnets.map((s) => s.subnetId),
      isolatedSubnetRouteTableIds: [dataA.routeTable.ref, dataB.routeTable.ref],
    });

    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'Internet-facing ALB. HTTP/HTTPS only.',
      allowAllOutbound: true,
      securityGroupName: `${aegisEnv.name}-aegis-alb`,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public HTTP — redirected to HTTPS when ACM is present');
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Public HTTPS');

    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      description: 'Fargate tasks. Accept traffic only from the ALB.',
      allowAllOutbound: true,
      securityGroupName: `${aegisEnv.name}-aegis-ecs`,
    });
    this.ecsSecurityGroup.addIngressRule(this.albSecurityGroup, ec2.Port.tcp(8080), 'ALB to application containers');

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'Remediation and operations Lambdas in private app subnets.',
      allowAllOutbound: true,
      securityGroupName: `${aegisEnv.name}-aegis-lambda`,
    });

    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      description: 'PostgreSQL. No public inbound. App and remediator only.',
      allowAllOutbound: false,
      securityGroupName: `${aegisEnv.name}-aegis-rds`,
    });
    this.rdsSecurityGroup.addIngressRule(this.ecsSecurityGroup, ec2.Port.tcp(5432), 'ECS to PostgreSQL');
    this.rdsSecurityGroup.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(5432), 'Operations Lambda to PostgreSQL');

    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc: this.vpc,
      description: 'ElastiCache Redis. App and remediator only.',
      allowAllOutbound: false,
      securityGroupName: `${aegisEnv.name}-aegis-redis`,
    });
    this.redisSecurityGroup.addIngressRule(this.ecsSecurityGroup, ec2.Port.tcp(6379), 'ECS to Redis');
    this.redisSecurityGroup.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(6379), 'Operations Lambda to Redis');

    this.gatewayEndpoints(cfnVpc.ref, [
      publicA.routeTable.ref,
      publicB.routeTable.ref,
      appA.routeTable.ref,
      appB.routeTable.ref,
    ]);

    if (aegisEnv.vpc.enableInterfaceEndpoints) {
      this.interfaceEndpoints();
    }

    if (aegisEnv.vpc.enableFlowLogs) {
      this.flowLogs(cfnVpc.ref);
    }

    new cdk.CfnOutput(this, 'VpcId', { value: cfnVpc.ref, exportName: `${id}-VpcId` });
    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: this.publicSubnets.map((s) => s.subnetId).join(','),
    });
    new cdk.CfnOutput(this, 'AppSubnetIds', {
      value: this.appSubnets.map((s) => s.subnetId).join(','),
    });
    new cdk.CfnOutput(this, 'DataSubnetIds', {
      value: this.dataSubnets.map((s) => s.subnetId).join(','),
    });
  }

  private publicSubnet(id: string, vpcId: string, az: string, cidr: string, name: string) {
    const routeTable = new ec2.CfnRouteTable(this, `${id}Rt`, {
      vpcId,
      tags: [{ key: 'Name', value: `${name}-rt` }],
    });
    const subnet = new ec2.CfnSubnet(this, id, {
      vpcId,
      availabilityZone: az,
      cidrBlock: cidr,
      mapPublicIpOnLaunch: true,
      tags: [{ key: 'Name', value: name }],
    });
    new ec2.CfnSubnetRouteTableAssociation(this, `${id}Rta`, {
      subnetId: subnet.ref,
      routeTableId: routeTable.ref,
    });
    return { subnet, routeTable };
  }

  private privateSubnet(id: string, vpcId: string, az: string, cidr: string, name: string) {
    const routeTable = new ec2.CfnRouteTable(this, `${id}Rt`, {
      vpcId,
      tags: [{ key: 'Name', value: `${name}-rt` }],
    });
    const subnet = new ec2.CfnSubnet(this, id, {
      vpcId,
      availabilityZone: az,
      cidrBlock: cidr,
      mapPublicIpOnLaunch: false,
      tags: [{ key: 'Name', value: name }],
    });
    new ec2.CfnSubnetRouteTableAssociation(this, `${id}Rta`, {
      subnetId: subnet.ref,
      routeTableId: routeTable.ref,
    });
    return { subnet, routeTable };
  }

  private defaultRouteToIgw(id: string, routeTableId: string, gatewayId: string, attach: ec2.CfnVPCGatewayAttachment) {
    const route = new ec2.CfnRoute(this, id, {
      routeTableId,
      destinationCidrBlock: '0.0.0.0/0',
      gatewayId,
    });
    route.addResourceDependency(attach);
  }

  private defaultRouteToNat(id: string, routeTableId: string, natGatewayId: string) {
    new ec2.CfnRoute(this, id, {
      routeTableId,
      destinationCidrBlock: '0.0.0.0/0',
      natGatewayId,
    });
  }

  private natGateway(id: string, subnetId: string, name: string): ec2.CfnNatGateway {
    const eip = new ec2.CfnEIP(this, `${id}Eip`, {
      domain: 'vpc',
      tags: [{ key: 'Name', value: `${name}-eip` }],
    });
    return new ec2.CfnNatGateway(this, id, {
      subnetId,
      allocationId: eip.attrAllocationId,
      tags: [{ key: 'Name', value: name }],
    });
  }

  private gatewayEndpoints(vpcId: string, routeTableIds: string[]) {
    new ec2.CfnVPCEndpoint(this, 'S3Endpoint', {
      vpcId,
      serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.s3'),
      vpcEndpointType: 'Gateway',
      routeTableIds,
    });
    new ec2.CfnVPCEndpoint(this, 'DynamoDbEndpoint', {
      vpcId,
      serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.dynamodb'),
      vpcEndpointType: 'Gateway',
      routeTableIds,
    });
  }

  private interfaceEndpoints() {
    const endpointSg = new ec2.SecurityGroup(this, 'VpceSg', {
      vpc: this.vpc,
      description: 'Interface VPC endpoints. HTTPS from app and remediator only.',
      allowAllOutbound: false,
      securityGroupName: 'aegis-vpce',
    });
    endpointSg.addIngressRule(this.ecsSecurityGroup, ec2.Port.tcp(443), 'ECS to interface endpoints');
    endpointSg.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(443), 'Lambda to interface endpoints');

    const services = [
      'ecr.api',
      'ecr.dkr',
      'logs',
      'secretsmanager',
      'ssm',
      'ssmmessages',
      'ec2messages',
      'sts',
      'kms',
      'ecs',
    ];
    for (const service of services) {
      new ec2.InterfaceVpcEndpoint(this, `Vpce${service.replace(/\./g, '')}`, {
        vpc: this.vpc,
        service: new ec2.InterfaceVpcEndpointService(
          cdk.Fn.sub(`com.amazonaws.\${AWS::Region}.${service}`),
        ),
        subnets: { subnets: this.appSubnets },
        securityGroups: [endpointSg],
        privateDnsEnabled: true,
      });
    }
  }

  private flowLogs(vpcId: string) {
    const group = new logs.LogGroup(this, 'VpcFlowLogs', {
      logGroupName: `/aegiscloud/${this.node.tryGetContext('env') || 'dev'}/vpc/flow-logs`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, 'FlowLogRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
    });
    group.grantWrite(role);
    new ec2.CfnFlowLog(this, 'VpcFlowLog', {
      resourceId: vpcId,
      resourceType: 'VPC',
      trafficType: 'ALL',
      logDestinationType: 'cloud-watch-logs',
      logGroupName: group.logGroupName,
      deliverLogsPermissionArn: role.roleArn,
    });
  }

}
