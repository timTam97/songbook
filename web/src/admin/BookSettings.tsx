import type { BookStatus } from '@songbook/core';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api.ts';
import { PublishStatus } from './SongList.tsx';
import { Alert, button, fullTime, input, LoadFailure, messageOf, PageTitle, useAsync, useTitle } from './ui.tsx';

export function BookSettings() {
  useTitle('Book');
  const book = useAsync(() => api<{ book: BookStatus }>('GET', '/book'), []);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string }>();

  useEffect(() => {
    if (book.data) setTitle(book.data.book.title);
  }, [book.data]);

  const save = async () => {
    setSaving(true);
    setNotice(undefined);
    try {
      await api<{ book: BookStatus }>('PUT', '/book', { title });
      setNotice({ kind: 'success', text: 'Saved. The public site shows the new title within a minute.' });
      book.reload();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError && err.fieldErrors[0] ? err.fieldErrors[0].message : messageOf(err) });
    } finally {
      setSaving(false);
    }
  };

  if (book.error !== undefined) return <LoadFailure error={book.error} retry={book.reload} />;
  if (!book.data) return <p className="text-stone-500">Loading…</p>;
  const status = book.data.book;

  return (
    <>
      <PageTitle>Book</PageTitle>
      <PublishStatus book={status} onRepublished={book.reload} />
      <form
        className="max-w-lg space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="book-title" className="block text-sm font-medium">
          Title
        </label>
        <input id="book-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        <p className="text-xs text-stone-500">Shown at the top of every page and in the browser tab.</p>
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        <button type="submit" className={button.primary} disabled={saving || title.trim() === status.title || title.trim() === ''}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      <dl className="mt-8 grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
        <dt>Last edit</dt>
        <dd>{status.updatedAt ? fullTime(status.updatedAt) : '—'}</dd>
        <dt>Last published</dt>
        <dd>
          {status.publishedAt ? fullTime(status.publishedAt) : 'never'}
          {status.publishedSongCount !== undefined ? ` (${status.publishedSongCount} songs)` : ''}
        </dd>
        {status.seededFrom && (
          <>
            <dt>Imported from</dt>
            <dd className="font-mono">{status.seededFrom}</dd>
          </>
        )}
      </dl>
    </>
  );
}
