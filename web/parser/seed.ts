/**
 * The seed for a stage's table while melbourne-songs.tex is still the master
 * copy: the parsed .tex, labelled with the last commit that changed it.
 * Used by the CDK app (the seed deploy asset) and by `npm run seed`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SeedFile } from '@songbook/core';
import { parseSongbook } from './parse.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEX = 'melbourne-songs.tex';

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function texSeed(): SeedFile {
  const book = parseSongbook(readFileSync(`${REPO_ROOT}${TEX}`, 'utf8'));
  const commit = git('log', '-1', '--format=%h', '--', TEX) || 'unknown';
  const edited = git('status', '--porcelain', '--', TEX) !== '';
  return { source: `${TEX}@${commit}${edited ? '+uncommitted' : ''}`, book };
}
