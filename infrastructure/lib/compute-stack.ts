import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { AegisEnvironment } from './config';
import { DataStack } from './data-stack';
import { NetworkStack } from './network-stack';

export interface ComputeStackProps extends cdk.StackProps {
  readonly aegisEnv: AegisEnvironment;
  readonly network: NetworkStack;
  readonly data: DataStack;
}

export interface ServiceHandle {
  readonly name: string;
  readonly service: ecs.FargateService;
  readonly repository: ecr.Repository;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly listener: elbv2.ApplicationListener;
  public readonly services: ServiceHandle[];
  public readonly executionRole: iam.Role;
  public readonly taskRole: iam.Role;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { aegisEnv, network, data } = props;

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: network.vpc,
      clusterName: `${aegisEnv.name}-aegis`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    this.grantDataPlaneIdentity(this.executionRole, data);

    this.taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Least-privilege task role for AegisCloud demo APIs',
    });
    this.grantDataPlaneIdentity(this.taskRole, data);

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: network.vpc,
      internetFacing: true,
      vpcSubnets: { subnets: network.publicSubnets },
      securityGroup: network.albSecurityGroup,
      dropInvalidHeaderFields: true,
      deletionProtection: aegisEnv.data.deletionProtection,
    });

    this.listener = this.alb.addListener('Http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
    });

    const definitions: Array<{ name: string; path: string; priority: number; worker?: boolean }> = [
      { name: 'order', path: '/orders*', priority: 10 },
      { name: 'customer', path: '/customers*', priority: 20 },
      { name: 'worker', path: '/worker*', priority: 30, worker: true },
    ];

    this.services = definitions.map((def) => this.createService(def, props));

    this.listener.addAction('Default', {
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'application/json',
        messageBody: JSON.stringify({
          service: 'aegiscloud',
          environment: aegisEnv.name,
          status: 'ok',
          routes: ['/orders', '/customers', '/worker', '/health'],
        }),
      }),
    });

    new cdk.CfnOutput(this, 'AlbDns', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'OrderServiceName', { value: this.services[0].service.serviceName });
    new cdk.CfnOutput(this, 'CustomerServiceName', { value: this.services[1].service.serviceName });
    new cdk.CfnOutput(this, 'WorkerServiceName', { value: this.services[2].service.serviceName });
    for (const svc of this.services) {
      new cdk.CfnOutput(this, `${capitalize(svc.name)}Repository`, {
        value: svc.repository.repositoryUri,
      });
    }
  }

  private createService(
    def: { name: string; path: string; priority: number; worker?: boolean },
    props: ComputeStackProps,
  ): ServiceHandle {
    const { aegisEnv, network, data } = props;

    const repository = new ecr.Repository(this, `${capitalize(def.name)}Repo`, {
      repositoryName: `aegiscloud/${aegisEnv.name}/${def.name}`,
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: aegisEnv.name === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      emptyOnDelete: aegisEnv.name === 'dev',
      lifecycleRules: [{ maxImageCount: 10 }],
    });

    const logGroup = new logs.LogGroup(this, `${capitalize(def.name)}Logs`, {
      logGroupName: `/aegiscloud/${aegisEnv.name}/ecs/${def.name}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, `${capitalize(def.name)}Task`, {
      cpu: aegisEnv.compute.cpu,
      memoryLimitMiB: aegisEnv.compute.memoryMiB,
      executionRole: this.executionRole,
      taskRole: this.taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const image =
      process.env.AEGIS_SKIP_DOCKER === '1'
        ? ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/node:20-alpine')
        : ecs.ContainerImage.fromAsset('services/demo-api', {
            file: 'Dockerfile',
            buildArgs: { SERVICE_NAME: def.name },
          });

    const container = taskDef.addContainer(def.name, {
      image,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: def.name,
        logGroup,
      }),
      environment: {
        SERVICE_NAME: def.name,
        NODE_ENV: aegisEnv.name === 'dev' ? 'development' : 'production',
        PORT: '8080',
        AWS_REGION: this.region,
        REDIS_HOST: data.redisEndpoint,
        APP_BUCKET: data.appBucket.bucketName,
        DATABASE_SECRET_ARN: data.dbSecret.secretArn,
        CHAOS_ENDPOINT: '1',
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:8080/health || exit 1'],
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(20),
      },
    });
    container.addPortMappings({ containerPort: 8080 });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, `${capitalize(def.name)}Tg`, {
      vpc: network.vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(20),
    });

    const desired = def.worker ? 1 : aegisEnv.compute.desiredCount;

    const service = new ecs.FargateService(this, `${capitalize(def.name)}Service`, {
      cluster: this.cluster,
      serviceName: `${aegisEnv.name}-${def.name}`,
      taskDefinition: taskDef,
      desiredCount: desired,
      vpcSubnets: { subnets: network.appSubnets },
      securityGroups: [network.ecsSecurityGroup],
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      enableExecuteCommand: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });

    service.attachToApplicationTargetGroup(targetGroup);

    this.listener.addTargetGroups(`${capitalize(def.name)}Rule`, {
      priority: def.priority,
      conditions: [elbv2.ListenerCondition.pathPatterns([def.path, `/${def.name}`, `/${def.name}/*`])],
      targetGroups: [targetGroup],
    });

    if (!def.worker) {
      const scaling = service.autoScaleTaskCount({
        minCapacity: aegisEnv.compute.minCapacity,
        maxCapacity: aegisEnv.compute.maxCapacity,
      });
      scaling.scaleOnCpuUtilization('CpuScale', {
        targetUtilizationPercent: aegisEnv.compute.cpuTargetPercent,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(30),
      });
      scaling.scaleOnRequestCount('RequestScale', {
        requestsPerTarget: 80,
        targetGroup,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(30),
      });
    }

    return { name: def.name, service, repository, targetGroup };
  }

  /**
   * Identity-based grants only. Resource policies on KMS / Secrets / S3 live in
   * the Data stack; adding the role ARN there would create a Data ↔ Compute cycle.
   */
  private grantDataPlaneIdentity(role: iam.Role, data: DataStack) {
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [data.dbSecret.secretArn],
      }),
    );
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [data.kmsKey.keyArn],
      }),
    );
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [data.appBucket.bucketArn, `${data.appBucket.bucketArn}/*`],
      }),
    );
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
