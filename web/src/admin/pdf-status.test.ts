import type { BookStatus } from '@songbook/core';
import { describe, expect, it } from 'vitest';
import { madeBy, pdfState } from './pdf-status.ts';

const edited = '2026-11-26T00:00:00.000Z';
const book = (pdfBookUpdatedAt?: string): BookStatus => ({
  title: 'Test Songs',
  updatedAt: edited,
  ...(pdfBookUpdatedAt
    ? { pdf: { generatedAt: pdfBookUpdatedAt, generatedBy: 'automatic', bookUpdatedAt: pdfBookUpdatedAt, songCount: 1, pages: 3, bytes: 1 } }
    : {}),
});
const at = (offsetMs: number) => Date.parse(edited) + offsetMs;

describe('pdfState', () => {
  it('knows when there is no PDF, and when it holds the latest edit', () => {
    expect(pdfState(book(), at(0))).toBe('none');
    expect(pdfState(book(edited), at(10 * 60_000))).toBe('current');
  });

  it('says updating just after an edit, and stuck once two minutes pass', () => {
    expect(pdfState(book('2026-11-25T00:00:00.000Z'), at(30_000))).toBe('updating');
    expect(pdfState(book('2026-11-25T00:00:00.000Z'), at(3 * 60_000))).toBe('stuck');
  });
});

describe('madeBy', () => {
  it('names the editor, or says it was automatic or a deploy', () => {
    expect(madeBy('automatic')).toBe('automatically after an edit');
    expect(madeBy('deploy')).toBe('by a deploy');
    expect(madeBy('editor@example.com')).toBe('by editor@example.com');
  });
});
