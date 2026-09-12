import { PutPublicAccessBlockCommand, S3Client } from '@aws-sdk/client-s3';
import { CliContext, stackOutputs } from '../cli/aegis/src/aws';

export async function injectPublicS3(ctx: CliContext): Promise<void> {
  const outputs = await stackOutputs(ctx, 'Data');
  const bucket = outputs.ChaosLabBucketName;
  if (!bucket) throw new Error('ChaosLabBucketName output missing. Deploy the Data stack first.');

  const s3 = new S3Client({ region: ctx.region });
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }),
  );

  console.log('');
  console.log('CHAOS INJECTED  public-s3');
  console.log(`Bucket          ${bucket}`);
  console.log('Change          Block Public Access disabled');
  console.log('Expected        AWS Config → NON_COMPLIANT → EventBridge → Step Functions');
  console.log('                → remediator restores Block Public Access');
  console.log('');
}
