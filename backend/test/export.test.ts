import { buildSongbook, type Songbook } from '@songbook/core';
import { describe, expect, it } from 'vitest';
import { exportSongbook } from '../src/export.ts';
import { checkSeed } from '../src/seed.ts';
import { songFields } from './fixtures.ts';

const JSON_TYPE = 'application/json';

/** A book as the publisher writes it: built by buildSongbook, serialized compactly. */
function published(titles = ['Alpha', 'Bravo', 'Charlie']): Songbook {
  return buildSongbook({ title: 'Test Songs', updatedAt: '2026-10-10T00:00:00.000Z' }, titles.map((t) => songFields(t)));
}

describe('exportSongbook', () => {
  it('pretty-prints the book unchanged, ending in a newline', () => {
    const book = published();
    const out = exportSongbook(JSON.stringify(book), JSON_TYPE);
    expect(out.text).toBe(`${JSON.stringify(book, null, 2)}\n`);
    expect(JSON.parse(out.text)).toEqual(book);
    expect(out).toMatchObject({ songs: 3, updatedAt: '2026-10-10T00:00:00.000Z' });
  });

  it('writes a file the seed accepts as a book', () => {
    const out = exportSongbook(JSON.stringify(published()), 'application/json; charset=utf-8');
    expect(checkSeed(JSON.parse(out.text)).map((s) => s.slug)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('refuses a page served in place of the book', () => {
    expect(() => exportSongbook('<!doctype html>', 'text/html')).toThrow('Content-Type is text/html');
    expect(() => exportSongbook('<Error/>', 'application/xml')).toThrow('Content-Type is application/xml');
    expect(() => exportSongbook('{}', null)).toThrow('Content-Type is null');
  });

  it('refuses a truncated or foreign file', () => {
    const text = JSON.stringify(published());
    expect(() => exportSongbook(text.slice(0, 40), JSON_TYPE)).toThrow('not JSON');
    expect(() => exportSongbook('null', JSON_TYPE)).toThrow('schemaVersion is undefined');
    expect(() => exportSongbook(JSON.stringify({ ...published(), schemaVersion: 2 }), JSON_TYPE)).toThrow('schemaVersion is 2');
    const undated = { ...published(), updatedAt: undefined }; // dropped by JSON.stringify
    expect(() => exportSongbook(JSON.stringify(undated), JSON_TYPE)).toThrow('updatedAt is missing');
  });

  it('refuses a book the seed could not restore', () => {
    expect(() => exportSongbook(JSON.stringify(published([])), JSON_TYPE)).toThrow('the seed has no songs');
    const book = published();
    book.songs[0].number = 3;
    book.songs[2].number = 1;
    expect(() => exportSongbook(JSON.stringify(book), JSON_TYPE)).toThrow('numbers would change');
  });
});
