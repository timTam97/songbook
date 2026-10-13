import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('song content is rendered as text', () => {
  // Lyrics and titles now come from an editor, so React must keep escaping them.
  it('never uses dangerouslySetInnerHTML in web/src', () => {
    const offenders = sources(SRC).filter((file) => readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML'));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
