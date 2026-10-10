/**
 * The seed file the CDK app ships for a stage's empty table (see song-data.ts).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SeedFile, Songbook } from '@songbook/core';

function tempSeed(seed: SeedFile): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'songbook-seed-')), 'seed-songbook.json');
  writeFileSync(file, JSON.stringify(seed));
  return file;
}

/**
 * SEED_FILE if given, otherwise the book `fallback` returns (the parsed .tex).
 * SEED_FILE is a SeedFile, or a published songbook.json (`npm run export`,
 * or the `content` branch), which is wrapped as one. The seed Lambda checks
 * the book before importing anything. Generated files live in the OS temp dir
 * and the cloud assembly, never in git.
 */
export function resolveSeedFile(seedFile: string | undefined, fallback: () => SeedFile): string {
  if (!seedFile) return tempSeed(fallback());
  const file = path.resolve(seedFile);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SeedFile> & Partial<Songbook>;
  if (parsed.book) return file;
  if (!Array.isArray(parsed.songs)) throw new Error(`SEED_FILE ${seedFile} is neither a SeedFile nor a songbook.json`);
  const edited = parsed.updatedAt ? `, last edited ${parsed.updatedAt}` : '';
  return tempSeed({ source: `${path.basename(file)}${edited}`, book: parsed as Songbook });
}
