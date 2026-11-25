import { copyrightLine, formatBookDate, lineText, PDF_KEY, type Song, type Songbook } from '@songbook/core';

export type { Line, Section, Segment, Song, Songbook } from '@songbook/core';
export { lineText };

export const songText = (song: Song): string =>
  song.sections.map((section) => section.lines.map(lineText).join('\n')).join('\n');

/** Canonical URL. The slug keeps shared links pointing at the right hymn if numbers shift. */
export const songPath = (song: Song): string => `/songs/${song.number}/${song.slug}`;

export const displayCopyright = (song: Song): string | undefined => copyrightLine(song.copyright);

export interface PdfLink {
  href: string;
  /** Set when songs have changed since the PDF was generated: the date of the book it holds. */
  olderThanSite?: string;
}

/** The PDF the editors last generated, or undefined if they never have. */
export function pdfLink(book: Songbook): PdfLink | undefined {
  if (!book.pdf) return undefined;
  const link: PdfLink = { href: `/${PDF_KEY}` };
  if (book.updatedAt && book.pdf.bookUpdatedAt < book.updatedAt) link.olderThanSite = formatBookDate(book.pdf.bookUpdatedAt);
  return link;
}

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
