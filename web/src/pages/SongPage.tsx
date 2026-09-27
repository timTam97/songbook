import { useEffect } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { SongLyrics } from '../components/SongLyrics.tsx';
import { index } from '../lib/data.ts';
import { useLyricScale } from '../lib/prefs.ts';
import { displayCopyright, neighbours, resolveSong, songPath, type Song } from '../lib/songbook.ts';
import { NotFound } from './NotFound.tsx';

const toolButton =
  'grid h-9 min-w-9 place-items-center rounded-md px-2 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 disabled:opacity-40 disabled:hover:bg-transparent dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100';

function NeighbourLink({ song, dir }: { song?: Song; dir: 'prev' | 'next' }) {
  if (!song) return <span />;
  return (
    <Link
      to={songPath(song)}
      rel={dir}
      className={`group flex min-w-0 flex-col rounded-lg border border-stone-200 px-4 py-3 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600 ${dir === 'next' ? 'text-right' : ''}`}
    >
      <span className="text-sm text-stone-500 dark:text-stone-400">
        {dir === 'prev' ? '← ' : ''}
        {song.number}
        {dir === 'next' ? ' →' : ''}
      </span>
      <span className="truncate font-medium">{song.title}</span>
    </Link>
  );
}

export function SongPage() {
  const { number, slug } = useParams();
  const song = resolveSong(index, number, slug);
  const location = useLocation();
  const navigate = useNavigate();
  const [scale, step, reset] = useLyricScale();
  const { prev, next } = song ? neighbours(index, song) : {};

  useEffect(() => {
    if (song) document.title = `${song.number}. ${song.title} · ${index.book.title}`;
  }, [song]);

  // ← / → flip between hymns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft' && prev) navigate(songPath(prev));
      if (e.key === 'ArrowRight' && next) navigate(songPath(next));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, navigate]);

  if (!song) return <NotFound number={number} />;
  if (location.pathname !== songPath(song)) return <Navigate to={songPath(song)} replace />;

  const copyright = displayCopyright(song);
  const meta = [song.author, copyright, song.scripture, song.key && `Key of ${song.key}`].filter(Boolean);

  return (
    <article>
      <header className="mb-6">
        <p className="text-sm font-medium text-stone-500 tabular-nums dark:text-stone-400">Hymn {song.number}</p>
        <h1 className="mt-0.5 font-serif text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">{song.title}</h1>
        {meta.length > 0 && <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{meta.join(' · ')}</p>}
        {song.refs.map((r) => (
          <p key={`${r.source}${r.ref}`} className="text-sm text-stone-500 dark:text-stone-400">
            {r.source} {r.ref}
          </p>
        ))}
      </header>

      <div className="no-print mb-5 flex items-center gap-1 border-y border-stone-200 py-1 dark:border-stone-800" role="toolbar" aria-label="Reading options">
        <button type="button" className={toolButton} onClick={() => step(-1)} disabled={scale <= 0.85} aria-label="Smaller text">
          <span className="text-sm font-semibold">A−</span>
        </button>
        <button type="button" className={toolButton} onClick={reset} disabled={scale === 1} aria-label="Reset text size">
          <span className="text-xs tabular-nums">{Math.round(scale * 100)}%</span>
        </button>
        <button type="button" className={toolButton} onClick={() => step(1)} disabled={scale >= 2} aria-label="Larger text">
          <span className="text-lg font-semibold">A+</span>
        </button>
        <Link to="/" className={`${toolButton} ml-auto text-sm`}>
          All hymns
        </Link>
      </div>

      <div style={{ ['--lyric-scale' as string]: scale }}>
        <SongLyrics sections={song.sections} />
      </div>

      <nav aria-label="Other hymns" className="no-print mt-12 grid grid-cols-2 gap-3">
        <NeighbourLink song={prev} dir="prev" />
        <NeighbourLink song={next} dir="next" />
      </nav>
    </article>
  );
}
