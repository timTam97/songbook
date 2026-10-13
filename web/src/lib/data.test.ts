import { buildSongbook, type SongFields } from '@songbook/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSongbook, resetSongbookCache, SongbookLoadError } from './data.ts';

const song = (title: string): SongFields => ({
  title,
  slug: title.toLowerCase(),
  refs: [],
  sections: [{ kind: 'verse', label: '1', lines: [[{ text: `${title} line` }]] }],
});
const book = buildSongbook({ title: 'Test Songs', updatedAt: '2026-10-10T00:00:00.000Z' }, [song('Bravo'), song('Alpha')]);

const respond = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

beforeEach(resetSongbookCache);

describe('loadSongbook', () => {
  it('fetches /songbook.json and indexes it', async () => {
    const urls: string[] = [];
    const data = await loadSongbook(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(book));
    });
    expect(urls).toEqual(['/songbook.json']);
    expect(data.index.book.title).toBe('Test Songs');
    expect(data.index.byNumber.get(1)?.title).toBe('Alpha');
    expect(data.search('bravo')[0].song.number).toBe(2);
  });

  it('fetches once per page load', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response(JSON.stringify(book));
    };
    const [a, b] = await Promise.all([loadSongbook(fetchImpl), loadSongbook(fetchImpl)]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('reports HTTP errors and fetches again on retry', async () => {
    await expect(loadSongbook(respond({}, 503))).rejects.toThrow(SongbookLoadError);
    await expect(loadSongbook(respond({}, 503))).rejects.toThrow(/error 503/);
    await expect(loadSongbook(respond(book))).resolves.toBeDefined();
  });

  it('reports a network failure and an unreadable body', async () => {
    await expect(
      loadSongbook(async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toThrow(/Check your connection/);
    await expect(loadSongbook(async () => new Response('<html>'))).rejects.toThrow(/could not be read/);
  });

  it('refuses a book in a format this page does not know', async () => {
    await expect(loadSongbook(respond({ ...book, schemaVersion: 2 }))).rejects.toThrow(/out of date/);
    const { schemaVersion: _, ...unversioned } = book;
    await expect(loadSongbook(respond(unversioned))).rejects.toThrow(/out of date/);
  });
});
