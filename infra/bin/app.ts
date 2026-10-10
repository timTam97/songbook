import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';
import { texSeed } from '../../web/parser/seed.ts';
import { GithubDeployStack } from '../lib/github-deploy-stack.ts';
import { resolveSeedFile } from '../lib/seed-file.ts';
import { SiteStack } from '../lib/site-stack.ts';
import { resolveStage, STACK_NAMES, stageAuthDomainPrefix, stageDomain } from '../lib/stage.ts';

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

// prod only in CI on master; beta everywhere else (see lib/stage.ts).
const stage = resolveStage(process.env);

const repo: string = app.node.tryGetContext('githubRepo');
const branch: string = app.node.tryGetContext('githubBranch');
// Accounts hold a single GitHub OIDC provider; reuse it unless told to create one.
const createProvider = String(app.node.tryGetContext('createGithubOidcProvider')) === 'true';

new SiteStack(app, STACK_NAMES[stage], {
  env,
  stage,
  siteDir,
  domain: stageDomain(stage, process.env),
  // The seed for the stage's empty table: SEED_FILE (the frozen seed after the
  // LaTeX retirement, or an export), otherwise melbourne-songs.tex parsed now.
  seedFile: resolveSeedFile(process.env.SEED_FILE, texSeed),
  authDomainPrefix: stageAuthDomainPrefix(stage, process.env),
  description: stage === 'prod' ? 'Melbourne Songs web app (S3 + CloudFront)' : `Melbourne Songs web app, ${stage} stage (S3 + CloudFront + DynamoDB)`,
  tags: { stage },
});

new GithubDeployStack(app, 'MelbourneSongsGithubDeploy', {
  env,
  repo,
  branch,
  createProvider,
  description: `GitHub Actions OIDC deploy role for ${repo}`,
});

Tags.of(app).add('project', 'melbourne-songs');
