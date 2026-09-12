import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as config from 'aws-cdk-lib/aws-config';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as securityhub from 'aws-cdk-lib/aws-securityhub';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { AegisEnvironment } from './config';
import { ComputeStack } from './compute-stack';
import { DataStack } from './data-stack';

export interface SecurityStackProps extends cdk.StackProps {
  readonly aegisEnv: AegisEnvironment;
  readonly data: DataStack;
  readonly compute: ComputeStack;
}

/**
 * Detection plane. Remediation is owned by RemediationStack so that
 * Config / GuardDuty / Security Hub stay observable even when auto-fix is off.
 */
export class SecurityStack extends cdk.Stack {
  public readonly configBucket: s3.Bucket;
  public readonly webAcl?: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    const { aegisEnv, compute } = props;

    if (aegisEnv.security.enableConfig) {
      this.configBucket = this.enableConfig(aegisEnv);
    } else {
      this.configBucket = new s3.Bucket(this, 'ConfigPlaceholder', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
    }

    if (aegisEnv.security.enableGuardDuty) {
      new guardduty.CfnDetector(this, 'GuardDuty', {
        enable: true,
        findingPublishingFrequency: 'FIFTEEN_MINUTES',
        dataSources: {
          s3Logs: { enable: true },
          kubernetes: { auditLogs: { enable: false } },
          malwareProtection: { scanEc2InstanceWithFindings: { ebsVolumes: true } },
        },
      });
    }

    if (aegisEnv.security.enableSecurityHub) {
      new securityhub.CfnHub(this, 'SecurityHub', {
        autoEnableControls: true,
        controlFindingGenerator: 'SECURITY_CONTROL',
        enableDefaultStandards: true,
      });
    }

    if (aegisEnv.security.enableWaf) {
      this.webAcl = this.createWebAcl();
      new wafv2.CfnWebACLAssociation(this, 'AlbWafAssociation', {
        resourceArn: compute.alb.loadBalancerArn,
        webAclArn: this.webAcl.attrArn,
      });
    }

    if (aegisEnv.security.enableCloudFront) {
      const distribution = new cloudfront.Distribution(this, 'Distribution', {
        comment: `AegisCloud ${aegisEnv.name} edge`,
        defaultBehavior: {
          origin: new origins.LoadBalancerV2Origin(compute.alb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
      });
      new cdk.CfnOutput(this, 'CloudFrontDomain', { value: distribution.distributionDomainName });
    }
  }

  private enableConfig(aegisEnv: AegisEnvironment): s3.Bucket {
    const bucket = new s3.Bucket(this, 'ConfigBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: aegisEnv.name === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: aegisEnv.name === 'dev',
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
    });

    const role = new iam.Role(this, 'ConfigRole', {
      assumedBy: new iam.ServicePrincipal('config.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWS_ConfigRole')],
    });
    bucket.grantReadWrite(role);

    new config.CfnConfigurationRecorder(this, 'Recorder', {
      name: `aegiscloud-${aegisEnv.name}`,
      roleArn: role.roleArn,
      recordingGroup: {
        allSupported: true,
        includeGlobalResourceTypes: true,
      },
    });

    new config.CfnDeliveryChannel(this, 'Delivery', {
      s3BucketName: bucket.bucketName,
      name: `aegiscloud-${aegisEnv.name}`,
    });

    const rules: Array<{ id: string; source: string; params?: Record<string, string> }> = [
      { id: 'RestrictedSsh', source: 'INCOMING_SSH_DISABLED' },
      { id: 'S3PublicReadProhibited', source: 'S3_BUCKET_PUBLIC_READ_PROHIBITED' },
      { id: 'S3PublicWriteProhibited', source: 'S3_BUCKET_PUBLIC_WRITE_PROHIBITED' },
      { id: 'S3SslRequestsOnly', source: 'S3_BUCKET_SSL_REQUESTS_ONLY' },
      { id: 'RdsEncrypted', source: 'RDS_STORAGE_ENCRYPTED' },
      { id: 'RdsPublicAccess', source: 'RDS_INSTANCE_PUBLIC_ACCESS_CHECK' },
      { id: 'EncryptedVolumes', source: 'ENCRYPTED_VOLUMES' },
      { id: 'RootMfa', source: 'ROOT_ACCOUNT_MFA_ENABLED' },
      { id: 'IamPasswordPolicy', source: 'IAM_PASSWORD_POLICY' },
      {
        id: 'RequiredTags',
        source: 'REQUIRED_TAGS',
        params: {
          tag1Key: 'Project',
          tag1Value: 'AegisCloud',
          tag2Key: 'ManagedBy',
          tag2Value: 'CDK',
        },
      },
    ];

    for (const rule of rules) {
      new config.CfnConfigRule(this, rule.id, {
        configRuleName: `aegis-${aegisEnv.name}-${rule.id}`,
        source: { owner: 'AWS', sourceIdentifier: rule.source },
        inputParameters: rule.params,
      });
    }

    return bucket;
  }

  private createWebAcl(): wafv2.CfnWebACL {
    return new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'aegiscloud-edge',
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'AegisWebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        managedRule('AWSManagedRulesCommonRuleSet', 1),
        managedRule('AWSManagedRulesKnownBadInputsRuleSet', 2),
        managedRule('AWSManagedRulesSQLiRuleSet', 3),
        {
          name: 'RateLimit',
          priority: 10,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AegisRateLimit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
  }
}

function managedRule(name: string, priority: number): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} },
    statement: {
      managedRuleGroupStatement: {
        vendorName: 'AWS',
        name,
      },
    },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: name,
      sampledRequestsEnabled: true,
    },
  };
}
