import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FROZEN_SEED, resolveSeedFile } from '../lib/seed-file.ts';
import { testRoot } from './helpers.ts';

const book = { schemaVersion: 1, title: 'Test', updatedAt: '2026-10-10T00:00:00.000Z', songs: [] };
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

function write(name: string, data: unknown): string {
  const file = path.join(testRoot, name);
  writeFileSync(file, JSON.stringify(data));
  return file;
}

describe('resolveSeedFile', () => {
  it('ships the frozen seed when SEED_FILE is not set', () => {
    expect(resolveSeedFile(undefined)).toBe(FROZEN_SEED);
    expect(resolveSeedFile('')).toBe(FROZEN_SEED);
    expect(read(FROZEN_SEED)).toMatchObject({ source: expect.stringMatching(/^melbourne-songs\.tex@/), book: { title: 'Melbourne Songs' } });
  });

  it('ships a SeedFile as it is', () => {
    const file = write('frozen-seed.json', { source: 'frozen', book });
    expect(resolveSeedFile(file)).toBe(file);
  });

  it('wraps an exported songbook.json as a SeedFile', () => {
    const file = write('songbook.json', book);
    const seed = read(resolveSeedFile(file));
    expect(seed).toEqual({ source: 'songbook.json, last edited 2026-10-10T00:00:00.000Z', book });
  });

  it('refuses anything else', () => {
    const file = write('other.json', { title: 'Not a book' });
    expect(() => resolveSeedFile(file)).toThrow('neither a SeedFile nor a songbook.json');
  });
});
