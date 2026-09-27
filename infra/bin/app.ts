import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';
import { GithubDeployStack } from '../lib/github-deploy-stack.ts';
import { SiteStack } from '../lib/site-stack.ts';

const app = new App();
const siteDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (!existsSync(`${siteDir}/index.html`)) {
  throw new Error(`No built site in ${siteDir}. Run "npm run build" at the repo root first.`);
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

const repo: string = app.node.tryGetContext('githubRepo');
const branch: string = app.node.tryGetContext('githubBranch');
// Accounts hold a single GitHub OIDC provider; reuse it unless told to create one.
const createProvider = String(app.node.tryGetContext('createGithubOidcProvider')) === 'true';

new SiteStack(app, 'MelbourneSongsSite', { env, siteDir, description: 'Melbourne Songs web app (S3 + CloudFront)' });

new GithubDeployStack(app, 'MelbourneSongsGithubDeploy', {
  env,
  repo,
  branch,
  createProvider,
  description: `GitHub Actions OIDC deploy role for ${repo}`,
});

Tags.of(app).add('project', 'melbourne-songs');
