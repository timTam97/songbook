import type { SongOrigin, SongSummary } from '@songbook/core';
import { describe, expect, it } from 'vitest';
import { imported, recentlyCreated, recentlyEdited } from './recent.ts';

const SEEDED = '2026-10-13T00:00:00.000Z';

function song(number: number, version: number, updatedAt: string, created?: Partial<SongOrigin>): SongSummary {
  return {
    id: `s${number}`,
    number,
    title: `Song ${number}`,
    slug: `song-${number}`,
    version,
    updatedAt,
    updatedBy: 'editor@example.com',
    ...(created ? { created: { action: 'import', at: SEEDED, by: 'seed', ...created } } : {}),
  };
}

const ids = (songs: SongSummary[]) => songs.map((s) => s.id);

describe('recentlyEdited', () => {
  it('lists songs saved since they were added, latest save first, ties in book order', () => {
    const songs = [
      song(1, 1, SEEDED, {}),
      song(2, 4, '2026-11-20T00:00:00.000Z', {}),
      song(3, 2, '2026-11-26T00:00:00.000Z', { action: 'create', at: '2026-11-25T00:00:00.000Z' }),
      song(4, 1, '2026-11-26T09:00:00.000Z', { action: 'create', at: '2026-11-26T09:00:00.000Z' }),
      song(5, 2, '2026-11-20T00:00:00.000Z', {}),
    ];
    expect(ids(recentlyEdited(songs))).toEqual(['s3', 's2', 's5']);
  });
});

describe('recentlyCreated', () => {
  it('lists added and restored songs newest first, leaving out the seed and songs with no first version', () => {
    const songs = [
      song(1, 1, SEEDED, {}),
      song(2, 3, '2026-11-26T00:00:00.000Z', { action: 'create', at: '2026-11-01T00:00:00.000Z' }),
      song(3, 1, '2026-11-24T00:00:00.000Z', { action: 'restore', at: '2026-11-24T00:00:00.000Z' }),
      song(4, 1, '2026-11-25T00:00:00.000Z', { action: 'create', at: '2026-11-25T00:00:00.000Z' }),
      song(5, 1, '2026-11-25T00:00:00.000Z'),
    ];
    expect(ids(recentlyCreated(songs))).toEqual(['s4', 's3', 's2']);
  });
});

describe('imported', () => {
  it('counts the songs from the seed and says when they came', () => {
    const songs = [song(1, 1, SEEDED, {}), song(2, 5, SEEDED, {}), song(3, 1, SEEDED, { action: 'create', at: '2026-11-25T00:00:00.000Z' })];
    expect(imported(songs)).toEqual({ count: 2, at: SEEDED });
    expect(imported([])).toEqual({ count: 0, at: undefined });
  });
});
