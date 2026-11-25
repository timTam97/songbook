import { buildSongbook, type SongFields } from '@songbook/core';
import { describe, expect, it } from 'vitest';
import { pdfLink } from './songbook.ts';

const song: SongFields = { title: 'Alpha', slug: 'alpha', refs: [], sections: [{ kind: 'verse', label: '1', lines: [[{ text: 'la' }]] }] };
const book = (updatedAt: string, pdfBookUpdatedAt?: string) =>
  buildSongbook(
    { title: 'Test Songs', updatedAt, pdf: pdfBookUpdatedAt ? { generatedAt: '2026-11-26T00:00:00.000Z', bookUpdatedAt: pdfBookUpdatedAt } : undefined },
    [song],
  );

describe('pdfLink', () => {
  it('offers no PDF until one has been generated', () => {
    expect(pdfLink(book('2026-11-25T00:00:00.000Z'))).toBeUndefined();
  });

  it('links to the PDF, dating it only when the book has changed since', () => {
    expect(pdfLink(book('2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z'))).toEqual({ href: '/melbourne-songs.pdf' });
    expect(pdfLink(book('2026-11-27T00:00:00.000Z', '2026-11-25T00:00:00.000Z'))).toEqual({ href: '/melbourne-songs.pdf', olderThanSite: '25 November 2026' });
  });
});
