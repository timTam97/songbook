import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface GithubDeployStackProps extends StackProps {
  /** "owner/repo" allowed to deploy. */
  repo: string;
  /** Only workflow runs on this branch can assume the role. */
  branch: string;
  /**
   * An account holds one GitHub OIDC provider. By default the existing one is
   * reused; set true only in an account that has none yet.
   */
  createProvider?: boolean;
}

/**
 * A role GitHub Actions assumes through OIDC (no stored AWS keys). It can do
 * nothing itself except assume the CDK bootstrap roles, which perform the deploy.
 */
export class GithubDeployStack extends Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubDeployStackProps) {
    super(scope, id, props);

    const provider = props.createProvider
      ? new iam.OpenIdConnectProvider(this, 'GithubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        })
      : iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GithubOidc',
          `arn:${this.partition}:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        );

    this.role = new iam.Role(this, 'DeployRole', {
      description: `GitHub Actions deploys of ${props.repo}@${props.branch}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.repo}:ref:refs/heads/${props.branch}`,
        },
      }),
    });

    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-*-${this.account}-*`],
        conditions: {
          StringEquals: { 'iam:ResourceTag/aws-cdk:bootstrap-role': ['deploy', 'file-publishing', 'lookup', 'image-publishing'] },
        },
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: this.role.roleArn });
  }
}
