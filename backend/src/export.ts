/**
 * The git export (.github/workflows/content-export.yml, `npm run export`): a
 * stage's public songbook.json, checked and pretty-printed so a git diff shows
 * what changed. Only a book the seed would accept is written, so every export
 * can re-seed an empty table as SEED_FILE.
 */
import { SCHEMA_VERSION, type Songbook } from '@songbook/core';
import { checkSeed } from './seed.ts';

export const EXPORT_FILE = 'songbook.json';

export interface Exported {
  /** The book as published, two-space indented, with a final newline. */
  text: string;
  songs: number;
  updatedAt: string;
}

/** Throws, naming the problem, unless `body` is a complete published songbook. */
export function exportSongbook(body: string, contentType: string | null): Exported {
  // Never commit an error or HTML page served in the book's place.
  if (!contentType?.startsWith('application/json')) throw new Error(`Content-Type is ${contentType}, expected application/json`);
  let book: Songbook;
  try {
    book = JSON.parse(body) as Songbook;
  } catch (err) {
    throw new Error(`not JSON: ${(err as Error).message}`);
  }
  if (book?.schemaVersion !== SCHEMA_VERSION) throw new Error(`schemaVersion is ${book?.schemaVersion}, expected ${SCHEMA_VERSION}`);
  if (typeof book.updatedAt !== 'string' || !book.updatedAt) throw new Error('updatedAt is missing');
  checkSeed(book);
  return { text: `${JSON.stringify(book, null, 2)}\n`, songs: book.songs.length, updatedAt: book.updatedAt };
}
