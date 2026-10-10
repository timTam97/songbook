/**
 * The checks that let DynamoDB take over from the .tex without changing a
 * thing on the site: every song survives the editor markup, and the book
 * order (numbers derived from titles) reproduces every number in the PDF.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildSongbook,
  formatSongText,
  normalizeSongInput,
  parseSongText,
  validateSong,
  type Song,
  type SongFields,
} from '@songbook/core';
import { describe, expect, it } from 'vitest';
import { parseSongbook } from './parse.ts';

const TEX_PATH = fileURLToPath(new URL('../../melbourne-songs.tex', import.meta.url));
const book = parseSongbook(readFileSync(TEX_PATH, 'utf8'));

/** What DynamoDB stores: everything but the derived number and first line. */
const fields = ({ number: _n, firstLine: _f, ...rest }: Song): SongFields => rest;

describe('melbourne-songs.tex through @songbook/core', () => {
  it('has the songs the plan was measured on', () => {
    expect(book.songs).toHaveLength(96);
  });

  it('round-trips every song through the editor markup', () => {
    for (const song of book.songs) {
      expect(parseSongText(formatSongText(song.sections)), `${song.number} ${song.title}`).toEqual(song.sections);
    }
  });

  it('passes validation as parsed, and normalizing changes nothing', () => {
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
