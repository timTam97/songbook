/**
 * The frozen seed (data/seed-songbook.json, melbourne-songs.tex as parsed at
 * the LaTeX retirement) through @songbook/core: every song survives the
 * editor markup, and the book order (numbers derived from titles) reproduces
 * every number in the printed edition. It is what prod was seeded from, and
 * what any empty table is seeded from unless SEED_FILE says otherwise.
 */
import { describe, expect, it } from 'vitest';
import seedJson from '../../data/seed-songbook.json' with { type: 'json' };
import { buildSongbook } from '../src/book.ts';
import { formatSongText, parseSongText } from '../src/markup.ts';
import type { SeedFile, Song, SongFields } from '../src/types.ts';
import { normalizeSongInput, validateSong } from '../src/validate.ts';

const seed = seedJson as unknown as SeedFile;
const { book } = seed;

/** What DynamoDB stores: everything but the derived number and first line. */
const fields = ({ number: _n, firstLine: _f, ...rest }: Song): SongFields => rest;

describe('the frozen seed through @songbook/core', () => {
  it('is the .tex as it was retired, with the songs the plan was measured on', () => {
    expect(seed.source).toMatch(/^melbourne-songs\.tex@[0-9a-f]{7,}$/);
    expect(book.title).toBe('Melbourne Songs');
    expect(book.songs).toHaveLength(96);
    // No [N]-excluded songs, so the printed numbers are exactly 1..n.
    expect(book.songs.map((s) => s.number)).toEqual(book.songs.map((_, k) => k + 1));
    expect(new Set(book.songs.map((s) => s.slug)).size).toBe(book.songs.length);
  });

  it('round-trips every song through the editor markup', () => {
    for (const song of book.songs) {
      expect(parseSongText(formatSongText(song.sections)), `${song.number} ${song.title}`).toEqual(song.sections);
    }
  });

  it('passes validation as frozen, and normalizing changes nothing', () => {
    for (const song of book.songs) {
      expect(validateSong(fields(song)), `${song.number} ${song.title}`).toEqual([]);
      expect(normalizeSongInput(fields(song)), `${song.number} ${song.title}`).toEqual(fields(song));
    }
  });

  it('reproduces every printed number from alphabetical order, and the whole book', () => {
    const shuffled = [...book.songs].reverse().map(fields);
    const built = buildSongbook({ title: book.title, released: book.released }, shuffled);
    expect(built.songs.map((s) => [s.number, s.slug])).toEqual(book.songs.map((s) => [s.number, s.slug]));
    const { schemaVersion, ...rest } = built;
    expect(schemaVersion).toBe(1);
    expect(rest).toEqual(book);
  });
});
