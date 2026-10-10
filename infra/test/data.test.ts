import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';
import { isCiOnMaster, resolveStage, stageDomain } from '../lib/stage.ts';
import { certificateArn, siteStack, testRoot } from './helpers.ts';

afterAll(() => rmSync(testRoot, { recursive: true, force: true }));

const prod = Template.fromStack(siteStack({ stage: 'prod' }));
const beta = Template.fromStack(siteStack({ stage: 'beta' }));

/** Statements of every IAM policy attached to the role of the function whose logical ID starts with `prefix`. */
function statementsFor(template: Template, prefix: string): Array<{ Action: string | string[]; Resource: unknown }> {
  const functions = template.findResources('AWS::Lambda::Function');
  const fnId = Object.keys(functions).find((id) => id.startsWith(prefix))!;
  const roleRef = functions[fnId].Properties.Role['Fn::GetAtt'][0];
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) => p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleRef))
    .flatMap((p) => p.Properties.PolicyDocument.Statement);
}
const actionsOf = (statements: Array<{ Action: string | string[] }>) => statements.flatMap((s) => [s.Action].flat()).sort();

describe('the prod stage after cutover', () => {
  it("keeps master's logical IDs for the bucket, distribution, headers policy, routing function and OAC", () => {
    // Taken from the live MelbourneSongsSite stack. A changed ID would make CloudFormation
    // replace the resource, and a new distribution would drop the domain aliases.
    const ids = Object.keys(prod.toJSON().Resources);
    expect(ids).toEqual(
      expect.arrayContaining([
        'SiteBucket397A1860',
        'Distribution830FAC52',
        'SecurityHeadersE66B69D3',
        'SpaRouting015DD2CD',
        'DistributionOrigin1S3OriginAccessControlEB606076',
      ]),
    );
  });

  it('keeps the distribution comment and sends no X-Robots-Tag', () => {
    prod.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({ Comment: 'Melbourne Songs' }) });
    const headers = Object.values(prod.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0];
    expect(headers.Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig).toBeUndefined();
  });
});

describe('stage guard', () => {
  const ciMaster = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/master' };

  it('builds prod only in CI on master, and beta everywhere else', () => {
    expect(resolveStage(ciMaster)).toBe('prod');
    expect(resolveStage({})).toBe('beta');
    expect(resolveStage({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/pull/4/merge' })).toBe('beta');
    expect(resolveStage({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/feat/dynamodb-admin' })).toBe('beta');
    expect(resolveStage({ GITHUB_REF: 'refs/heads/master' })).toBe('beta');
    expect(isCiOnMaster(ciMaster)).toBe(true);
  });

  it('refuses a request for prod outside CI on master', () => {
    expect(() => resolveStage({ SONGBOOK_STAGE: 'prod' })).toThrow(/only synthesized by CI on master/);
    expect(() => resolveStage({ SONGBOOK_STAGE: 'prod', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/pull/4/merge' })).toThrow();
    expect(resolveStage({ ...ciMaster, SONGBOOK_STAGE: 'prod' })).toBe('prod');
    expect(resolveStage({ ...ciMaster, SONGBOOK_STAGE: 'beta' })).toBe('beta');
    expect(() => resolveStage({ SONGBOOK_STAGE: 'staging' })).toThrow(/prod or beta/);
  });

  it("reads each stage's domain from its own settings, and needs SITE_NO_DOMAIN to go without", () => {
    const settings = {
      SITE_DOMAIN_NAME: 'songs.example.com,files.example.com',
      SITE_CERTIFICATE_ARN: certificateArn,
      BETA_DOMAIN_NAME: 'beta.songs.example.com',
      BETA_CERTIFICATE_ARN: certificateArn.replace('0000-0000-0000-000000000000', '1111-1111-1111-111111111111'),
    };
    expect(stageDomain('prod', settings)?.names).toEqual(['songs.example.com', 'files.example.com']);
    expect(stageDomain('beta', settings)).toEqual({ names: ['beta.songs.example.com'], certificateArn: settings.BETA_CERTIFICATE_ARN });
    expect(() => stageDomain('beta', { SITE_DOMAIN_NAME: 'x.example.com', SITE_CERTIFICATE_ARN: certificateArn })).toThrow(/BETA_DOMAIN_NAME/);
    expect(stageDomain('beta', { SITE_NO_DOMAIN: 'true' })).toBeUndefined();
  });
});

describe('the beta stage', () => {
  it('tells search engines not to index it', () => {
    beta.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CustomHeadersConfig: { Items: [{ Header: 'X-Robots-Tag', Value: 'noindex, nofollow', Override: true }] },
      }),
    });
  });
});

describe('the songbook table', () => {
  for (const [stage, template] of [
    ['prod', prod],
    ['beta', beta],
  ] as const) {
    it(`has PITR, deletion protection, TTL on expiresAt, a keys-only stream and RETAIN (${stage})`, () => {
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
      template.hasResource('AWS::DynamoDB::Table', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: Match.objectLike({
          BillingMode: 'PAY_PER_REQUEST',
          DeletionProtectionEnabled: true,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
          StreamSpecification: { StreamViewType: 'KEYS_ONLY' },
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
        }),
      });
    });
  }
});

describe('the publisher', () => {
  it('may write songbook.json and nothing else in the bucket', () => {
    const statements = statementsFor(beta, 'SongDataPublish');
    const s3 = statements.filter((s) => [s.Action].flat().some((a) => a.startsWith('s3:')));
    expect(s3).toHaveLength(1);
    expect(s3[0].Action).toBe('s3:PutObject');
    expect(JSON.stringify(s3[0].Resource)).toMatch(/\/songbook\.json"\]\]\}$/);
  });

  it('reads the table and records the publish, invalidates the distribution, and nothing more', () => {
    expect(actionsOf(statementsFor(beta, 'SongDataPublish'))).toEqual(
      expect.arrayContaining(['cloudfront:CreateInvalidation', 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem', 's3:PutObject']),
    );
    const writes = actionsOf(statementsFor(beta, 'SongDataPublish')).filter((a) => /dynamodb:(Put|Delete|BatchWrite|Scan)/.test(a));
    expect(writes).toEqual([]);
  });

  it('runs one at a time on Node.js 22 arm64', () => {
    beta.hasResourceProperties('AWS::Lambda::Function', {
      Description: Match.stringLikeRegexp('Rebuilds songbook.json'),
      ReservedConcurrentExecutions: 1,
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
    });
  });

  it('listens to song and book changes on the stream, batched, with a failure queue', () => {
    beta.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 100,
      MaximumBatchingWindowInSeconds: 5,
      MaximumRetryAttempts: 3,
      StartingPosition: 'LATEST',
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
      FilterCriteria: {
        Filters: [
          { Pattern: JSON.stringify({ dynamodb: { Keys: { pk: { S: ['SONG'] } } } }) },
          { Pattern: JSON.stringify({ dynamodb: { Keys: { pk: { S: ['BOOK'] }, sk: { S: ['META'] } } } }) },
        ],
      },
    });
  });
});

describe('the seed', () => {
  it('can empty the table only on beta', () => {
    expect(actionsOf(statementsFor(prod, 'SongDataSeed'))).not.toContain('dynamodb:Scan');
    expect(actionsOf(statementsFor(prod, 'SongDataSeed'))).not.toContain('dynamodb:BatchWriteItem');
    expect(actionsOf(statementsFor(beta, 'SongDataSeed'))).toEqual(expect.arrayContaining(['dynamodb:Scan', 'dynamodb:BatchWriteItem']));
  });

  it('knows its stage', () => {
    prod.hasResourceProperties('AWS::Lambda::Function', {
      Description: Match.stringLikeRegexp('Seeds the prod'),
      Environment: { Variables: Match.objectLike({ STAGE: 'prod' }) },
    });
  });
});

describe('bundling', () => {
  it('bundles the Lambdas locally with esbuild', () => {
    // A real synth: fails if esbuild is missing (the fallback is Docker) or a handler does not build.
    const template = Template.fromStack(siteStack({ stage: 'beta' }, new App()));
    template.resourceCountIs('Custom::Trigger', 2);
  }, 120_000);
});

describe('no personal details in the infrastructure code', () => {
  const infra = fileURLToPath(new URL('..', import.meta.url));
  const files = ['bin', 'lib'].flatMap((dir) => readdirSync(path.join(infra, dir)).map((f) => path.join(infra, dir, f)));
  files.push(path.join(infra, 'cdk.json'));

  it('has no certificate ARNs or hostnames other than placeholders and AWS endpoints', () => {
    const allowed = /(^|\.)(example\.com|amazonaws\.com|cloudfront\.net|github\.com|githubusercontent\.com|amazoncognito\.com)$/;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/arn:aws:acm:[a-z0-9-]+:\d{12}/);
      const hosts = text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|au|io|dev|app)\b/g) ?? [];
      expect(
        hosts.filter((h) => !allowed.test(h)),
        file,
      ).toEqual([]);
    }
  });
});
