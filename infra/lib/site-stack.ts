import path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface SiteDomain {
  /** Hostname the site is served on. */
  name: string;
  /** ACM certificate in us-east-1 that covers `name`. */
  certificateArn: string;
}

export interface SiteStackProps extends StackProps {
  /** Directory holding the built web app (web/dist). */
  siteDir: string;
  /** Custom domain. Omit to serve only on the *.cloudfront.net address. */
  domain?: SiteDomain;
}

/**
 * Serves index.html for app routes (/songs/42/..., /42) while real files
 * (/assets/x.js, /melbourne-songs.pdf) pass through untouched.
 */
const SPA_ROUTING = `
function handler(event) {
  var request = event.request;
  var last = request.uri.split('/').pop();
  if (last.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}`;

export class SiteStack extends Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    // Everything in the bucket is rebuilt from the repo on each deploy, so it is safe to delete with the stack.
    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            // React sets the lyric size through a style attribute.
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
          override: true,
        },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
    });

    const routing = new cloudfront.Function(this, 'SpaRouting', {
      code: cloudfront.FunctionCode.fromInline(SPA_ROUTING),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Rewrite app routes to /index.html',
    });

    const { domain } = props;
    if (domain && !/^arn:aws:acm:us-east-1:\d{12}:certificate\/[\w-]+$/.test(domain.certificateArn)) {
      throw new Error('The CloudFront certificate must be an ACM certificate ARN in us-east-1.');
    }

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Melbourne Songs',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // The audience is in Australia, which only PRICE_CLASS_ALL covers.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      // CloudFront only applies a TLS minimum with a custom certificate.
      ...(domain
        ? {
            domainNames: [domain.name],
            certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', domain.certificateArn),
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
        functionAssociations: [{ function: routing, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
    });

    // Hashed build assets never change: cache for a year. Old ones are kept
    // (prune: false) so a browser holding the previous index.html still works.
    const assets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(path.join(props.siteDir, 'assets'))],
      destinationBucket: bucket,
      destinationKeyPrefix: 'assets/',
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
    });

    // Everything else (index.html, the PDF, ...) must pick up new songs immediately.
    const pages = new s3deploy.BucketDeployment(this, 'DeployPages', {
      sources: [s3deploy.Source.asset(props.siteDir, { exclude: ['assets'] })],
      destinationBucket: bucket,
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=0, must-revalidate')],
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
    // New index.html must never reference assets that are not uploaded yet.
    pages.node.addDependency(assets);

    new CfnOutput(this, 'SiteUrl', { value: `https://${this.distribution.distributionDomainName}` });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
  }
}
