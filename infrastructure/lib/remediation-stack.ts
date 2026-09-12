import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Int from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import { AegisEnvironment } from './config';
import { ComputeStack } from './compute-stack';
import { DataStack } from './data-stack';
import { NetworkStack } from './network-stack';
import { ObservabilityStack } from './observability-stack';

export interface RemediationStackProps extends cdk.StackProps {
  readonly aegisEnv: AegisEnvironment;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly compute: ComputeStack;
  readonly observability: ObservabilityStack;
}

export class RemediationStack extends cdk.Stack {
  public readonly incidents: dynamodb.Table;
  public readonly stateMachine: sfn.StateMachine;
  public readonly operationsApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: RemediationStackProps) {
    super(scope, id, props);

    const { aegisEnv, network, data, compute, observability } = props;

    this.incidents = new dynamodb.Table(this, 'Incidents', {
      tableName: `aegiscloud-${aegisEnv.name}-incidents`,
      partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    this.incidents.addGlobalSecondaryIndex({
      indexName: 'status-createdAt',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    const commonEnv = {
      INCIDENTS_TABLE: this.incidents.tableName,
      EVIDENCE_BUCKET: data.evidenceBucket.bucketName,
      CHAOS_BUCKET: data.chaosLabBucket.bucketName,
      CLUSTER_NAME: compute.cluster.clusterName,
      DEFAULT_POLICY: aegisEnv.remediation.defaultPolicy,
      ENVIRONMENT: aegisEnv.name,
      ALARM_TOPIC_ARN: observability.alarmTopic.topicArn,
      ECS_SERVICES: compute.services.map((s) => s.service.serviceName).join(','),
    };

    const classify = this.fn('Classify', 'classify.ts', commonEnv, network);
    const remediate = this.fn('Remediate', 'remediate.ts', commonEnv, network);
    const validate = this.fn('Validate', 'validate.ts', commonEnv, network);
    const operations = this.fn('Operations', 'operations.ts', commonEnv, network);

    this.incidents.grantReadWriteData(classify);
    this.incidents.grantReadWriteData(remediate);
    this.incidents.grantReadWriteData(validate);
    this.incidents.grantReadWriteData(operations);

    for (const fn of [classify, remediate, validate]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['sns:Publish'],
          resources: [observability.alarmTopic.topicArn],
        }),
      );
    }
    classify.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [`${data.evidenceBucket.bucketArn}/*`],
      }),
    );
    remediate.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:PutBucketPublicAccessBlock', 's3:GetBucketPublicAccessBlock'],
        resources: [data.evidenceBucket.bucketArn, `${data.evidenceBucket.bucketArn}/*`, data.chaosLabBucket.bucketArn, `${data.chaosLabBucket.bucketArn}/*`],
      }),
    );

    remediate.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'BoundedRemediation',
        actions: [
          'ec2:RevokeSecurityGroupIngress',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeSecurityGroupRules',
          'ec2:CreateTags',
          's3:PutBucketPublicAccessBlock',
          's3:PutBucketAcl',
          's3:PutBucketPolicy',
          's3:GetBucketPublicAccessBlock',
          's3:GetBucketAcl',
          's3:GetBucketPolicy',
          'ecs:UpdateService',
          'ecs:DescribeServices',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
          'ecs:StopTask',
          'application-autoscaling:RegisterScalableTarget',
          'application-autoscaling:DescribeScalableTargets',
          'rds:DescribeDBInstances',
          'rds:ModifyDBInstance',
          'ssm:StartAutomationExecution',
          'ssm:GetAutomationExecution',
          'config:GetComplianceDetailsByConfigRule',
          'config:GetResourceConfigHistory',
          'guardduty:GetFindings',
          'securityhub:BatchUpdateFindings',
          'ec2:CreateNetworkAclEntry',
          'ec2:ReplaceNetworkAclAssociation',
        ],
        resources: ['*'],
      }),
    );

    validate.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:DescribeSecurityGroups',
          's3:GetBucketPublicAccessBlock',
          's3:GetBucketAcl',
          'ecs:DescribeServices',
          'ecs:DescribeTasks',
          'config:GetComplianceDetailsByConfigRule',
          'elasticloadbalancing:DescribeTargetHealth',
        ],
        resources: ['*'],
      }),
    );

    operations.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ecs:DescribeClusters',
          'ecs:DescribeServices',
          'ecs:ListTasks',
          'elasticloadbalancing:DescribeLoadBalancers',
          'elasticloadbalancing:DescribeTargetHealth',
          'rds:DescribeDBInstances',
          'elasticache:DescribeReplicationGroups',
          'config:DescribeComplianceByConfigRule',
          'guardduty:ListDetectors',
          'guardduty:GetDetector',
          'securityhub:DescribeHub',
          'ce:GetCostAndUsage',
          'budgets:DescribeBudgets',
          'cloudwatch:DescribeAlarms',
          'ec2:DescribeVpcs',
          'ec2:DescribeNatGateways',
          'ssm:DescribeInstancePatchStates',
        ],
        resources: ['*'],
      }),
    );

    const classifyTask = new tasks.LambdaInvoke(this, 'ClassifyIncident', {
      lambdaFunction: classify,
      payloadResponseOnly: true,
      resultPath: '$.classification',
    });

    const remediateTask = new tasks.LambdaInvoke(this, 'RemediateIncident', {
      lambdaFunction: remediate,
      payloadResponseOnly: true,
      resultPath: '$.remediation',
    });

    const waitValidate = new sfn.Wait(this, 'WaitForConvergence', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(8)),
    });

    const validateTask = new tasks.LambdaInvoke(this, 'ValidateIncident', {
      lambdaFunction: validate,
      payloadResponseOnly: true,
      resultPath: '$.validation',
    });

    const notifyEscalate = this.snsNotify('NotifyAndEscalate', observability.alarmTopic.topicArn);
    const notifyApproval = this.snsNotify('NotifyOperatorsApproval', observability.alarmTopic.topicArn);
    const notifyObserve = this.snsNotify('NotifyOperatorsObserve', observability.alarmTopic.topicArn);

    const close = new sfn.Succeed(this, 'ClosedAutoRemediated');
    const recorded = new sfn.Succeed(this, 'RecordedObserve');
    const awaiting = new sfn.Succeed(this, 'AwaitingApproval');
    const escalate = new sfn.Fail(this, 'Escalated', {
      error: 'RemediationFailed',
      cause: 'Validation did not confirm the fix. Operator intervention required.',
    });

    const afterRemediation = waitValidate
      .next(validateTask)
      .next(
        new sfn.Choice(this, 'Fixed?')
          .when(sfn.Condition.booleanEquals('$.validation.fixed', true), close)
          .otherwise(notifyEscalate.next(escalate)),
      );

    const policyChoice = new sfn.Choice(this, 'SafeToAutoRemediate?')
      .when(
        sfn.Condition.and(
          sfn.Condition.booleanEquals('$.classification.safeToAutoRemediate', true),
          sfn.Condition.stringEquals('$.classification.policy', 'AUTO_REMEDIATE'),
        ),
        remediateTask.next(afterRemediation),
      )
      .when(sfn.Condition.stringEquals('$.classification.policy', 'APPROVAL_REQUIRED'), notifyApproval.next(awaiting))
      .otherwise(notifyObserve.next(recorded));

    const definition = classifyTask.next(policyChoice);

    this.stateMachine = new sfn.StateMachine(this, 'IncidentResponse', {
      stateMachineName: `aegiscloud-${aegisEnv.name}-incident-response`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(15),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'SfnLogs', {
          logGroupName: `/aegiscloud/${aegisEnv.name}/stepfunctions/incident-response`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });
    this.stateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [observability.alarmTopic.topicArn],
      }),
    );

    new ssm.CfnDocument(this, 'RevokeOpenSsh', {
      name: `AegisCloud-${aegisEnv.name}-RevokeOpenSsh`,
      documentType: 'Automation',
      documentFormat: 'YAML',
      content: {
        schemaVersion: '0.3',
        description: 'Remove 0.0.0.0/0 SSH ingress from a security group. Mirrors AWS Config auto-remediation.',
        assumeRole: '{{ AutomationAssumeRole }}',
        parameters: {
          GroupId: { type: 'String' },
          AutomationAssumeRole: { type: 'String' },
        },
        mainSteps: [
          {
            name: 'Revoke',
            action: 'aws:executeAwsApi',
            inputs: {
              Service: 'ec2',
              Api: 'RevokeSecurityGroupIngress',
              GroupId: '{{ GroupId }}',
              IpPermissions: [
                {
                  IpProtocol: 'tcp',
                  FromPort: 22,
                  ToPort: 22,
                  IpRanges: [{ CidrIp: '0.0.0.0/0' }],
                },
              ],
            },
          },
        ],
      },
    });

    const sfnTarget = new targets.SfnStateMachine(this.stateMachine);

    new events.Rule(this, 'ConfigNonCompliant', {
      description: 'AWS Config NON_COMPLIANT resources enter the orchestrator',
      eventPattern: {
        source: ['aws.config'],
        detailType: ['Config Rules Compliance Change'],
        detail: {
          newEvaluationResult: { complianceType: ['NON_COMPLIANT'] },
        },
      },
      targets: [sfnTarget],
    });

    new events.Rule(this, 'GuardDutyFindings', {
      description: 'GuardDuty findings enter the security orchestrator',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Finding'],
      },
      targets: [sfnTarget],
    });

    new events.Rule(this, 'SecurityHubFindings', {
      description: 'Security Hub imported findings enter the orchestrator',
      eventPattern: {
        source: ['aws.securityhub'],
        detailType: ['Security Hub Findings - Imported'],
      },
      targets: [sfnTarget],
    });

    new events.Rule(this, 'CloudWatchAlarms', {
      description: 'AegisCloud CloudWatch ALARM transitions',
      eventPattern: {
        source: ['aws.cloudwatch'],
        detailType: ['CloudWatch Alarm State Change'],
        detail: {
          state: { value: ['ALARM'] },
          alarmName: [{ prefix: `${aegisEnv.name}-` }],
        },
      },
      targets: [sfnTarget],
    });

    this.operationsApi = new apigwv2.HttpApi(this, 'OperationsApi', {
      apiName: `aegiscloud-${aegisEnv.name}-ops`,
      description: 'Read-only operations API consumed by the aegis CLI',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET],
      },
    });
    const opsIntegration = new apigwv2Int.HttpLambdaIntegration('OpsIntegration', operations);
    this.operationsApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.GET],
      integration: opsIntegration,
    });
    this.operationsApi.addRoutes({
      path: '/',
      methods: [apigwv2.HttpMethod.GET],
      integration: opsIntegration,
    });

    new ssm.StringParameter(this, 'OpsUrlParam', {
      parameterName: `/aegiscloud/${aegisEnv.name}/operations-api-url`,
      stringValue: this.operationsApi.apiEndpoint,
    });
    new ssm.StringParameter(this, 'StateMachineParam', {
      parameterName: `/aegiscloud/${aegisEnv.name}/incident-state-machine`,
      stringValue: this.stateMachine.stateMachineArn,
    });
    new ssm.StringParameter(this, 'PolicyParam', {
      parameterName: `/aegiscloud/${aegisEnv.name}/remediation-policy`,
      stringValue: aegisEnv.remediation.defaultPolicy,
    });

    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
    new cdk.CfnOutput(this, 'IncidentsTable', { value: this.incidents.tableName });
    new cdk.CfnOutput(this, 'OperationsApiUrl', { value: this.operationsApi.apiEndpoint });
  }

  private snsNotify(id: string, topicArn: string): sfn.CustomState {
    return new sfn.CustomState(this, id, {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::sns:publish',
        Parameters: {
          TopicArn: topicArn,
          'Message.$': 'States.JsonToString($)',
          'Subject.$': "States.Format('AegisCloud {} — {}', $.classification.severity, $.classification.title)",
        },
        ResultPath: '$.notify',
      },
    });
  }

  private fn(
    id: string,
    entryFile: string,
    environment: Record<string, string>,
    network: NetworkStack,
  ): nodejs.NodejsFunction {
    return new nodejs.NodejsFunction(this, id, {
      entry: path.join(__dirname, '..', '..', 'services', 'remediation', entryFile),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment,
      bundling: { minify: true, sourceMap: true, externalModules: [] },
      logGroup: new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      vpc: network.vpc,
      vpcSubnets: { subnets: network.appSubnets },
      securityGroups: [network.lambdaSecurityGroup],
    });
  }
}
