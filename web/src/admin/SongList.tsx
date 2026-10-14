import type { BookStatus, PublishResponse, SongListResponse } from '@songbook/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from './api.ts';
import { Alert, ago, button, fullTime, input, LoadFailure, messageOf, PageTitle, useAsync, useTitle } from './ui.tsx';

/** After this long, an edit that is still not published is worth flagging. */
const STUCK_MS = 2 * 60 * 1000;

export const loadSongs = () => api<SongListResponse>('GET', '/songs');

/**
 * Whether the public book has caught up with the latest edit. The publisher
 * records which edit it published, so a publish that failed or is stuck shows here.
 */
export function PublishStatus({ book, onRepublished }: { book: BookStatus; onRepublished: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const behind = !book.publishedBookUpdatedAt || book.publishedBookUpdatedAt < book.updatedAt;
  const stuck = behind && Date.now() - Date.parse(book.updatedAt) > STUCK_MS;

  const republish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api<{ result: PublishResponse }>('POST', '/publish');
      onRepublished();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-950">
      {/* The text takes the room left by the button and wraps inside it, so Republish stays on the same line. */}
      <span aria-live="polite" className={`min-w-0 flex-1 ${stuck ? 'font-medium text-red-700 dark:text-red-300' : 'text-stone-600 dark:text-stone-400'}`}>
        {!behind && book.publishedAt && <>Public site up to date · published {ago(book.publishedAt)}</>}
        {behind && !stuck && <>Publishing the latest changes… (usually under a minute)</>}
        {stuck && (
          <>
            The latest changes ({ago(book.updatedAt)}) have not reached the public site
            {book.publishedAt ? `; it was last published ${fullTime(book.publishedAt)}` : ''}.
          </>
        )}
      </span>
      <button type="button" className={`${button.secondary} h-8 shrink-0`} onClick={republish} disabled={busy}>
        {busy ? 'Publishing…' : 'Republish'}
      </button>
      {error && (
        <div className="w-full">
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  );
}

export function SongList() {
  useTitle('Songs');
  const songs = useAsync(loadSongs, []);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const all = songs.data?.songs ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    if (/^#?\d+$/.test(q)) return all.filter((s) => s.number === Number(q.replace('#', '')));
    return all.filter((s) => s.title.toLowerCase().includes(q) || s.slug.includes(q));
  }, [songs.data, filter]);

  return (
    <>
      <PageTitle
        actions={
          <Link to="/admin/songs/new" className={button.primary}>
            New song
          </Link>
        }
      >
        Songs
      </PageTitle>
      {songs.data && <PublishStatus book={songs.data.book} onRepublished={songs.reload} />}
      <label htmlFor="filter" className="sr-only">
        Filter songs
      </label>
      <input
        id="filter"
        type="search"
        className={`${input} mb-3 h-10 max-w-md`}
        placeholder="Filter by title or number"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoComplete="off"
      />
      {songs.error !== undefined && <LoadFailure error={songs.error} retry={songs.reload} />}
      {songs.loading && !songs.data && <p className="text-stone-500">Loading songs…</p>}
      {songs.data && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Songs in book order</caption>
          <thead className="border-b border-stone-200 text-xs text-stone-500 uppercase dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th scope="col" className="w-12 py-2 pr-3 text-right font-medium">
                No.
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Title
              </th>
              <th scope="col" className="py-2 font-medium max-sm:hidden">
                Last edited
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              // The title link's ::after covers the whole row, so a tap anywhere on it opens the song.
              <tr
                key={s.id}
                className="relative border-b border-stone-100 focus-within:bg-stone-100 hover:bg-stone-100 dark:border-stone-800/60 dark:focus-within:bg-stone-800/60 dark:hover:bg-stone-800/60"
              >
                <td className="py-3 pr-3 text-right text-stone-500 tabular-nums sm:py-2">{s.number}</td>
                <td className="py-3 pr-3 sm:py-2">
                  <Link to={`/admin/songs/${s.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                    {s.title}
                  </Link>
                </td>
                <td className="py-3 text-stone-500 max-sm:hidden sm:py-2" title={fullTime(s.updatedAt)}>
                  {ago(s.updatedAt)} · {s.updatedBy}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {songs.data && rows.length === 0 && <p className="mt-4 text-stone-500">No songs match.</p>}
      {songs.data && <p className="mt-4 text-sm text-stone-500">{songs.data.songs.length} songs</p>}
    </>
  );
}
