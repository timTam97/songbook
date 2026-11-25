import { describe, expect, it } from 'vitest';
import { buildSongbook, formatBookDate, SCHEMA_VERSION } from '../src/book.ts';
import { compareCodePoints, orderSongs, songOrderKey } from '../src/order.ts';
import { copyrightLine, deriveFirstLine, MAX_GENERATED_SLUG, slugify, uniqueSlug } from '../src/song.ts';
import type { SongFields } from '../src/types.ts';

const song = (title: string, slug = slugify(title), extra: Partial<SongFields> = {}): SongFields => ({
  title,
  slug,
  refs: [],
  sections: [{ kind: 'verse', label: '1', lines: [[{ text: `${title}, la la;` }]] }],
  ...extra,
});

describe('order', () => {
  it('lowercases and counts curly apostrophes as straight ones', () => {
    expect(songOrderKey('I’d Rather Have Jesus')).toBe("i'd rather have jesus");
    // "'" (U+0027) sorts before letters, so I'd comes before If, as in the .tex.
    expect(orderSongs([song('If That Isn’t Love'), song('I’d Rather Have Jesus')]).map((s) => s.title)).toEqual([
      'I’d Rather Have Jesus',
      'If That Isn’t Love',
    ]);
  });

  it('compares by code point like Python, not by UTF-16 unit', () => {
    expect(compareCodePoints('a', 'b')).toBeLessThan(0);
    expect(compareCodePoints('ab', 'a')).toBeGreaterThan(0);
    expect(compareCodePoints('same', 'same')).toBe(0);
    // U+FF5E (one UTF-16 unit) sorts before U+1F600 (a surrogate pair starting 0xD83D) by code point, but after it by unit.
    expect(compareCodePoints('\uFF5E', '😀')).toBeLessThan(0);
    expect('\uFF5E' < '😀').toBe(false);
  });

  it('breaks ties between identical titles by slug', () => {
    expect(orderSongs([song('Same', 'same-2'), song('Same', 'same')]).map((s) => s.slug)).toEqual(['same', 'same-2']);
  });
});

describe('buildSongbook', () => {
  const meta = { title: 'Test Songs', updatedAt: '2026-10-10T00:00:00.000Z' };

  it('numbers songs 1..n in alphabetical order and derives the first line', () => {
    const book = buildSongbook(meta, [song('Charlie'), song('alpha'), song('Bravo')]);
    expect(book.schemaVersion).toBe(SCHEMA_VERSION);
    expect(book.title).toBe('Test Songs');
    expect(book.updatedAt).toBe(meta.updatedAt);
    expect(book.released).toBeUndefined();
    expect(book.songs.map((s) => [s.number, s.title, s.firstLine])).toEqual([
      [1, 'alpha', 'alpha, la la'],
      [2, 'Bravo', 'Bravo, la la'],
      [3, 'Charlie', 'Charlie, la la'],
    ]);
  });

  it('renumbers the songs after a delete or a rename', () => {
    const songs = [song('A'), song('B'), song('C'), song('D')];
    const numbers = (list: SongFields[]) => Object.fromEntries(buildSongbook(meta, list).songs.map((s) => [s.slug, s.number]));
    expect(numbers(songs.filter((s) => s.title !== 'B'))).toEqual({ a: 1, c: 2, d: 3 });
    expect(numbers(songs.map((s) => (s.title === 'A' ? { ...s, title: 'E' } : s)))).toEqual({ b: 1, c: 2, d: 3, a: 4 });
  });

  it('copies only public fields', () => {
    const stored = { ...song('A', 'a', { key: 'G', copyright: 'Public Domain' }), id: 'x', version: 3, updatedBy: 'me' };
    const [out] = buildSongbook({ title: 'T', released: '2025' }, [stored]).songs;
    expect(Object.keys(out).sort()).toEqual(['copyright', 'firstLine', 'key', 'number', 'refs', 'sections', 'slug', 'title']);
  });

  it('serializes the same content to the same bytes whatever the stored key order', () => {
    const a = song('A');
    const b: SongFields = {
      sections: [{ lines: [[{ text: 'A, la la;' }]], label: '1', kind: 'verse' }],
      refs: [],
      slug: 'a',
      title: 'A',
    };
    expect(JSON.stringify(buildSongbook(meta, [a]))).toBe(JSON.stringify(buildSongbook(meta, [b])));
  });
});

describe('the PDF in the book', () => {
  it("carries the latest PDF's dates, and nothing else of it", () => {
    const pdf = { generatedAt: '2026-11-26T01:00:00.000Z', bookUpdatedAt: '2026-11-25T00:00:00.000Z' };
    const book = buildSongbook({ title: 'T', updatedAt: '2026-11-25T00:00:00.000Z', pdf: { ...pdf, pages: 3 } as typeof pdf }, [song('Alpha')]);
    expect(book.pdf).toEqual(pdf);
    expect(buildSongbook({ title: 'T' }, [song('Alpha')])).not.toHaveProperty('pdf');
  });

  it('prints dates in Melbourne time', () => {
    // 01:30 on the 26th in Melbourne (UTC+11 in summer) is still the 25th in UTC.
    expect(formatBookDate('2026-11-25T14:30:00.000Z')).toBe('26 November 2026');
    expect(formatBookDate('2026-07-01T13:00:00.000Z')).toBe('1 July 2026');
  });
});

describe('song helpers', () => {
  it('prints a copyright holder after ©, but not "Public Domain"', () => {
    expect(copyrightLine('CityAlight')).toBe('© CityAlight');
    expect(copyrightLine('Public Domain')).toBe('Public Domain');
    expect(copyrightLine(undefined)).toBeUndefined();
  });

  it('derives the first line without non-breaking spaces or trailing punctuation', () => {
    expect(deriveFirstLine([{ kind: 'verse', lines: [[{ text: 'Once\u00A0in ' }, { text: 'royal;', italic: true }], [{ text: 'x' }]] }])).toBe(
      'Once in royal',
    );
    expect(deriveFirstLine([])).toBe('');
  });

  it('slugifies titles', () => {
    expect(slugify('And Is It So! I Shall Be Like Thy Son?')).toBe('and-is-it-so-i-shall-be-like-thy-son');
    expect(slugify('There’s A Hill Lone And Gray')).toBe('theres-a-hill-lone-and-gray');
    expect(slugify('Café Déjà Vu')).toBe('cafe-deja-vu');
  });

  it('picks a free slug with a numeric suffix', () => {
    const taken = new Set(['same', 'same-2']);
    expect(uniqueSlug('Same', (s) => taken.has(s))).toBe('same-3');
    expect(uniqueSlug('Fresh', (s) => taken.has(s))).toBe('fresh');
    expect(uniqueSlug('!!!', () => false)).toBe('song');
  });

  it('keeps generated slugs short, cutting at a word boundary', () => {
    const slug = uniqueSlug(`${'word '.repeat(30)}end`, () => false);
    expect(slug.length).toBeLessThanOrEqual(MAX_GENERATED_SLUG);
    expect(slug).toMatch(/^word(-word)+$/);
    expect(uniqueSlug('x'.repeat(150), () => false)).toBe('x'.repeat(MAX_GENERATED_SLUG));
  });
});
