import type { SongSummary } from '@songbook/core';

/** The most songs a recent tab lists. */
export const RECENT_LIMIT = 50;

const newestFirst = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);

/** Songs saved at least once since they came into the book, latest save first. */
export function recentlyEdited(songs: SongSummary[]): SongSummary[] {
  return songs.filter((s) => s.version > 1).sort((a, b) => newestFirst(a.updatedAt, b.updatedAt) || a.number - b.number);
}

export type CreatedSong = SongSummary & { created: NonNullable<SongSummary['created']> };

/** Songs added in the portal or restored after a delete, newest first. Songs from the seed are left out. */
export function recentlyCreated(songs: SongSummary[]): CreatedSong[] {
  return songs
    .filter((s): s is CreatedSong => s.created !== undefined && s.created.action !== 'import')
    .sort((a, b) => newestFirst(a.created.at, b.created.at) || a.number - b.number);
}

/** How many songs came from the seed, and when the first of them did. */
export function imported(songs: SongSummary[]): { count: number; at?: string } {
  const times = songs.flatMap((s) => (s.created?.action === 'import' ? [s.created.at] : [])).sort();
  return { count: times.length, at: times[0] };
}
