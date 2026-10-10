/**
 * Which environment the CDK app builds. Production is only ever synthesized
 * by CI on master, so nothing run from a branch or a laptop can deploy it.
 */
import { parseDomainNames, type SiteDomain } from './site-stack.ts';

export type Stage = 'prod' | 'beta';

export const STACK_NAMES: Record<Stage, string> = { prod: 'MelbourneSongsSite', beta: 'MelbourneSongsBeta' };

type Env = Record<string, string | undefined>;

/** True only in GitHub Actions on a push (or manual run) of master. */
export const isCiOnMaster = (env: Env): boolean => env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF === 'refs/heads/master';

/**
 * prod in CI on master, beta everywhere else. SONGBOOK_STAGE can ask for
 * beta explicitly; asking for prod anywhere but CI on master is an error.
 */
export function resolveStage(env: Env): Stage {
  const requested = env.SONGBOOK_STAGE?.trim();
  if (requested && requested !== 'prod' && requested !== 'beta') throw new Error(`SONGBOOK_STAGE must be prod or beta, not "${requested}".`);
  if (requested === 'prod' && !isCiOnMaster(env)) {
    throw new Error('The prod stage is only synthesized by CI on master. Deploy beta from here (npm run deploy:beta).');
  }
  if (requested) return requested as Stage;
  return isCiOnMaster(env) ? 'prod' : 'beta';
}

/**
 * Each stage's hostnames and certificate come from the environment (CI
 * secrets or infra/.env.local), never from git: SITE_* for prod, BETA_* for
 * beta. Without them a deploy would detach the domain, so serving on the
 * *.cloudfront.net address alone must be asked for with SITE_NO_DOMAIN=true.
 */
export function stageDomain(stage: Stage, env: Env): SiteDomain | undefined {
  const prefix = stage === 'prod' ? 'SITE' : 'BETA';
  const names = parseDomainNames(env[`${prefix}_DOMAIN_NAME`]);
  const certificateArn = env[`${prefix}_CERTIFICATE_ARN`]?.trim();
  if (names.length && certificateArn) return { names, certificateArn };
  if (env.SITE_NO_DOMAIN === 'true') return undefined;
  throw new Error(
    `Set ${prefix}_DOMAIN_NAME and ${prefix}_CERTIFICATE_ARN (infra/.env.local or CI secrets), ` +
      'or SITE_NO_DOMAIN=true to deploy without a custom domain.',
  );
}

/**
 * The stage's Cognito domain prefix (<prefix>.auth.<region>.amazoncognito.com),
 * from SITE_AUTH_DOMAIN_PREFIX / BETA_AUTH_DOMAIN_PREFIX, defaulting to
 * melbourne-songs-<stage>. It must be unique among all Cognito users in the region.
 */
export function stageAuthDomainPrefix(stage: Stage, env: Env): string {
  const name = `${stage === 'prod' ? 'SITE' : 'BETA'}_AUTH_DOMAIN_PREFIX`;
  const prefix = env[name]?.trim() || `melbourne-songs-${stage}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(prefix) || /aws|amazon|cognito/.test(prefix)) {
    throw new Error(`${name} must be lowercase letters, digits and hyphens, and may not contain "aws", "amazon" or "cognito".`);
  }
  return prefix;
}
