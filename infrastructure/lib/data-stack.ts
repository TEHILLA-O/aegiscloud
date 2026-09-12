import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { AegisEnvironment } from './config';
import { NetworkStack } from './network-stack';

export interface DataStackProps extends cdk.StackProps {
  readonly aegisEnv: AegisEnvironment;
  readonly network: NetworkStack;
}

export class DataStack extends cdk.Stack {
  public readonly kmsKey: kms.Key;
  public readonly database: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly redisEndpoint: string;
  public readonly appBucket: s3.Bucket;
  public readonly evidenceBucket: s3.Bucket;
  public readonly logsBucket: s3.Bucket;
  public readonly chaosLabBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { aegisEnv, network } = props;
    const removal = aegisEnv.name === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;

    this.kmsKey = new kms.Key(this, 'DataKey', {
      alias: `alias/aegiscloud/${aegisEnv.name}/data`,
      enableKeyRotation: true,
      description: 'AegisCloud data-plane encryption (RDS, S3, Secrets, logs)',
      removalPolicy: removal,
    });

    this.logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: undefined,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: removal,
      autoDeleteObjects: aegisEnv.name === 'dev',
      lifecycleRules: [{ expiration: cdk.Duration.days(90), noncurrentVersionExpiration: cdk.Duration.days(30) }],
    });

    this.appBucket = new s3.Bucket(this, 'AppBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: removal,
      autoDeleteObjects: aegisEnv.name === 'dev',
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 'app-access/',
    });

    this.evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: removal,
      autoDeleteObjects: aegisEnv.name === 'dev',
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
    });

    /**
     * Intentionally starts PRIVATE. Chaos Lab `aegis chaos inject public-s3`
     * flips Block Public Access so Config + remediation can close it again.
     */
    this.chaosLabBucket = new s3.Bucket(this, 'ChaosLabBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const instanceType = new ec2.InstanceType(aegisEnv.data.rdsInstanceType);

    this.database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_6 }),
      instanceType,
      vpc: network.vpc,
      vpcSubnets: { subnets: network.dataSubnets },
      securityGroups: [network.rdsSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('aegis', {
        secretName: `aegiscloud/${aegisEnv.name}/rds/master`,
        encryptionKey: this.kmsKey,
      }),
      databaseName: 'aegis',
      allocatedStorage: aegisEnv.data.allocatedStorageGiB,
      maxAllocatedStorage: aegisEnv.data.allocatedStorageGiB * 2,
      storageEncrypted: true,
      storageEncryptionKey: this.kmsKey,
      multiAz: aegisEnv.data.multiAz,
      publiclyAccessible: false,
      deletionProtection: aegisEnv.data.deletionProtection,
      backupRetention: cdk.Duration.days(aegisEnv.data.backupRetentionDays),
      deleteAutomatedBackups: aegisEnv.name === 'dev',
      removalPolicy: removal,
      cloudwatchLogsExports: ['postgresql'],
      autoMinorVersionUpgrade: true,
      iamAuthentication: true,
      port: 5432,
    });
    this.dbSecret = this.database.secret!;

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'Isolated data subnets for AegisCloud Redis',
      subnetIds: network.dataSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: `${aegisEnv.name}-aegis-redis`,
    });

    const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: 'AegisCloud session / cache Redis',
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: aegisEnv.data.redisNodeType,
      numCacheClusters: aegisEnv.data.multiAz ? 2 : 1,
      automaticFailoverEnabled: aegisEnv.data.multiAz,
      multiAzEnabled: aegisEnv.data.multiAz,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      securityGroupIds: [network.redisSecurityGroup.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      kmsKeyId: this.kmsKey.keyId,
      snapshotRetentionLimit: aegisEnv.name === 'dev' ? 1 : 7,
      autoMinorVersionUpgrade: true,
    });
    redis.addResourceDependency(redisSubnetGroup);
    this.redisEndpoint = redis.attrPrimaryEndPointAddress;

    new cdk.CfnOutput(this, 'RdsEndpoint', { value: this.database.instanceEndpoint.hostname });
    new cdk.CfnOutput(this, 'RedisEndpoint', { value: this.redisEndpoint });
    new cdk.CfnOutput(this, 'AppBucketName', { value: this.appBucket.bucketName });
    new cdk.CfnOutput(this, 'EvidenceBucketName', { value: this.evidenceBucket.bucketName });
    new cdk.CfnOutput(this, 'ChaosLabBucketName', { value: this.chaosLabBucket.bucketName });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn });
  }
}
