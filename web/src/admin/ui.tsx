/** Small shared pieces of the admin portal's UI. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api.ts';

export const button = {
  primary:
    'inline-flex h-9 items-center justify-center rounded-md bg-stone-900 px-4 text-sm font-medium text-stone-50 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300 dark:disabled:hover:bg-stone-100',
  secondary:
    'inline-flex h-9 items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800',
  danger:
    'inline-flex h-9 items-center justify-center rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:bg-stone-900 dark:text-red-300 dark:hover:bg-red-950',
  link: 'text-sm font-medium text-stone-700 underline decoration-stone-300 underline-offset-2 hover:text-stone-950 dark:text-stone-300 dark:decoration-stone-600 dark:hover:text-stone-50',
};

export const input =
  'h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-sm placeholder:text-stone-400 aria-invalid:border-red-500 dark:border-stone-700 dark:bg-stone-950';

/** "3 minutes ago", "yesterday", or a date, for edit times. */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const s = Math.round((now - then) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  return new Date(then).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Melbourne' });
}

export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Melbourne' });

export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success'; children: ReactNode }) {
  const tone = {
    error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
    info: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
      {children}
    </div>
  );
}

export interface Async<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` on mount and whenever `deps` change; `reload` runs it again. Stale results are dropped. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const run = useRef(0);
  const go = useCallback(load, deps);
  const reload = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    go().then(
      (data) => id === run.current && setState({ data, loading: false }),
      (error: unknown) => id === run.current && setState({ error, loading: false }),
    );
  }, [go]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

/** A load failure, unless it is the redirect to sign in (which says so itself). */
export function LoadFailure({ error, retry }: { error: unknown; retry: () => void }) {
  if (error instanceof ApiError && error.status === 401) return <p className="text-stone-500">{error.message}</p>;
  return (
    <Alert>
      {messageOf(error)}{' '}
      <button type="button" className="font-medium underline" onClick={retry}>
        Try again
      </button>
    </Alert>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="mr-auto font-serif text-2xl font-semibold tracking-tight">{children}</h1>
      {actions}
    </div>
  );
}

/** Sets the tab title for an admin page. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Songbook admin`;
  }, [title]);
}
