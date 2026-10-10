import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SeedFile } from '@songbook/core';
import { describe, expect, it } from 'vitest';
import { resolveSeedFile } from '../lib/seed-file.ts';
import { testRoot } from './helpers.ts';

const book = { schemaVersion: 1, title: 'Test', updatedAt: '2026-10-10T00:00:00.000Z', songs: [] };
const fromTex = (): SeedFile => ({ source: 'melbourne-songs.tex@abc1234', book: { title: 'Tex', songs: [] } });
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

function write(name: string, data: unknown): string {
  const file = path.join(testRoot, name);
  writeFileSync(file, JSON.stringify(data));
  return file;
}

describe('resolveSeedFile', () => {
  it('parses the .tex when SEED_FILE is not set', () => {
    expect(read(resolveSeedFile(undefined, fromTex))).toEqual(fromTex());
    expect(read(resolveSeedFile('', fromTex))).toEqual(fromTex());
  });

  it('ships a SeedFile as it is', () => {
    const file = write('frozen-seed.json', { source: 'frozen', book });
    expect(resolveSeedFile(file, fromTex)).toBe(file);
  });

  it('wraps an exported songbook.json as a SeedFile', () => {
    const file = write('songbook.json', book);
    const seed = read(resolveSeedFile(file, fromTex));
    expect(seed).toEqual({ source: 'songbook.json, last edited 2026-10-10T00:00:00.000Z', book });
  });

  it('refuses anything else', () => {
    const file = write('other.json', { title: 'Not a book' });
    expect(() => resolveSeedFile(file, fromTex)).toThrow('neither a SeedFile nor a songbook.json');
  });
});
