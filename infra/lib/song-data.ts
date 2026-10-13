/**
 * The songbook's data in one stage: the table, the seed that fills it once,
 * and the publisher that turns it into songbook.json in the site bucket.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as triggers from 'aws-cdk-lib/triggers';
import { Construct } from 'constructs';
import type { Stage } from './stage.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The key the publisher writes and nothing else may: see SiteStack's DeployPages. */
export const SONGBOOK_KEY = 'songbook.json';

/**
 * A Lambda built from backend/src/<name>.ts: Node.js 22 on arm64, bundled
 * locally by esbuild (no Docker) with the pinned AWS SDK inside, so what the
 * tests ran is what runs.
 */
export function backendFunction(scope: Construct, id: string, name: string, props: Partial<NodejsFunctionProps> = {}): NodejsFunction {
  const logGroup = new logs.LogGroup(scope, `${id}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
  return new NodejsFunction(scope, id, {
    entry: path.join(REPO_ROOT, 'backend', 'src', `${name}.ts`),
    projectRoot: REPO_ROOT,
    depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: 512,
    timeout: Duration.seconds(30),
    logGroup,
    ...props,
    bundling: {
      format: OutputFormat.ESM,
      target: 'node22',
      minify: true,
      sourceMap: true,
      sourcesContent: false,
      mainFields: ['module', 'main'],
      externalModules: [],
      banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      ...props.bundling,
    },
  });
}

export interface SongDataProps {
  stage: Stage;
  bucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  /** A SeedFile (JSON) the seed imports into an empty table on the first deploy. */
  seedFile: string;
}

export class SongData extends Construct {
  readonly table: dynamodb.Table;
  readonly publisher: NodejsFunction;
  readonly seeder: NodejsFunction;
  /** Runs after the seed on deploy; the new index.html must not go live before it. */
  readonly published: triggers.Trigger;

  constructor(scope: Construct, id: string, props: SongDataProps) {
    super(scope, id);
    const { stage, bucket, distribution } = props;

    // Stateful: survives a stack delete or a bad refactor in both stages. Deleting beta's data is a manual step.
    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      timeToLiveAttribute: 'expiresAt',
      // The publisher rebuilds the whole book, so it only needs to know that something changed.
      stream: dynamodb.StreamViewType.KEYS_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const table = this.table;
    const tableActions = (...actions: string[]) =>
      new iam.PolicyStatement({ actions: actions.map((a) => `dynamodb:${a}`), resources: [table.tableArn] });

    // --- Seed -------------------------------------------------------------
    const seedAsset = new s3assets.Asset(this, 'SeedData', { path: props.seedFile });
    this.seeder = backendFunction(this, 'Seed', 'seed', {
      description: `Seeds the ${stage} songbook table once, from the seed asset`,
      timeout: Duration.minutes(5),
      environment: { TABLE_NAME: table.tableName, STAGE: stage, SEED_BUCKET: seedAsset.s3BucketName, SEED_KEY: seedAsset.s3ObjectKey },
    });
    seedAsset.grantRead(this.seeder);
    this.seeder.addToRolePolicy(tableActions('GetItem', 'PutItem'));
    // Only beta's seed can empty its table (npm run seed -- --reset).
    if (stage === 'beta') this.seeder.addToRolePolicy(tableActions('Scan', 'DeleteItem', 'BatchWriteItem'));

    // --- Publish ----------------------------------------------------------
    this.publisher = backendFunction(this, 'Publish', 'publish', {
      description: `Rebuilds ${SONGBOOK_KEY} for the ${stage} site from its table`,
      timeout: Duration.minutes(1),
      // One at a time, so two publishes never race to write an older book last.
      reservedConcurrentExecutions: 1,
      environment: { TABLE_NAME: table.tableName, BUCKET_NAME: bucket.bucketName, DISTRIBUTION_ID: distribution.distributionId },
    });
    this.publisher.addToRolePolicy(tableActions('GetItem', 'Query', 'UpdateItem'));
    this.publisher.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [bucket.arnForObjects(SONGBOOK_KEY)] }));
    this.publisher.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [Stack.of(this).formatArn({ service: 'cloudfront', region: '', resource: 'distribution', resourceName: distribution.distributionId })],
      }),
    );

    const failures = new sqs.Queue(this, 'PublishFailures', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    this.publisher.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        // A burst of saves (or the seed's hundreds of writes) becomes one publish.
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(5),
        retryAttempts: 3,
        onFailure: new SqsDlq(failures),
        // Song and book changes only: history, slugs, deleted copies and the publisher's own
        // BOOK/PUBLISH record never trigger a publish.
        filters: [
          lambda.FilterCriteria.filter({ dynamodb: { Keys: { pk: { S: lambda.FilterRule.isEqual('SONG') } } } }),
          lambda.FilterCriteria.filter({
            dynamodb: { Keys: { pk: { S: lambda.FilterRule.isEqual('BOOK') }, sk: { S: lambda.FilterRule.isEqual('META') } } },
          }),
        ],
      }),
    );

    // --- Deploy order: seed, then publish ------------------------------------
    // Both run on the first deploy and again whenever their code changes; the seed
    // is a no-op once the table holds a book.
    const seeded = new triggers.Trigger(this, 'SeedOnDeploy', { handler: this.seeder, timeout: Duration.minutes(5), executeAfter: [table] });
    this.published = new triggers.Trigger(this, 'PublishOnDeploy', { handler: this.publisher, timeout: Duration.minutes(2), executeAfter: [seeded] });
  }
}
