/**
 * The book's PDF.
 *
 *   npm run pdf -- --out .tmp/songbook.pdf                  # the frozen seed, rendered here
 *   npm run pdf -- --out .tmp/songbook.pdf --book <file>    # a songbook.json or SeedFile, rendered here
 *   npm run pdf -- --stage beta                             # remake a stage's PDF now (the portal's Regenerate PDF button)
 *
 * Relative paths are relative to the directory npm was run from.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSongbook, type PdfResponse, type SeedFile, type Songbook } from '@songbook/core';
import { renderBook } from '../src/pdf.ts';
import { fail, frozenSeed, invoke, output, parseArgs, stackOutputs } from './stage.ts';

const USAGE = 'usage: npm run pdf -- --out <file.pdf> [--book <songbook.json>]  |  npm run pdf -- --stage beta|prod';
const argv = process.argv.slice(2);

if (argv.includes('--stage')) {
  const { stage } = parseArgs(argv, USAGE);
  const outputs = await stackOutputs(stage);
  const result = await invoke<PdfResponse>(output(outputs, 'PdfFunctionName', stage), { actor: `npm run pdf (${process.env.USER ?? 'local'})` });
  console.log(JSON.stringify(result));
} else {
  let out: string | undefined;
  let bookFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--book') bookFile = argv[++i];
    else fail(`unexpected argument ${argv[i]}\n${USAGE}`);
  }
  if (!out) fail(USAGE);
  const from = (file: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  out = from(out);
  const parsed = bookFile ? (JSON.parse(readFileSync(from(bookFile), 'utf8')) as Partial<SeedFile> & Songbook) : frozenSeed();
  const given: Songbook = parsed.book ?? (parsed as Songbook);
  // Number and order it as the publisher would.
  const book = buildSongbook({ title: given.title, released: given.released, updatedAt: given.updatedAt }, given.songs);
  const { bytes, pages } = await renderBook(book);
  writeFileSync(out, bytes);
  console.log(`${out}: ${book.songs.length} songs, ${pages} pages, ${Math.round(bytes.length / 1024)} KB`);
}
