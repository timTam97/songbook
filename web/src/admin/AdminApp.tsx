/**
 * The admin portal at /admin: a lazily loaded chunk with its own routes, so
 * the public pages never download it (or the sign-in library). It works
 * without songbook.json; everything comes from the admin API.
 */
import type { User } from 'oidc-client-ts';
import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router';
import { completeSignIn, currentUser, emailOf, signIn, signOut } from './auth.ts';
import { BookSettings } from './BookSettings.tsx';
import { DeletedList } from './DeletedList.tsx';
import { Editor } from './Editor.tsx';
import { History } from './History.tsx';
import { SongList } from './SongList.tsx';
import { Alert, button, messageOf } from './ui.tsx';

const BETA = import.meta.env.VITE_STAGE === 'beta';

/** Keep the portal out of search results, whatever headers the stage sends. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    completeSignIn().then(
      (to) => !cancelled && navigate(to, { replace: true }),
      (err: unknown) => !cancelled && setError(messageOf(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  if (!error) return <p className="text-stone-500">Signing in…</p>;
  return (
    <div className="space-y-4">
      <Alert>Sign-in did not complete: {error}</Alert>
      <button type="button" className={button.primary} onClick={() => signIn('/admin')}>
        Sign in again
      </button>
    </div>
  );
}

function SignedOut() {
  const [error, setError] = useState<string>();
  return (
    <div className="mx-auto max-w-sm py-12 text-center">
      <h1 className="font-serif text-2xl font-semibold">Songbook admin</h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400">Sign in to add and edit songs.</p>
      <button type="button" className={`${button.primary} mt-6`} onClick={() => signIn().catch((err: unknown) => setError(messageOf(err)))}>
        Sign in
      </button>
      {error && (
        <div className="mt-4 text-left">
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 text-sm font-medium ${isActive ? 'bg-stone-200 text-stone-950 dark:bg-stone-800 dark:text-stone-50' : 'text-stone-600 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-50'}`;

function Shell({ user }: { user: User }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/95 dark:border-stone-800 dark:bg-stone-900/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <Link to="/admin" className="font-serif text-lg font-semibold tracking-tight">
            Songbook admin
          </Link>
          {BETA && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 uppercase dark:bg-amber-900/60 dark:text-amber-100">Beta</span>}
          <nav aria-label="Admin" className="flex items-center gap-1">
            <NavLink to="/admin" end className={navLink}>
              Songs
            </NavLink>
            <NavLink to="/admin/deleted" className={navLink}>
              Recently deleted
            </NavLink>
            <NavLink to="/admin/book" className={navLink}>
              Book
            </NavLink>
          </nav>
          <span className="ml-auto truncate text-sm text-stone-500 dark:text-stone-400">{emailOf(user)}</span>
          <a href="/" className={button.link}>
            View site
          </a>
          <button type="button" className={button.link} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pt-5 pb-20">
        <Routes>
          <Route index element={<SongList />} />
          <Route path="songs/new" element={<Editor />} />
          <Route path="songs/:id" element={<Editor />} />
          <Route path="songs/:id/history" element={<History />} />
          <Route path="deleted" element={<DeletedList />} />
          <Route path="book" element={<BookSettings />} />
          <Route path="*" element={<p>No such admin page. <Link to="/admin" className={button.link}>Back to the songs</Link></p>} />
        </Routes>
      </main>
    </>
  );
}

export function AdminApp() {
  useNoIndex();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  const onCallback = window.location.pathname === '/admin/callback';

  useEffect(() => {
    if (onCallback) return;
    currentUser().then(setUser, (err: unknown) => setError(messageOf(err)));
  }, [onCallback]);

  if (onCallback) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-12">
        <Routes>
          <Route path="callback" element={<Callback />} />
        </Routes>
      </main>
    );
  }
  if (error) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-12">
        <Alert>{error}</Alert>
      </main>
    );
  }
  if (user === undefined) return <p className="p-8 text-stone-500">Loading…</p>;
  if (user === null) return <SignedOut />;
  return <Shell user={user} />;
}
