import { formatSongText, type HistoryEntry, type HistorySummary, type SongResponse } from '@songbook/core';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { SongLyrics } from '../components/SongLyrics.tsx';
import { api, ApiError } from './api.ts';
import { diffLines } from './diff.ts';
import { Alert, ago, button, fullTime, LoadFailure, messageOf, PageTitle, useAsync, useTitle } from './ui.tsx';

const ACTIONS: Record<HistorySummary['action'], string> = {
  import: 'Imported from the LaTeX book',
  create: 'Created',
  update: 'Edited',
  revert: 'Reverted',
  restore: 'Restored after deletion',
};

/** A version's metadata and lyrics as lines of editor markup, for the diff. */
function asLines(entry: { title: string; author?: string; copyright?: string; key?: string; scripture?: string; sections: HistoryEntry['sections'] }) {
  const meta = [
    `Title: ${entry.title}`,
    entry.author && `Author: ${entry.author}`,
    entry.copyright && `Copyright: ${entry.copyright}`,
    entry.key && `Key: ${entry.key}`,
    entry.scripture && `Scripture: ${entry.scripture}`,
  ].filter((l): l is string => Boolean(l));
  return [...meta, '', ...formatSongText(entry.sections).split('\n')];
}

function Diff({ before, after }: { before: string[]; after: string[] }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const changes = lines.filter((l) => l.kind !== 'same').length;
  if (changes === 0) return <p className="text-sm text-stone-500">Identical to the current version.</p>;
  return (
    <pre className="overflow-x-auto rounded-md border border-stone-200 bg-white p-3 font-mono text-[0.85rem] leading-relaxed dark:border-stone-800 dark:bg-stone-950">
      {lines.map((l, k) => (
        <div
          key={k}
          className={
            l.kind === 'added'
              ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
              : l.kind === 'removed'
                ? 'bg-red-50 text-red-900 line-through decoration-red-400/60 dark:bg-red-950 dark:text-red-100'
                : 'text-stone-600 dark:text-stone-400'
          }
        >
          <span aria-hidden="true" className="inline-block w-4 select-none">
            {l.kind === 'added' ? '+' : l.kind === 'removed' ? '−' : ' '}
          </span>
          <span className="sr-only">{l.kind === 'added' ? 'Now: ' : l.kind === 'removed' ? 'Was: ' : ''}</span>
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}

export function History() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const current = useAsync(() => api<SongResponse>('GET', `/songs/${id}`), [id]);
  const history = useAsync(() => api<{ history: HistorySummary[] }>('GET', `/songs/${id}/history`), [id]);
  const [selected, setSelected] = useState<number>();
  const entry = useAsync(
    () => (selected ? api<{ entry: HistoryEntry }>('GET', `/songs/${id}/history/${selected}`) : Promise.resolve(undefined)),
    [id, selected],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useTitle(current.data ? `History of ${current.data.song.title}` : 'History');

  const song = current.data?.song;
  const shown = entry.data?.entry;
  const before = useMemo(() => (shown ? asLines(shown) : []), [shown]);
  const after = useMemo(() => (song ? asLines(song) : []), [song]);

  const revert = async () => {
    if (!song || !shown) return;
    if (!window.confirm(`Make version ${shown.version} the current version of “${song.title}”? This saves it as version ${song.version + 1}; nothing is lost.`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await api<SongResponse>('POST', `/songs/${id}/revert`, { version: shown.version, expectedVersion: song.version });
      navigate(`/admin/songs/${id}`);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'conflict' ? `${err.message} Reload this page to see it.` : messageOf(err));
      setBusy(false);
    }
  };

  if (current.error !== undefined) return <LoadFailure error={current.error} retry={current.reload} />;
  if (history.error !== undefined) return <LoadFailure error={history.error} retry={history.reload} />;

  return (
    <>
      <PageTitle
        actions={
          <Link to={`/admin/songs/${id}`} className={button.secondary}>
            Back to the editor
          </Link>
        }
      >
        History{song ? ` of “${song.title}”` : ''}
      </PageTitle>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {/* minmax(0, …) and min-w-0: a long diff line scrolls inside its <pre>, not the page. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label="Versions" className="min-w-0">
          <ol className="space-y-1">
            {history.data?.history.map((h) => {
              const isCurrent = h.version === song?.version;
              return (
                <li key={h.version}>
                  <button
                    type="button"
                    onClick={() => setSelected(h.version)}
                    aria-current={selected === h.version ? 'true' : undefined}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm ${selected === h.version ? 'bg-stone-200 dark:bg-stone-800' : 'hover:bg-stone-100 dark:hover:bg-stone-900'}`}
                  >
                    <span className="font-medium">
                      Version {h.version}
                      {isCurrent ? ' (current)' : ''}
                    </span>
                    <span className="block text-stone-500" title={fullTime(h.changedAt)}>
                      {ACTIONS[h.action]}
                      {h.revertedFrom ? ` to version ${h.revertedFrom}` : ''} · {ago(h.changedAt)} · {h.changedBy}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {history.loading && !history.data && <p className="text-stone-500">Loading…</p>}
        </nav>

        <div className="min-w-0">
          {!selected && <p className="text-stone-500">Pick a version to see it and how it differs from the current one.</p>}
          {entry.error !== undefined && <LoadFailure error={entry.error} retry={entry.reload} />}
          {shown && song && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="mr-auto text-lg font-semibold">
                  Version {shown.version}: changes from it to the current version
                </h2>
                {shown.version !== song.version && (
                  <button type="button" className={button.primary} disabled={busy} onClick={() => void revert()}>
                    {busy ? 'Reverting…' : `Revert to version ${shown.version}`}
                  </button>
                )}
              </div>
              <Diff before={before} after={after} />
              <section aria-label={`Version ${shown.version} as it appeared`}>
                <h2 className="mb-2 text-sm font-medium text-stone-500 uppercase">Version {shown.version} as it appeared</h2>
                <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
                  <h3 className="mb-4 font-serif text-2xl font-semibold">{shown.title}</h3>
                  <SongLyrics sections={shown.sections} />
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
