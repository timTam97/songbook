import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { index, search } from '../lib/data.ts';
import type { Snippet } from '../lib/search.ts';
import { songPath, type Song } from '../lib/songbook.ts';

const TITLE = index.book.title;

function Highlight({ snippet }: { snippet: Snippet }) {
  const parts: ReactNode[] = [];
  let at = 0;
  snippet.ranges.forEach(([start, end], k) => {
    if (start > at) parts.push(snippet.text.slice(at, start));
    parts.push(<mark key={k}>{snippet.text.slice(start, end)}</mark>);
    at = end;
  });
  parts.push(snippet.text.slice(at));
  return <>{parts}</>;
}

function SongRow({ song, children }: { song: Song; children?: ReactNode }) {
  return (
    <li>
      <Link
        to={songPath(song)}
        className="-mx-3 grid grid-cols-[3ch_1fr] items-baseline gap-x-3 rounded-md px-3 py-2 hover:bg-stone-200/60 focus-visible:bg-stone-200/60 dark:hover:bg-stone-800 dark:focus-visible:bg-stone-800"
      >
        <span className="text-right text-sm text-stone-500 tabular-nums dark:text-stone-400">{song.number}</span>
        <span className="min-w-0">
          <span className="block font-medium">{song.title}</span>
          {children && <span className="block truncate text-sm text-stone-600 dark:text-stone-400">{children}</span>}
        </span>
      </Link>
    </li>
  );
}

function NumberIndex() {
  return (
    <ol>
      {index.songs.map((s) => (
        <SongRow key={s.number} song={s}>
          {s.firstLine.toLowerCase().startsWith(s.title.toLowerCase().slice(0, 12)) ? undefined : s.firstLine}
        </SongRow>
      ))}
    </ol>
  );
}

export function IndexPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const hits = useMemo(() => search(query), [query]);
  const field = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = query ? `“${query}” · ${TITLE}` : TITLE;
  }, [query]);

  // "/" focuses search, as on most sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        field.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  return (
    <>
      <h1 className="sr-only">{TITLE}</h1>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (hits[0]) navigate(songPath(hits[0].song));
        }}
      >
        <label htmlFor="search" className="sr-only">
          Search hymns
        </label>
        <input
          ref={field}
          id="search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search titles, lyrics, authors or a number"
          value={query}
          onChange={(e) => update({ q: e.target.value || undefined })}
          className="h-12 w-full rounded-lg border border-stone-300 bg-white px-4 text-base placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-950"
        />
      </form>

      {query.trim() ? (
        <section aria-label="Search results" className="mt-4">
          <p aria-live="polite" className="mb-1 text-sm text-stone-500 dark:text-stone-400">
            {hits.length === 0 ? 'No hymns match.' : `${hits.length} ${hits.length === 1 ? 'hymn' : 'hymns'}`}
            {hits.length > 0 && <span className="max-sm:hidden"> · Enter opens the first</span>}
          </p>
          <ul>
            {hits.map((h) => (
              <SongRow key={h.song.number} song={h.song}>
                {h.snippet ? <Highlight snippet={h.snippet} /> : h.via === 'number' ? `Hymn ${h.song.number}` : h.song.firstLine}
              </SongRow>
            ))}
          </ul>
        </section>
      ) : (
        <nav aria-label="All hymns" className="mt-4">
          <NumberIndex />
        </nav>
      )}
    </>
  );
}
