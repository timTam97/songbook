import type { Line, Song, Songbook } from '../../parser/types.ts';

export type { Line, Section, Segment, Song, Songbook } from '../../parser/types.ts';

export const lineText = (line: Line): string => line.map((seg) => seg.text).join('');

export const songText = (song: Song): string =>
  song.sections.map((section) => section.lines.map(lineText).join('\n')).join('\n');

/** Canonical URL. The slug keeps shared links pointing at the right hymn if numbers shift. */
export const songPath = (song: Song): string => `/songs/${song.number}/${song.slug}`;

export const displayCopyright = (song: Song): string | undefined =>
  song.copyright === undefined ? undefined : song.copyright === 'Public Domain' ? 'Public Domain' : `© ${song.copyright}`;

export interface SongIndex {
  book: Songbook;
  byNumber: Map<number, Song>;
  bySlug: Map<string, Song>;
  /** Songs in number order. */
  songs: Song[];
  first: number;
  last: number;
}

export function indexSongbook(book: Songbook): SongIndex {
  const songs = [...book.songs].sort((a, b) => a.number - b.number);
  return {
    book,
    songs,
    byNumber: new Map(songs.map((s) => [s.number, s])),
    bySlug: new Map(songs.map((s) => [s.slug, s])),
    first: songs[0]?.number ?? 0,
    last: songs.at(-1)?.number ?? 0,
  };
}

/**
 * Resolve /songs/:number/:slug. A matching slug wins over the number, so a link
 * shared before the book was renumbered still opens the same hymn.
 */
export function resolveSong(index: SongIndex, number: string | undefined, slug: string | undefined): Song | undefined {
  if (slug) {
    const bySlug = index.bySlug.get(slug);
    if (bySlug) return bySlug;
  }
  if (number && /^\d+$/.test(number)) return index.byNumber.get(Number(number));
  return undefined;
}

/** Previous / next printed song by number (skips gaps left by excluded songs). */
export function neighbours(index: SongIndex, song: Song): { prev?: Song; next?: Song } {
  const at = index.songs.indexOf(song);
  return { prev: index.songs[at - 1], next: index.songs[at + 1] };
}
