/**
 * The seed file the CDK app ships for a stage's empty table (see song-data.ts).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedFile, Songbook } from '@songbook/core';

/** The book every stage starts from: melbourne-songs.tex as parsed when LaTeX was retired. */
export const FROZEN_SEED = fileURLToPath(new URL('../../data/seed-songbook.json', import.meta.url));

function tempSeed(seed: SeedFile): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'songbook-seed-')), 'seed-songbook.json');
  writeFileSync(file, JSON.stringify(seed));
  return file;
}

/**
 * SEED_FILE if given, otherwise the frozen seed. SEED_FILE is a SeedFile, or
 * a published songbook.json (`npm run export`, or the `content` branch),
 * which is wrapped as one in the OS temp dir. The seed Lambda checks the book
 * before importing anything.
 */
export function resolveSeedFile(seedFile: string | undefined): string {
  const file = path.resolve(seedFile || FROZEN_SEED);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SeedFile> & Partial<Songbook>;
  if (parsed.book) return file;
  if (!Array.isArray(parsed.songs)) throw new Error(`SEED_FILE ${seedFile} is neither a SeedFile nor a songbook.json`);
  const edited = parsed.updatedAt ? `, last edited ${parsed.updatedAt}` : '';
  return tempSeed({ source: `${path.basename(file)}${edited}`, book: parsed as Songbook });
}
