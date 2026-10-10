/** The admin API client: same origin, JSON, the editor's ID token as a bearer token. */
import { ADMIN_API_PREFIX, type ApiErrorBody, type ApiErrorCode, type FieldError } from '@songbook/core';
import { currentUser, signIn, userManager } from './auth.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
  get code(): ApiErrorCode {
    return this.body.error;
  }
  get fieldErrors(): FieldError[] {
    return this.body.errors ?? [];
  }
}

async function send(method: string, path: string, body: unknown, token: string): Promise<Response> {
  return fetch(`${ADMIN_API_PREFIX}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let user = await currentUser();
  if (!user?.id_token) {
    await signIn();
    throw new ApiError(401, { error: 'forbidden', message: 'Signing in…' });
  }
  let res: Response;
  try {
    res = await send(method, path, body, user.id_token);
    if (res.status === 401) {
      // The token was refused (revoked, or expired in flight): refresh once, then sign in again.
      user = await (await userManager()).signinSilent().catch(() => null);
      if (!user?.id_token) {
        await signIn();
        throw new ApiError(401, { error: 'forbidden', message: 'Your session ended. Signing in again…' });
      }
      res = await send(method, path, body, user.id_token);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, { error: 'internal', message: 'The server could not be reached. Check your connection; nothing was saved.' });
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const fallback: ApiErrorBody = { error: res.status === 403 ? 'forbidden' : 'internal', message: `The server answered with error ${res.status}.` };
    throw new ApiError(res.status, (parsed as ApiErrorBody | undefined)?.message ? (parsed as ApiErrorBody) : fallback);
  }
  return parsed as T;
}
