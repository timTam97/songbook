/**
 * Editor sign-in: Cognito managed login, authorization code + PKCE, through
 * oidc-client-ts. Tokens live in sessionStorage, so closing the tab signs out.
 * The admin API is called with the ID token, which carries the editor's
 * email (shown in history) and the admins group.
 */
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

/** Written by the CDK app at deploy time (see infra/lib/admin.ts, PortalConfig). */
export interface PortalConfig {
  stage: string;
  region: string;
  userPoolId: string;
  clientId: string;
  issuer: string;
  authOrigin: string;
}

let config: Promise<PortalConfig> | undefined;
let manager: Promise<UserManager> | undefined;

export function portalConfig(): Promise<PortalConfig> {
  config ??= fetch('/admin-config.json', { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`Sign-in settings could not be loaded (error ${res.status}).`);
      return res.json() as Promise<PortalConfig>;
    })
    .catch((err: unknown) => {
      config = undefined;
      throw err;
    });
  return config;
}

export const callbackUrl = () => `${window.location.origin}/admin/callback`;
export const portalUrl = () => `${window.location.origin}/admin`;

export function userManager(): Promise<UserManager> {
  manager ??= portalConfig().then((cfg) => {
    const store = new WebStorageStateStore({ store: window.sessionStorage });
    return new UserManager({
      authority: cfg.issuer,
      client_id: cfg.clientId,
      redirect_uri: callbackUrl(),
      post_logout_redirect_uri: portalUrl(),
      response_type: 'code',
      scope: 'openid email',
      // Spelled out so no discovery request is needed: the CSP only allows Cognito's own domain.
      metadata: {
        issuer: cfg.issuer,
        authorization_endpoint: `${cfg.authOrigin}/oauth2/authorize`,
        token_endpoint: `${cfg.authOrigin}/oauth2/token`,
        revocation_endpoint: `${cfg.authOrigin}/oauth2/revoke`,
        userinfo_endpoint: `${cfg.authOrigin}/oauth2/userInfo`,
      },
      userStore: store,
      stateStore: store,
      loadUserInfo: false,
      // Refreshes the hour-long tokens with the refresh token (valid for a day).
      automaticSilentRenew: true,
      revokeTokenTypes: ['refresh_token'],
    });
  });
  return manager;
}

/** The signed-in editor, refreshing an expired session if it can. */
export async function currentUser(): Promise<User | null> {
  const mgr = await userManager();
  const user = await mgr.getUser();
  if (!user) return null;
  if (!user.expired) return user;
  try {
    return await mgr.signinSilent();
  } catch {
    await mgr.removeUser();
    return null;
  }
}

export async function signIn(returnTo = window.location.pathname + window.location.search): Promise<void> {
  const mgr = await userManager();
  await mgr.signinRedirect({ state: { returnTo } });
}

/** Completes the redirect back from Cognito; returns where the editor was going. */
export async function completeSignIn(): Promise<string> {
  const mgr = await userManager();
  const user = await mgr.signinRedirectCallback();
  const returnTo = (user.state as { returnTo?: string } | undefined)?.returnTo;
  return returnTo?.startsWith('/admin') && !returnTo.startsWith('/admin/callback') ? returnTo : '/admin';
}

/** Forget the tokens here, revoke the refresh token, and end the Cognito session. */
export async function signOut(): Promise<void> {
  const [mgr, cfg] = await Promise.all([userManager(), portalConfig()]);
  try {
    await mgr.revokeTokens(['refresh_token']);
  } catch {
    /* already expired or revoked */
  }
  await mgr.removeUser();
  // Cognito's logout endpoint takes client_id and logout_uri rather than the OIDC parameters.
  const params = new URLSearchParams({ client_id: cfg.clientId, logout_uri: portalUrl() });
  window.location.assign(`${cfg.authOrigin}/logout?${params}`);
}

export const emailOf = (user: User): string => String(user.profile.email ?? user.profile.sub);
