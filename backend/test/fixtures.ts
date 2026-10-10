import type { SongFields, Songbook } from '@songbook/core';

/** A small valid song, as SongFields. */
export function songFields(title: string, extra: Partial<SongFields> = {}): SongFields {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    title,
    slug,
    refs: [],
    sections: [{ kind: 'verse', label: '1', lines: [[{ text: `${title} first line` }]] }],
    ...extra,
  };
}

export function songItem(id: string, title: string, version = 1, extra: Partial<SongFields> = {}) {
  return { pk: 'SONG', sk: id, id, ...songFields(title, extra), version, updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'seed' };
}

export const META = { pk: 'BOOK', sk: 'META', title: 'Test Songs', updatedAt: '2026-10-02T00:00:00.000Z' };

/** A seed book whose numbers are the alphabetical positions, as buildSongbook derives them. */
export function seedBook(titles: string[]): Songbook {
  return {
    title: 'Test Songs',
    released: '31 December, 2025',
    songs: [...titles].sort().map((title, k) => ({ number: k + 1, firstLine: `${title} first line`, ...songFields(title) })),
  };
}

export function setEnv(values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}
