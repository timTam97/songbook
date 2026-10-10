import { rmSync } from 'node:fs';
import { ADMIN_ROUTES } from '@songbook/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';
import { stageAuthDomain, stageAuthDomainPrefix } from '../lib/stage.ts';
import { certificateArn, siteStack, testRoot } from './helpers.ts';

afterAll(() => rmSync(testRoot, { recursive: true, force: true }));

const domain = { names: ['beta.songs.example.com'], certificateArn };
const beta = Template.fromStack(siteStack({ stage: 'beta', domain }));
const prod = Template.fromStack(siteStack({ stage: 'prod', domain: { names: ['songs.example.com', 'files.example.com'], certificateArn } }));

describe('the editors user pool', () => {
  it('has self sign-up off, MFA off, a 12-character minimum password, and survives a stack delete', () => {
    for (const template of [beta, prod]) {
      template.hasResource('AWS::Cognito::UserPool', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: Match.objectLike({
          AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
          MfaConfiguration: 'OFF',
          DeletionProtection: 'ACTIVE',
          UsernameAttributes: ['email'],
          Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
        }),
      });
    }
  });

  it('has an admins group and managed login', () => {
    beta.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'admins' });
    beta.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: 'example-auth', ManagedLoginVersion: 2 });
    beta.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 1);
  });

  it('lets the portal sign in with code + PKCE and no secret, back to its own hostnames only', () => {
    const client = Object.values(beta.findResources('AWS::Cognito::UserPoolClient'))[0].Properties;
    expect(client.GenerateSecret).toBe(false);
    expect(client.AllowedOAuthFlows).toEqual(['code']);
    expect(client.AllowedOAuthScopes).toEqual(['openid', 'email']);
    const callbacks = JSON.stringify(client.CallbackURLs);
    expect(callbacks).toContain('https://beta.songs.example.com/admin/callback');
    expect(callbacks).toContain('/admin/callback'); // and the distribution's own address
    expect(callbacks).toContain('http://localhost:5173/admin/callback');
    expect(client.AccessTokenValidity).toBe(60);
    expect(client.RefreshTokenValidity).toBe(1440);
  });

  it('allows no localhost callback in prod', () => {
    const client = Object.values(prod.findResources('AWS::Cognito::UserPoolClient'))[0].Properties;
    expect(JSON.stringify(client.CallbackURLs)).not.toContain('localhost');
    expect(JSON.stringify(client.CallbackURLs)).toContain('https://files.example.com/admin/callback');
  });
});

describe('the admin API', () => {
  it('has exactly the routes the handler serves, every one behind the JWT authorizer', () => {
    const routes = Object.values(beta.findResources('AWS::ApiGatewayV2::Route')).map((r) => r.Properties);
    expect(routes.map((r) => r.RouteKey).sort()).toEqual(ADMIN_ROUTES.map((r) => r.replace(' ', ' /api/admin')).sort());
    for (const route of routes) {
      expect(route.AuthorizationType, route.RouteKey).toBe('JWT');
      expect(route.AuthorizerId, route.RouteKey).toBeDefined();
    }
    beta.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: { Audience: [Match.anyValue()], Issuer: Match.anyValue() },
    });
  });

  it('is throttled', () => {
    beta.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
    });
  });

  it('is served by CloudFront under /api/*, never cached, with the viewer headers but not Host', () => {
    const dist = Object.values(beta.findResources('AWS::CloudFront::Distribution'))[0].Properties.DistributionConfig;
    const api = dist.CacheBehaviors.find((b: { PathPattern: string }) => b.PathPattern === '/api/*');
    expect(api).toBeDefined();
    expect(api.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // Managed-CachingDisabled
    expect(api.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac'); // Managed-AllViewerExceptHostHeader
    expect(api.AllowedMethods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'DELETE']));
    expect(api.ViewerProtocolPolicy).toBe('https-only');
    expect(api.FunctionAssociations).toBeUndefined();
  });

  it('lets the handler read and write songs, never scan, and invoke the publisher', () => {
    const policies = Object.values(beta.findResources('AWS::IAM::Policy')).filter((p) => p.Properties.PolicyName.startsWith('AdminHandler'));
    const actions = policies.flatMap((p) => p.Properties.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) => [s.Action].flat()));
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'lambda:InvokeFunction']));
    expect(actions).not.toContain('dynamodb:Scan');
  });
});

describe('the portal', () => {
  it('may call Cognito for its tokens, and nothing else off-site', () => {
    const csp = Object.values(beta.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0].Properties.ResponseHeadersPolicyConfig
      .SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    expect(csp).toContain("connect-src 'self' https://example-auth.auth.ap-southeast-2.amazoncognito.com;");
    expect(csp).toContain("script-src 'self';");
  });

  it('gets its sign-in settings from admin-config.json, written by the pages deployment', () => {
    const pages = Object.entries(beta.findResources('Custom::CDKBucketDeployment')).find(([id]) => id.startsWith('DeployPages'))!;
    expect(pages[1].Properties.SourceObjectKeys).toHaveLength(2);
    // The user pool and client IDs are filled in at deploy time.
    const markers = JSON.stringify(pages[1].Properties.SourceMarkers[1]);
    expect(markers).toMatch(/"Ref":"AdminUsers[0-9A-F]+"/);
    expect(markers).toMatch(/"Ref":"AdminUsersPortal[0-9A-F]+"/);
  });
});

describe('stageAuthDomainPrefix', () => {
  it('defaults per stage, takes an override, and rejects what Cognito would', () => {
    expect(stageAuthDomainPrefix('beta', {})).toBe('melbourne-songs-beta');
    expect(stageAuthDomainPrefix('prod', {})).toBe('melbourne-songs-prod');
    expect(stageAuthDomainPrefix('beta', { BETA_AUTH_DOMAIN_PREFIX: 'my-songs' })).toBe('my-songs');
    expect(() => stageAuthDomainPrefix('beta', { BETA_AUTH_DOMAIN_PREFIX: 'My_Songs' })).toThrow();
    expect(() => stageAuthDomainPrefix('prod', { SITE_AUTH_DOMAIN_PREFIX: 'songs-cognito' })).toThrow();
  });
});

describe('stageAuthDomain', () => {
  it('uses the prefix domain unless a custom hostname and certificate are both set', () => {
    expect(stageAuthDomain('beta', {})).toEqual({ prefix: 'melbourne-songs-beta' });
    // CI passes an unset secret as an empty string.
    expect(stageAuthDomain('prod', { SITE_AUTH_DOMAIN_NAME: '', SITE_AUTH_CERTIFICATE_ARN: '' })).toEqual({ prefix: 'melbourne-songs-prod' });
    expect(stageAuthDomain('beta', { BETA_AUTH_DOMAIN_NAME: ' Auth.Beta.Songs.Example.com ', BETA_AUTH_CERTIFICATE_ARN: certificateArn })).toEqual({
      name: 'auth.beta.songs.example.com',
      certificateArn,
    });
    // Each stage reads only its own settings.
    expect(stageAuthDomain('beta', { SITE_AUTH_DOMAIN_NAME: 'auth.songs.example.com', SITE_AUTH_CERTIFICATE_ARN: certificateArn })).toEqual({
      prefix: 'melbourne-songs-beta',
    });
    expect(() => stageAuthDomain('prod', { SITE_AUTH_DOMAIN_NAME: 'auth.songs.example.com' })).toThrow(/SITE_AUTH_CERTIFICATE_ARN/);
  });
});

describe('a custom sign-in domain', () => {
  const authDomain = { name: 'auth.beta.songs.example.com', certificateArn };
  const stack = siteStack({ stage: 'beta', domain, authDomain });
  const custom = Template.fromStack(stack);

  it('replaces the prefix domain, keeping managed login', () => {
    custom.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
    custom.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'auth.beta.songs.example.com',
      CustomDomainConfig: { CertificateArn: certificateArn },
      ManagedLoginVersion: 2,
    });
  });

  it('is the only off-site origin the portal may call, and the one it signs in on', () => {
    const csp = Object.values(custom.findResources('AWS::CloudFront::ResponseHeadersPolicy'))[0].Properties.ResponseHeadersPolicyConfig
      .SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    expect(csp).toContain("connect-src 'self' https://auth.beta.songs.example.com;");
    expect(stack.admin.portalConfig.authOrigin).toBe('https://auth.beta.songs.example.com');
  });

  it('outputs the CloudFront address to CNAME the hostname to; a prefix domain outputs none', () => {
    custom.hasOutput('AuthDomainTarget', { Value: { 'Fn::GetAtt': [Match.stringLikeRegexp('^AdminUsersDomain'), 'CloudFrontDistribution'] } });
    expect(Object.keys(beta.findOutputs('AuthDomainTarget'))).toHaveLength(0);
  });

  it('needs a certificate in us-east-1', () => {
    const elsewhere = { name: 'auth.example.com', certificateArn: certificateArn.replace('us-east-1', 'ap-southeast-2') };
    expect(() => siteStack({ authDomain: elsewhere })).toThrow(/us-east-1/);
  });
});
