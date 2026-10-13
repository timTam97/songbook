/**
 * The admin portal's backend in one stage: a Cognito user pool for the
 * editors, and the admin API (HTTP API + one Lambda) that CloudFront serves
 * under /api/* on the site's own hostnames, so the portal needs no CORS.
 */
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import { ADMIN_API_PREFIX, ADMIN_GROUP, ADMIN_ROUTES } from '@songbook/core';
import { Construct } from 'constructs';
import { LOGIN_BRANDING_SETTINGS, loginBrandingAssets } from './login-branding.ts';
import { backendFunction } from './song-data.ts';
import type { AuthDomain, Stage } from './stage.ts';

/** The portal's own URLs on a hostname: where Cognito sends the browser back after sign-in and sign-out. */
export const adminUrls = (origin: string) => ({ callback: `${origin}/admin/callback`, logout: `${origin}/admin` });

/** The Cognito managed-login origin, which the CSP must let the portal call (token exchange). */
export const authOrigin = (domain: AuthDomain, region: string) =>
  'name' in domain ? `https://${domain.name}` : `https://${domain.prefix}.auth.${region}.amazoncognito.com`;

/** The vite dev server, allowed as a sign-in callback on beta only (see README, "Admin portal"). */
export const LOCAL_DEV_ORIGIN = 'http://localhost:5173';

export interface AdminProps {
  stage: Stage;
  distribution: cloudfront.Distribution;
  /** The stage's custom hostnames, if any. Its *.cloudfront.net address is always allowed too. */
  hostnames: string[];
  table: dynamodb.ITable;
  publisher: lambda.IFunction;
  /** Where managed login is hosted (see stageAuthDomain). */
  authDomain: AuthDomain;
  responseHeadersPolicy: cloudfront.IResponseHeadersPolicy;
}

/** What the portal needs to sign in, published as /admin-config.json at deploy time. */
export interface PortalConfig {
  stage: Stage;
  region: string;
  userPoolId: string;
  clientId: string;
  issuer: string;
  authOrigin: string;
}

export class Admin extends Construct {
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly api: apigwv2.HttpApi;
  readonly handler: lambda.IFunction;
  readonly portalConfig: PortalConfig;
  /** The CloudFront address Cognito assigns a custom sign-in domain: its DNS CNAME target. */
  readonly authDomainTarget?: string;

  constructor(scope: Construct, id: string, props: AdminProps) {
    super(scope, id);
    const { stage, distribution } = props;
    const stack = Stack.of(this);

    // --- Who can sign in --------------------------------------------------
    // Editors are added by hand (README); there is no sign-up. MFA is off by choice: the blast
    // radius is song content, which history and point-in-time recovery can restore.
    this.userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: `melbourne-songs-${stage}-editors`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Managed login needs Essentials, which is free at this size.
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      userInvitation: {
        emailSubject: 'Your Melbourne Songs editor account',
        emailBody: 'Sign in to the Melbourne Songs admin portal with {username} and the temporary password {####}. You will be asked to choose a new one.',
      },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: ADMIN_GROUP,
      description: 'May edit the songbook through the admin portal',
    });
    // A custom hostname needs a us-east-1 certificate (Cognito fronts it with CloudFront) and a
    // parent domain that resolves. Switching between prefix and custom replaces the domain
    // resource; a pool may hold one of each, so the old one keeps working until the swap.
    const { authDomain } = props;
    if ('name' in authDomain && !/^arn:aws:acm:us-east-1:\d{12}:certificate\/[\w-]+$/.test(authDomain.certificateArn)) {
      throw new Error('The sign-in domain certificate must be an ACM certificate ARN in us-east-1.');
    }
    const domain = this.userPool.addDomain('Domain', {
      ...('name' in authDomain
        ? {
            customDomain: {
              domainName: authDomain.name,
              certificate: acm.Certificate.fromCertificateArn(this, 'AuthCertificate', authDomain.certificateArn),
            },
          }
        : { cognitoDomain: { domainPrefix: authDomain.prefix } }),
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    if ('name' in authDomain) this.authDomainTarget = domain.cloudFrontEndpoint;

    const origins_ = [...props.hostnames.map((h) => `https://${h}`), `https://${distribution.distributionDomainName}`];
    if (stage === 'beta') origins_.push(LOCAL_DEV_ORIGIN);
    this.client = this.userPool.addClient('Portal', {
      userPoolClientName: 'admin-portal',
      // A browser app: public client, authorization code + PKCE.
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: origins_.map((o) => adminUrls(o).callback),
        logoutUrls: origins_.map((o) => adminUrls(o).logout),
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
    });
    // The sign-in pages wear the site's colours and logo (login-branding.ts).
    new cognito.CfnManagedLoginBranding(this, 'LoginBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.client.userPoolClientId,
      useCognitoProvidedValues: false,
      settings: LOGIN_BRANDING_SETTINGS,
      assets: loginBrandingAssets(),
    });

    // --- The API ------------------------------------------------------------
    const table = props.table;
    this.handler = backendFunction(this, 'Handler', 'admin', {
      description: `Admin API for the ${stage} songbook`,
      environment: { TABLE_NAME: table.tableName, PUBLISH_FUNCTION_NAME: props.publisher.functionName },
    });
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['GetItem', 'Query', 'PutItem', 'UpdateItem', 'DeleteItem', 'ConditionCheckItem', 'BatchWriteItem'].map((a) => `dynamodb:${a}`),
        resources: [table.tableArn],
      }),
    );
    props.publisher.grantInvoke(this.handler);

    this.api = new apigwv2.HttpApi(this, 'Api', {
      apiName: `melbourne-songs-${stage}-admin`,
      description: `Melbourne Songs admin API (${stage})`,
      createDefaultStage: false,
    });
    // Caps both abuse and cost: an editor never needs more.
    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 5, burstLimit: 10 },
    });
    const issuer = `https://cognito-idp.${stack.region}.${stack.urlSuffix}/${this.userPool.userPoolId}`;
    const authorizer = new HttpJwtAuthorizer('Editors', issuer, { jwtAudience: [this.client.userPoolClientId] });
    const integration = new HttpLambdaIntegration('Handler', this.handler);
    for (const route of ADMIN_ROUTES) {
      const [method, path] = route.split(' ') as [keyof typeof apigwv2.HttpMethod, string];
      this.api.addRoutes({ path: `${ADMIN_API_PREFIX}${path}`, methods: [apigwv2.HttpMethod[method]], integration, authorizer });
    }

    // Same origin as the app: /api/* on the site's hostnames goes to the API, never cached.
    distribution.addBehavior('/api/*', new origins.HttpOrigin(`${this.api.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`), {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: props.responseHeadersPolicy,
      compress: true,
    });

    this.portalConfig = {
      stage,
      region: stack.region,
      userPoolId: this.userPool.userPoolId,
      clientId: this.client.userPoolClientId,
      issuer,
      authOrigin: authOrigin(authDomain, stack.region),
    };
  }
}
