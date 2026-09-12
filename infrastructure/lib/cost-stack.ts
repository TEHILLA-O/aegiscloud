import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';
import { AegisEnvironment } from './config';
import { ComputeStack } from './compute-stack';

export interface CostStackProps extends cdk.StackProps {
  readonly aegisEnv: AegisEnvironment;
  readonly compute: ComputeStack;
}

export class CostStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CostStackProps) {
    super(scope, id, props);

    const { aegisEnv, compute } = props;

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `aegiscloud-${aegisEnv.name}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: aegisEnv.cost.monthlyBudget,
          unit: aegisEnv.currency,
        },
        costFilters: {
          TagKeyValue: ['user:Project$AegisCloud'],
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: aegisEnv.remediation.notifyEmail
            ? [{ subscriptionType: 'EMAIL', address: aegisEnv.remediation.notifyEmail }]
            : [],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: aegisEnv.remediation.notifyEmail
            ? [{ subscriptionType: 'EMAIL', address: aegisEnv.remediation.notifyEmail }]
            : [],
        },
      ].filter((n) => n.subscribers.length > 0),
    });

    if (aegisEnv.cost.autoShutdown) {
      const sleeper = new nodejs.NodejsFunction(this, 'DevShutdown', {
        entry: path.join(__dirname, '..', '..', 'services', 'remediation', 'shutdown.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: cdk.Duration.seconds(60),
        environment: {
          CLUSTER_NAME: compute.cluster.clusterName,
          ECS_SERVICES: compute.services.map((s) => s.service.serviceName).join(','),
          ENVIRONMENT: aegisEnv.name,
        },
        bundling: { minify: true, externalModules: [] },
      });
      sleeper.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ecs:UpdateService', 'ecs:DescribeServices'],
          resources: ['*'],
        }),
      );

      new events.Rule(this, 'WeeknightShutdown', {
        schedule: events.Schedule.cron({
          minute: '0',
          hour: `${aegisEnv.cost.shutdownHourUtc}`,
          weekDay: 'MON-FRI',
        }),
        targets: [
          new targets.LambdaFunction(sleeper, {
            event: events.RuleTargetInput.fromObject({ action: 'stop' }),
          }),
        ],
      });

      new events.Rule(this, 'WeekdayStartup', {
        schedule: events.Schedule.cron({
          minute: '0',
          hour: `${aegisEnv.cost.startupHourUtc}`,
          weekDay: 'MON-FRI',
        }),
        targets: [
          new targets.LambdaFunction(sleeper, {
            event: events.RuleTargetInput.fromObject({ action: 'start' }),
          }),
        ],
      });
    }

    new cdk.CfnOutput(this, 'MonthlyBudgetAmount', {
      value: `${aegisEnv.cost.monthlyBudget} ${aegisEnv.currency}`,
    });
  }
}
