import { Link, Outlet, ScrollRestoration } from 'react-router';
import { useSongData } from '../lib/data.ts';
import { useTheme } from '../lib/prefs.ts';
import { NumberJump } from './NumberJump.tsx';

function ThemeToggle() {
  const [dark, toggle] = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-11 place-items-center rounded-md text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

const BETA = import.meta.env.VITE_STAGE === 'beta';

/** "10 October 2026" in Melbourne time, from the book's ISO updatedAt. */
export function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' });
}

export function Layout() {
  const { index } = useSongData();
  const { book } = index;
  const dated = book.updatedAt ? ` · updated ${formatUpdated(book.updatedAt)}` : book.released ? ` · released ${book.released}` : '';
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-stone-900 px-3 py-2 text-stone-50 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/95 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
        <div className="px-safe mx-auto flex max-w-3xl items-center gap-2 py-1">
          <Link to="/" className="inline-flex min-h-11 items-center font-serif text-lg font-semibold tracking-tight">
            {book.title}
          </Link>
          {BETA && (
            <span
              title="A test copy of the site. Changes here don't appear on the live site."
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-900 uppercase dark:bg-amber-900/60 dark:text-amber-100"
            >
              Beta
            </span>
          )}
          <span className="mr-auto" />
          <NumberJump />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="px-safe mx-auto max-w-3xl pt-5 pb-20">
        <Outlet />
      </main>
      <footer className="no-print px-safe mx-auto max-w-3xl pb-10 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
        {index.songs.length} songs{dated} ·{' '}
        {/* The vertical padding only widens the tap area; inline padding doesn't move the text. */}
        <a
          href="/melbourne-songs.pdf"
          title="The PDF as it was last printed. Songs added or changed since then aren't in it, and its numbers may differ."
          className="py-3.5 underline decoration-stone-300 underline-offset-2 hover:text-stone-900 dark:decoration-stone-600 dark:hover:text-stone-100"
        >
          Printed edition (11 April 2026)
        </a>{' '}
        (PDF, without later changes)
      </footer>
      <ScrollRestoration />
    </>
  );
}
