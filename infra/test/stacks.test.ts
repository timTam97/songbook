import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';
import { GithubDeployStack } from '../lib/github-deploy-stack.ts';
import { SiteStack } from '../lib/site-stack.ts';

const env = { account: '123456789012', region: 'ap-southeast-2' };

// A stand-in for web/dist so the tests do not depend on a prior build.
const siteDir = mkdtempSync(path.join(tmpdir(), 'songbook-site-'));
mkdirSync(path.join(siteDir, 'assets'));
writeFileSync(path.join(siteDir, 'index.html'), '<!doctype html>');
writeFileSync(path.join(siteDir, 'assets', 'index-abc123.js'), '');
afterAll(() => rmSync(siteDir, { recursive: true, force: true }));

describe('SiteStack', () => {
  const app = new App();
  const template = Template.fromStack(new SiteStack(app, 'Site', { env, siteDir }));

  it('keeps the bucket private and TLS-only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
          Match.objectLike({ Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject' }),
        ]),
      },
    });
  });

  it('serves over HTTPS through CloudFront with origin access control', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          FunctionAssociations: [Match.objectLike({ EventType: 'viewer-request' })],
        }),
      }),
    });
  });

  it('rewrites app routes, but not files, to index.html', () => {
    const fn = Object.values(template.findResources('AWS::CloudFront::Function'))[0];
    const code: string = fn.Properties.FunctionCode;
    const handler = new Function(`${code}; return handler;`)() as (e: unknown) => { uri: string };
    const route = (uri: string) => handler({ request: { uri } }).uri;
    expect(route('/')).toBe('/index.html');
    expect(route('/songs/42/because-he-lives')).toBe('/index.html');
    expect(route('/42')).toBe('/index.html');
    expect(route('/assets/index-abc123.js')).toBe('/assets/index-abc123.js');
    expect(route('/melbourne-songs.pdf')).toBe('/melbourne-songs.pdf');
  });

  it('sends security headers including a strict CSP', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: Match.objectLike({ ContentSecurityPolicy: Match.stringLikeRegexp("script-src 'self'") }),
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000 }),
        }),
      }),
    });
  });

  it('uploads immutable assets before pages, and invalidates only with the pages', () => {
    const deployments = template.findResources('Custom::CDKBucketDeployment');
    const entries = Object.entries(deployments);
    expect(entries).toHaveLength(2);
    const assets = entries.find(([id]) => id.startsWith('DeployAssets'))!;
    const pages = entries.find(([id]) => id.startsWith('DeployPages'))!;
    expect(assets[1].Properties.SystemMetadata['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(assets[1].Properties.DestinationBucketKeyPrefix).toBe('assets/');
    expect(assets[1].Properties.DistributionId).toBeUndefined();
    expect(pages[1].Properties.SystemMetadata['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(pages[1].Properties.DistributionPaths).toEqual(['/*']);
    expect(JSON.stringify(pages[1].DependsOn ?? [])).toContain('DeployAssets');
  });
});

describe('GithubDeployStack', () => {
  const synth = (createProvider: boolean) =>
    Template.fromStack(new GithubDeployStack(new App(), 'Deploy', { env, repo: 'timTam97/songbook', branch: 'master', createProvider }));

  it('trusts only the songbook repo on master', () => {
    synth(false).hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': 'repo:timTam97/songbook:ref:refs/heads/master',
              },
            },
          }),
        ],
      },
    });
  });

  it('can only assume the CDK bootstrap roles', () => {
    const template = synth(false);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: ['sts:AssumeRole', 'sts:TagSession'],
            Resource: Match.anyValue(),
          }),
        ],
      },
    });
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    expect(policies).toHaveLength(1);
    expect(policies[0].Properties.PolicyDocument.Statement).toHaveLength(1);
  });

  it('reuses the account OIDC provider by default and can create one', () => {
    synth(false).resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 0);
    synth(true).resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 1);
  });
});
