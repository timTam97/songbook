import type { DeletedSong, SongResponse } from '@songbook/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from './api.ts';
import { Alert, ago, button, fullTime, LoadFailure, messageOf, PageTitle, useAsync, useTitle } from './ui.tsx';

export function DeletedList() {
  useTitle('Recently deleted');
  const deleted = useAsync(() => api<{ deleted: DeletedSong[] }>('GET', '/deleted'), []);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: React.ReactNode }>();

  const restore = async (song: DeletedSong, slug?: string) => {
    setBusy(song.id);
    setNotice(undefined);
    try {
      const { song: restored } = await api<SongResponse>('POST', `/deleted/${song.id}/restore`, slug ? { slug } : undefined);
      setNotice({
        kind: 'success',
        text: (
          <>
            Restored “{restored.title}”.{' '}
            <Link to={`/admin/songs/${restored.id}`} className="font-medium underline">
              Open it
            </Link>
          </>
        ),
      });
      deleted.reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'slug-taken') {
        const next = window.prompt(`${err.message}\n\nNew link name for “${song.title}”:`, `${song.slug}-2`);
        setBusy(undefined);
        if (next) return restore(song, next.trim());
        return;
      }
      setNotice({ kind: 'error', text: messageOf(err) });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <PageTitle>Recently deleted</PageTitle>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
        Deleted songs can be restored for 30 days. A restored song gets its number back from its title, and starts a new history.
      </p>
      {notice && (
        <div className="mb-4">
          <Alert kind={notice.kind}>{notice.text}</Alert>
        </div>
      )}
      {deleted.error !== undefined && <LoadFailure error={deleted.error} retry={deleted.reload} />}
      {deleted.loading && !deleted.data && <p className="text-stone-500">Loading…</p>}
      {deleted.data?.deleted.length === 0 && <p className="text-stone-500">Nothing has been deleted in the last 30 days.</p>}
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {deleted.data?.deleted.map((song) => (
          <li key={song.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="mr-auto min-w-0">
              <p className="font-medium">{song.title}</p>
              <p className="text-sm text-stone-500" title={fullTime(song.deletedAt)}>
                Deleted {ago(song.deletedAt)} by {song.deletedBy} · restorable until {fullTime(song.restorableUntil)}
              </p>
            </div>
            <button type="button" className={button.secondary} disabled={busy !== undefined} onClick={() => void restore(song)}>
              {busy === song.id ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
