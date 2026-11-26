import type { SongSummary } from '@songbook/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { imported, RECENT_LIMIT, recentlyCreated, recentlyEdited } from './recent.ts';
import { loadSongs } from './SongList.tsx';
import { ago, button, fullTime, LoadFailure, PageTitle, useAsync, useTitle } from './ui.tsx';

interface RecentPageProps<T extends SongSummary> {
  title: string;
  intro: string;
  select: (songs: SongSummary[]) => T[];
  empty: string;
  /** The time the row is about, shown in full on hover. */
  when: (song: T) => string;
  detail: (song: T) => ReactNode;
  footer?: (songs: SongSummary[]) => ReactNode;
}

function RecentPage<T extends SongSummary>({ title, intro, select, empty, when, detail, footer }: RecentPageProps<T>) {
  useTitle(title);
  const list = useAsync(loadSongs, []);
  const all = list.data?.songs ?? [];
  const rows = select(all);
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">{intro}</p>
      {list.error !== undefined && <LoadFailure error={list.error} retry={list.reload} />}
      {list.loading && !list.data && <p className="text-stone-500">Loading…</p>}
      {list.data && rows.length === 0 && <p className="text-stone-500">{empty}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {rows.slice(0, RECENT_LIMIT).map((song) => (
            // The title link's ::after covers the whole row, so a tap anywhere on it opens the song.
            <li
              key={song.id}
              className="relative flex items-center gap-3 py-2 focus-within:bg-stone-100 hover:bg-stone-100 dark:focus-within:bg-stone-800/60 dark:hover:bg-stone-800/60"
            >
              <span className="w-8 shrink-0 self-start pt-0.5 text-right text-sm text-stone-500 tabular-nums">{song.number}</span>
              <div className="mr-auto min-w-0">
                <Link to={`/admin/songs/${song.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                  {song.title}
                </Link>
                <p className="text-sm wrap-anywhere text-stone-500 dark:text-stone-400" title={fullTime(when(song))}>
                  {detail(song)}
                </p>
              </div>
              {/* Positioned, and after the title, so it sits above the row's link. */}
              <Link to={`/admin/songs/${song.id}/history`} className={`${button.link} relative shrink-0 pr-2`}>
                History
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length > RECENT_LIMIT && (
        <p className="mt-4 text-sm text-stone-500">
          Showing the {RECENT_LIMIT} most recent of {rows.length}.
        </p>
      )}
      {list.data && footer?.(all)}
    </>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Melbourne' });

export function RecentlyEdited() {
  return (
    <RecentPage
      title="Recently edited"
      intro="Songs saved since they were added to the book, latest save first."
      select={recentlyEdited}
      empty="No song has been edited since it was added."
      when={(song) => song.updatedAt}
      detail={(song) => (
        <>
          Edited {ago(song.updatedAt)} by {song.updatedBy} · version {song.version}
        </>
      )}
    />
  );
}

export function RecentlyCreated() {
  return (
    <RecentPage
      title="Recently created"
      intro="Songs added in the portal, and deleted songs that were restored, newest first."
      select={recentlyCreated}
      empty="No songs have been added in the portal yet."
      when={(song) => song.created.at}
      detail={(song) => (
        <>
          {song.created.action === 'restore' ? 'Restored' : 'Created'} {ago(song.created.at)} by {song.created.by}
        </>
      )}
      footer={(songs) => {
        const seed = imported(songs);
        if (!seed.at) return null;
        return (
          <p className="mt-4 text-sm text-stone-500">
            Not listed: the {seed.count} song{seed.count === 1 ? '' : 's'} imported when the book moved here on {day(seed.at)}.
          </p>
        );
      }}
    />
  );
}
