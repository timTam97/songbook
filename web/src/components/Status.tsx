import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { SongbookLoadError } from '../lib/data.ts';

const TITLE = 'Melbourne Songs';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 pt-16 pb-20 text-center">
      <p className="font-serif text-lg font-semibold tracking-tight">{TITLE}</p>
      {children}
    </main>
  );
}

/** Shown while the book downloads on the first visit. */
export function Loading() {
  return (
    <Frame>
      <p role="status" className="mt-6 text-stone-500 dark:text-stone-400">
        Loading hymns…
      </p>
    </Frame>
  );
}

/** The book could not be loaded (offline, a failed deploy, an out-of-date page), or a page crashed. */
export function LoadError() {
  const error = useRouteError();
  useEffect(() => {
    document.title = `Unavailable · ${TITLE}`;
    if (!(error instanceof SongbookLoadError)) console.error(error);
  }, [error]);
  const message = error instanceof SongbookLoadError ? error.message : 'Something went wrong showing this page.';
  return (
    <Frame>
      <h1 className="mt-6 font-serif text-2xl font-semibold">The hymns aren’t available right now</h1>
      <p role="alert" className="mt-2 text-stone-600 dark:text-stone-400">
        {message}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-block rounded-md bg-stone-900 px-4 py-2 text-stone-50 hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
      >
        Try again
      </button>
    </Frame>
  );
}
