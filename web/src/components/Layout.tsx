import { Link, Outlet, ScrollRestoration } from 'react-router';
import { index } from '../lib/data.ts';
import { useTheme } from '../lib/prefs.ts';
import { NumberJump } from './NumberJump.tsx';

function ThemeToggle() {
  const [dark, toggle] = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-9 place-items-center rounded-md text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
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

export function Layout() {
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-stone-900 px-3 py-2 text-stone-50 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/90 backdrop-blur supports-[backdrop-filter]:bg-stone-50/75 dark:border-stone-800 dark:bg-stone-900/90 dark:supports-[backdrop-filter]:bg-stone-900/75">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
          <Link to="/" className="mr-auto font-serif text-lg font-semibold tracking-tight">
            {index.book.title}
          </Link>
          <NumberJump />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 pt-5 pb-20">
        <Outlet />
      </main>
      <footer className="no-print mx-auto max-w-3xl px-4 pb-10 text-sm text-stone-500 dark:text-stone-400">
        {index.songs.length} songs{index.book.released ? ` · released ${index.book.released}` : ''} ·{' '}
        <a href="/melbourne-songs.pdf" className="underline decoration-stone-300 underline-offset-2 hover:text-stone-900 dark:decoration-stone-600 dark:hover:text-stone-100">
          Download PDF
        </a>
      </footer>
      <ScrollRestoration />
    </>
  );
}
