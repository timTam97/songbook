import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';
import { GithubDeployStack } from '../lib/github-deploy-stack.ts';
import { SiteStack, type SiteDomain } from '../lib/site-stack.ts';

// Local, gitignored settings (see README). CI passes the same variables from repository secrets.
const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const app = new App();
const siteDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (!existsSync(`${siteDir}/index.html`)) {
  throw new Error(`No built site in ${siteDir}. Run "npm run build" at the repo root first.`);
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

/**
 * The custom domain lives outside the repo on purpose. Deploying without it
 * would detach the domain from the live site, so that has to be asked for
 * explicitly with SITE_NO_DOMAIN=true (CI does this for synth-only checks).
 */
function siteDomain(): SiteDomain | undefined {
  const name = process.env.SITE_DOMAIN_NAME?.trim();
  const certificateArn = process.env.SITE_CERTIFICATE_ARN?.trim();
  if (name && certificateArn) return { name, certificateArn };
  if (process.env.SITE_NO_DOMAIN === 'true') return undefined;
  throw new Error(
    'Set SITE_DOMAIN_NAME and SITE_CERTIFICATE_ARN (infra/.env.local or CI secrets), ' +
      'or SITE_NO_DOMAIN=true to deploy without a custom domain.',
  );
}

const repo: string = app.node.tryGetContext('githubRepo');
const branch: string = app.node.tryGetContext('githubBranch');
// Accounts hold a single GitHub OIDC provider; reuse it unless told to create one.
const createProvider = String(app.node.tryGetContext('createGithubOidcProvider')) === 'true';

new SiteStack(app, 'MelbourneSongsSite', {
  env,
  siteDir,
  domain: siteDomain(),
  description: 'Melbourne Songs web app (S3 + CloudFront)',
});

new GithubDeployStack(app, 'MelbourneSongsGithubDeploy', {
  env,
  repo,
  branch,
  createProvider,
  description: `GitHub Actions OIDC deploy role for ${repo}`,
});

Tags.of(app).add('project', 'melbourne-songs');
