/**
 * Parse melbourne-songs.tex and report what the web app will contain.
 *
 *   npm run parse                 # summary only (fails with a line number on bad LaTeX)
 *   npm run parse -- out.json     # also write the parsed songbook as JSON
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SongbookParseError } from '../parser/latex.ts';
import { parseSongbook } from '../parser/parse.ts';

const texPath = fileURLToPath(new URL('../../melbourne-songs.tex', import.meta.url));

try {
  const book = parseSongbook(readFileSync(texPath, 'utf8'));
  const out = process.argv[2];
  if (out) writeFileSync(out, JSON.stringify(book, null, 2) + '\n');
  const first = book.songs[0];
  const last = book.songs.at(-1)!;
  console.log(`${book.title}: ${book.songs.length} songs (#${first.number} ${first.title} … #${last.number} ${last.title})`);
  if (out) console.log(`wrote ${out}`);
} catch (err) {
  if (err instanceof SongbookParseError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
