import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { AegisEnvironment } from './config';
import { ComputeStack } from './compute-stack';
import { DataStack } from './data-stack';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly aegisEnv: AegisEnvironment;
  readonly compute: ComputeStack;
  readonly data: DataStack;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { aegisEnv, compute, data } = props;

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `aegiscloud-${aegisEnv.name}-alarms`,
      displayName: 'AegisCloud operational alarms',
    });
    if (aegisEnv.remediation.notifyEmail) {
      this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(aegisEnv.remediation.notifyEmail));
    }

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `AegisCloud-${aegisEnv.name}`,
    });

    const alarmAction = new cw_actions.SnsAction(this.alarmTopic);

    const alb5xx = new cloudwatch.Alarm(this, 'Alb5xx', {
      alarmName: `${aegisEnv.name}-alb-5xx`,
      metric: compute.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
        period: cdk.Duration.minutes(1),
      }),
      threshold: 5,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alb5xx.addAlarmAction(alarmAction);

    const unhealthy = new cloudwatch.Alarm(this, 'UnhealthyTargets', {
      alarmName: `${aegisEnv.name}-alb-unhealthy-targets`,
      metric: compute.services[0].targetGroup.metrics.unhealthyHostCount({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    unhealthy.addAlarmAction(alarmAction);

    for (const svc of compute.services) {
      const cpu = new cloudwatch.Alarm(this, `${capitalize(svc.name)}Cpu`, {
        alarmName: `${aegisEnv.name}-ecs-${svc.name}-cpu`,
        metric: svc.service.metricCpuUtilization({ period: cdk.Duration.minutes(1) }),
        threshold: 80,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      cpu.addAlarmAction(alarmAction);

      const running = new cloudwatch.Alarm(this, `${capitalize(svc.name)}Running`, {
        alarmName: `${aegisEnv.name}-ecs-${svc.name}-running-low`,
        metric: runningTaskMetric(svc.service),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      running.addAlarmAction(alarmAction);
    }

    const rdsCpu = new cloudwatch.Alarm(this, 'RdsCpu', {
      alarmName: `${aegisEnv.name}-rds-cpu`,
      metric: data.database.metricCPUUtilization({ period: cdk.Duration.minutes(1) }),
      threshold: 80,
      evaluationPeriods: 5,
    });
    rdsCpu.addAlarmAction(alarmAction);

    const rdsStorage = new cloudwatch.Alarm(this, 'RdsStorage', {
      alarmName: `${aegisEnv.name}-rds-free-storage`,
      metric: data.database.metricFreeStorageSpace({ period: cdk.Duration.minutes(5) }),
      threshold: 2 * 1024 * 1024 * 1024,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
    });
    rdsStorage.addAlarmAction(alarmAction);

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# AegisCloud (${aegisEnv.name})\nSelf-healing operations · ${this.region}`,
        width: 24,
        height: 2,
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB request count',
        left: [compute.alb.metrics.requestCount()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB 5XX',
        left: [compute.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT)],
        width: 12,
      }),
      ...compute.services.map(
        (svc) =>
          new cloudwatch.GraphWidget({
            title: `ECS ${svc.name} CPU / memory`,
            left: [svc.service.metricCpuUtilization()],
            right: [svc.service.metricMemoryUtilization()],
            width: 8,
          }),
      ),
      new cloudwatch.GraphWidget({
        title: 'RDS CPU / connections',
        left: [data.database.metricCPUUtilization()],
        right: [data.database.metricDatabaseConnections()],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS free storage',
        left: [data.database.metricFreeStorageSpace()],
        width: 12,
      }),
    );

    new events.Rule(this, 'AlarmStateChange', {
      description: 'Capture AegisCloud CloudWatch alarm transitions for the orchestrator',
      eventPattern: {
        source: ['aws.cloudwatch'],
        detailType: ['CloudWatch Alarm State Change'],
        detail: {
          state: { value: ['ALARM'] },
          alarmName: [{ prefix: `${aegisEnv.name}-` }],
        },
      },
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
    new cdk.CfnOutput(this, 'DashboardName', { value: this.dashboard.dashboardName });
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function runningTaskMetric(service: ecs.FargateService): cloudwatch.IMetric {
  return new cloudwatch.Metric({
    namespace: 'ECS/ContainerInsights',
    metricName: 'RunningTaskCount',
    dimensionsMap: {
      ClusterName: service.cluster.clusterName,
      ServiceName: service.serviceName,
    },
    statistic: 'Average',
    period: cdk.Duration.minutes(1),
  });
}
