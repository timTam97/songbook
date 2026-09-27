import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { index } from '../lib/data.ts';
import { songPath } from '../lib/songbook.ts';

export function NotFound({ number }: { number?: string }) {
  const isNumber = number !== undefined && /^\d+$/.test(number);
  useEffect(() => {
    document.title = `Not found · ${index.book.title}`;
  }, []);
  return (
    <div className="py-12 text-center">
      <h1 className="font-serif text-2xl font-semibold">{isNumber ? `There is no hymn ${number}` : 'Page not found'}</h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400">
        Hymns are numbered {index.first}–{index.last}, as in the printed book.
      </p>
      <Link to="/" className="mt-6 inline-block rounded-md bg-stone-900 px-4 py-2 text-stone-50 hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">
        Browse all hymns
      </Link>
    </div>
  );
}

/** /42 → /songs/42/<slug> */
export function NumberRedirect() {
  const { number } = useParams();
  const song = number && /^\d+$/.test(number) ? index.byNumber.get(Number(number)) : undefined;
  if (song) return <Navigate to={songPath(song)} replace />;
  return <NotFound number={number} />;
}
