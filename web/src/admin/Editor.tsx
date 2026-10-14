import { parseSongText, slugify, type AdminSong, type FieldError, type SongResponse } from '@songbook/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { SongLyrics } from '../components/SongLyrics.tsx';
import { api, ApiError } from './api.ts';
import { draftErrors, emptyDraft, positions, sameDraft, songsAfter, toDraft, toInput, type Draft } from './draft.ts';
import { loadSongs } from './SongList.tsx';
import { Alert, ago, button, fullTime, input, LoadFailure, messageOf, PageTitle, useAsync, useTitle } from './ui.tsx';

const MARKUP_HELP = [
  ['Blank line', 'starts a new verse. Verses are numbered for you.'],
  ['{chorus}', 'on the first line of a block makes it a chorus.'],
  ['{verse*}', 'an unnumbered verse. {part} and {part*} make lettered and unlettered parts.'],
  ['*words*', 'italic. **words** is bold.'],
  ['[G]', 'a chord over the text that follows it.'],
  ['\\*', 'a literal * (also \\[, \\{ and \\\\).'],
] as const;

function Field({
  id,
  label,
  error,
  hint,
  aside,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Shown at the end of the label's line. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

interface Conflict {
  message: string;
  mine: Draft;
}

/**
 * A textarea as tall as its text (never shorter than its min-height), so long
 * lyrics scroll with the page instead of in a box inside a scrolling page.
 */
function GrowingTextarea(props: ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Collapsing it to measure can shorten the page for a moment; keep the reader where they were.
    const y = window.scrollY;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    if (window.scrollY !== y) window.scrollTo(0, y);
  }, []);
  useLayoutEffect(fit, [fit, props.value]);
  useEffect(() => {
    // A narrower window wraps more lines.
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);
  return <textarea ref={ref} {...props} />;
}

export function Editor() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  useTitle(isNew ? 'New song' : 'Edit song');

  const list = useAsync(loadSongs, []);
  const loaded = useAsync(() => (id ? api<SongResponse>('GET', `/songs/${id}`) : Promise.resolve(undefined)), [id]);

  const [song, setSong] = useState<AdminSong>();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [baseline, setBaseline] = useState<Draft>(emptyDraft);
  /** A new song's slug follows its title until the editor types one. */
  const [slugFollowsTitle, setSlugFollowsTitle] = useState(isNew);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [conflict, setConflict] = useState<Conflict>();

  useEffect(() => {
    if (loaded.data) {
      const d = toDraft(loaded.data.song);
      setSong(loaded.data.song);
      setDraft(d);
      setBaseline(d);
    }
  }, [loaded.data]);

  const dirty = !sameDraft(draft, baseline);
  const sections = useMemo(() => parseSongText(draft.lyrics), [draft.lyrics]);
  const errors = useMemo(() => [...draftErrors(draft, isNew), ...serverErrors], [draft, isNew, serverErrors]);
  const errorFor = (field: string) => (attempted ? errors.find((e) => e.field === field || e.field.startsWith(`${field}[`))?.message : undefined);
  const lyricErrors = attempted ? errors.filter((e) => e.field.startsWith('sections')) : [];
  const songErrors = attempted ? errors.filter((e) => e.field === '') : [];
  const where = list.data ? positions(list.data.songs, id, draft.title, draft.slug) : undefined;

  // Leaving with unsaved changes asks first, inside the app and when closing the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (patch: Partial<Draft>) => {
    setSaved(undefined);
    setServerErrors([]);
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (slugFollowsTitle && patch.title !== undefined) next.slug = slugify(patch.title);
      return next;
    });
  };

  const save = async () => {
    setAttempted(true);
    setFailure(undefined);
    setSaved(undefined);
    if (draftErrors(draft, isNew).length > 0) return;
    setSaving(true);
    try {
      const body = toInput(draft);
      const res = isNew
        ? await api<SongResponse>('POST', '/songs', body)
        : await api<SongResponse>('PUT', `/songs/${id}`, { ...body, expectedVersion: song!.version });
      const d = toDraft(res.song);
      setSong(res.song);
      setDraft(d);
      setBaseline(d);
      setAttempted(false);
      setSlugFollowsTitle(false);
      setSaved('Saved. The public site shows it within a minute.');
      list.reload();
      if (isNew) navigate(`/admin/songs/${res.song.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') setConflict({ message: err.message, mine: draft });
      else if (err instanceof ApiError && err.code === 'invalid') setServerErrors(err.fieldErrors);
      else if (err instanceof ApiError && err.code === 'slug-taken') setServerErrors([{ field: 'slug', message: err.message }]);
      else setFailure(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!song || !list.data) return;
    const moving = songsAfter(list.data.songs, song.id);
    const consequence = moving > 0 ? ` ${moving} song${moving === 1 ? '' : 's'} after it will move up one number.` : '';
    if (!window.confirm(`Delete “${song.title}”?${consequence} You can restore it from Recently deleted for 30 days.`)) return;
    setSaving(true);
    try {
      await api('DELETE', `/songs/${song.id}?expectedVersion=${song.version}`);
      setBaseline(draft); // nothing left to lose
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') setConflict({ message: err.message, mine: draft });
      else setFailure(messageOf(err));
      setSaving(false);
    }
  };

  /** After a conflict: load what was saved elsewhere. The editor's own text stays in the side panel. */
  const loadLatest = () => {
    loaded.reload();
    list.reload();
    setAttempted(false);
  };

  if (loaded.error !== undefined) return <LoadFailure error={loaded.error} retry={loaded.reload} />;
  if (!isNew && !song) return <p className="text-stone-500">Loading…</p>;

  const titleError = errorFor('title');
  const slugError = errorFor('slug');

  return (
    <>
      <PageTitle
        actions={
          <>
            {!isNew && (
              <Link to={`/admin/songs/${id}/history`} className={button.secondary}>
                History
              </Link>
            )}
            <button type="button" className={button.primary} onClick={() => void save()} disabled={saving || (!dirty && !isNew)}>
              {saving ? 'Saving…' : isNew ? 'Create song' : 'Save'}
            </button>
          </>
        }
      >
        {isNew ? 'New song' : song!.title}
      </PageTitle>

      <div className="mb-4 space-y-2" aria-live="polite">
        {song && (
          <p className="text-sm text-stone-500" title={fullTime(song.updatedAt)}>
            Version {song.version} · last saved {ago(song.updatedAt)} by {song.updatedBy}
          </p>
        )}
        {where && draft.title.trim() !== '' && (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {where.now === undefined
              ? `Will be hymn ${where.after}.`
              : where.now === where.after
                ? `Hymn ${where.now}.`
                : `Saving will move it from hymn ${where.now} to hymn ${where.after}.`}
          </p>
        )}
        {saved && <Alert kind="success">{saved}</Alert>}
        {failure && <Alert>{failure}</Alert>}
        {list.error !== undefined && <Alert kind="info">Hymn numbers are unavailable right now: {messageOf(list.error)}</Alert>}
        {songErrors.map((e) => (
          <Alert key={e.message}>{e.message}</Alert>
        ))}
        {conflict && (
          <Alert kind="info">
            <p>
              <strong>This song was changed elsewhere.</strong> {conflict.message} Your changes were not saved.
            </p>
            <p className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={button.secondary} onClick={loadLatest}>
                Load the latest version
              </button>
              <button type="button" className={button.link} onClick={() => setConflict(undefined)}>
                Dismiss
              </button>
            </p>
          </Alert>
        )}
      </div>

      <div className={`grid gap-6 ${conflict ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field id="title" label="Title" error={titleError}>
            <input
              id="title"
              className={input}
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              aria-invalid={titleError !== undefined}
              aria-describedby={titleError ? 'title-error' : undefined}
              required
            />
          </Field>
          <Field
            id="slug"
            label="Link name"
            error={slugError}
            hint={
              <>
                The song’s address: /songs/{where?.after ?? 'N'}/{draft.slug || slugify(draft.title) || '…'}.{' '}
                {!isNew && 'Changing it breaks links shared before.'}
              </>
            }
          >
            <div className="flex gap-2">
              <input
                id="slug"
                className={`${input} min-w-0 font-mono`}
                value={draft.slug}
                onChange={(e) => {
                  setSlugFollowsTitle(false);
                  update({ slug: e.target.value });
                }}
                aria-invalid={slugError !== undefined}
                aria-describedby={slugError ? 'slug-error' : undefined}
                spellCheck={false}
                autoCapitalize="off"
              />
              <button type="button" className={`${button.secondary} shrink-0 whitespace-nowrap`} onClick={() => update({ slug: slugify(draft.title) })}>
                From title
              </button>
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="author" label="Author" error={errorFor('author')}>
              <input id="author" className={input} value={draft.author} onChange={(e) => update({ author: e.target.value })} />
            </Field>
            <Field id="copyright" label="Copyright" error={errorFor('copyright')}>
              <div className="flex gap-2">
                <input id="copyright" className={`${input} min-w-0`} value={draft.copyright} onChange={(e) => update({ copyright: e.target.value })} />
                {/* Only while it would change something, so it doesn't take a third of the row for nothing. */}
                {draft.copyright.trim().toLowerCase() !== 'public domain' && (
                  <button type="button" className={`${button.secondary} shrink-0 whitespace-nowrap`} onClick={() => update({ copyright: 'Public Domain' })}>
                    Public Domain
                  </button>
                )}
              </div>
            </Field>
            <Field id="key" label="Key" error={errorFor('key')}>
              <input id="key" className={input} value={draft.key} onChange={(e) => update({ key: e.target.value })} />
            </Field>
            <Field id="scripture" label="Scripture" error={errorFor('scripture')}>
              <input id="scripture" className={input} value={draft.scripture} onChange={(e) => update({ scripture: e.target.value })} />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">References to other books</legend>
            {draft.refs.map((ref, k) => (
              <div key={k} className="mb-2 flex gap-2">
                <label className="sr-only" htmlFor={`ref-source-${k}`}>
                  Book {k + 1}
                </label>
                <input
                  id={`ref-source-${k}`}
                  className={input}
                  placeholder="Book"
                  value={ref.source}
                  onChange={(e) => update({ refs: draft.refs.map((r, j) => (j === k ? { ...r, source: e.target.value } : r)) })}
                />
                <label className="sr-only" htmlFor={`ref-number-${k}`}>
                  Number in book {k + 1}
                </label>
                <input
                  id={`ref-number-${k}`}
                  className={`${input} w-28`}
                  placeholder="No."
                  value={ref.ref}
                  onChange={(e) => update({ refs: draft.refs.map((r, j) => (j === k ? { ...r, ref: e.target.value } : r)) })}
                />
                <button
                  type="button"
                  className={button.secondary}
                  aria-label={`Remove reference ${k + 1}`}
                  onClick={() => update({ refs: draft.refs.filter((_, j) => j !== k) })}
                >
                  ×
                </button>
              </div>
            ))}
            {errorFor('refs') && <p className="mb-2 text-sm text-red-700 dark:text-red-300">{errorFor('refs')}</p>}
            <button type="button" className={button.link} onClick={() => update({ refs: [...draft.refs, { source: '', ref: '' }] })}>
              Add a reference
            </button>
          </fieldset>

          <Field
            id="lyrics"
            label="Lyrics"
            aside={
              // Below lg the preview sits under the whole form.
              <button
                type="button"
                className={`${button.link} lg:hidden`}
                aria-label="Jump to the preview"
                onClick={() => document.getElementById('preview')?.scrollIntoView()}
              >
                Preview <span aria-hidden="true">&nbsp;↓</span>
              </button>
            }
          >
            <GrowingTextarea
              id="lyrics"
              className={`${input} h-auto min-h-[24rem] py-2 font-mono leading-relaxed`}
              value={draft.lyrics}
              onChange={(e) => update({ lyrics: e.target.value })}
              spellCheck
              aria-invalid={lyricErrors.length > 0}
              aria-describedby="lyrics-help lyrics-errors"
            />
          </Field>
          <div id="lyrics-errors" aria-live="polite">
            {lyricErrors.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-300">
                {lyricErrors.map((e) => (
                  <li key={`${e.field}${e.message}`}>{e.message}</li>
                ))}
              </ul>
            )}
          </div>
          <details id="lyrics-help" className="text-sm text-stone-600 dark:text-stone-400">
            <summary className="cursor-pointer py-3 font-medium">How to format lyrics</summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {MARKUP_HELP.map(([code, text]) => (
                <div key={code} className="contents">
                  <dt>
                    <code className="font-mono">{code}</code>
                  </dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </details>

          <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
            <button type="submit" className={button.primary} disabled={saving || (!dirty && !isNew)}>
              {saving ? 'Saving…' : isNew ? 'Create song' : 'Save'}
            </button>
            {dirty && <span className="text-sm text-stone-500">Unsaved changes</span>}
            {!isNew && (
              <button type="button" className={`${button.danger} ml-auto`} onClick={() => void remove()} disabled={saving}>
                Delete song
              </button>
            )}
          </div>
        </form>

        <section id="preview" aria-label="Preview" className="scroll-mt-28 lg:sticky lg:top-16 lg:self-start">
          <h2 className="mb-2 text-sm font-medium text-stone-500 uppercase">Preview</h2>
          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
            <p className="text-sm font-medium text-stone-500 tabular-nums">Hymn {where?.after ?? '…'}</p>
            <h3 className="mb-4 font-serif text-2xl leading-tight font-semibold">{draft.title || 'Untitled'}</h3>
            {sections.length > 0 ? <SongLyrics sections={sections} /> : <p className="text-stone-400">The lyrics appear here as you type.</p>}
          </div>
        </section>

        {conflict && (
          <section aria-label="Your unsaved changes">
            <h2 className="mb-2 text-sm font-medium text-stone-500 uppercase">Your unsaved changes</h2>
            <p className="mb-2 text-sm text-stone-600 dark:text-stone-400">Copy anything you want to keep into the form, then save again.</p>
            <label htmlFor="mine-title" className="mb-1 block text-sm font-medium">
              Title
            </label>
            <input id="mine-title" className={`${input} mb-3`} readOnly value={conflict.mine.title} />
            <label htmlFor="mine-lyrics" className="mb-1 block text-sm font-medium">
              Lyrics
            </label>
            <GrowingTextarea id="mine-lyrics" className={`${input} h-auto min-h-[24rem] py-2 font-mono`} readOnly value={conflict.mine.lyrics} />
          </section>
        )}
      </div>
    </>
  );
}
