import type { AdminSong, SongSummary } from '@songbook/core';
import { describe, expect, it } from 'vitest';
import { draftErrors, emptyDraft, positions, sameDraft, songsAfter, toDraft, toInput } from './draft.ts';

const song: AdminSong = {
  id: 'a',
  version: 2,
  updatedAt: '2026-10-01T00:00:00.000Z',
  updatedBy: 'x@example.com',
  title: 'Amazing Grace',
  slug: 'amazing-grace',
  author: 'John Newton',
  refs: [{ source: 'Book', ref: '3' }],
  sections: [
    { kind: 'verse', label: '1', lines: [[{ text: 'Amazing grace! How sweet the sound' }]] },
    { kind: 'chorus', lines: [[{ text: 'Refrain ' }, { text: 'here', italic: true }]] },
  ],
};

const summary = (id: string, number: number, title: string): SongSummary => ({
  id,
  number,
  title,
  slug: title.toLowerCase().replace(/\W+/g, '-'),
  version: 1,
  updatedAt: '',
  updatedBy: '',
});
const book = [summary('a', 1, 'Alpha'), summary('b', 2, 'Bravo'), summary('c', 3, 'Charlie'), summary('d', 4, 'Delta')];

describe('drafts', () => {
  it('round-trips a song through the editor form unchanged', () => {
    const draft = toDraft(song);
    expect(draft.lyrics).toBe('Amazing grace! How sweet the sound\n\n{chorus}\nRefrain *here*');
    const { id: _i, version: _v, updatedAt: _u, updatedBy: _b, ...fields } = song;
    expect(toInput(draft)).toEqual(fields);
    expect(draftErrors(draft, false)).toEqual([]);
  });

  it('treats edits that normalize away as no change', () => {
    const draft = toDraft(song);
    expect(sameDraft(draft, { ...draft, title: ' Amazing Grace  ', lyrics: `${draft.lyrics}\n\n` })).toBe(true);
    expect(sameDraft(draft, { ...draft, author: 'Someone else' })).toBe(false);
  });

  it('leaves the slug of a new song to the server and drops empty references', () => {
    const input = toInput({ ...emptyDraft(), title: 'New', lyrics: 'line', refs: [{ source: ' ', ref: '' }] });
    expect(input).not.toHaveProperty('slug');
    expect(input.refs).toEqual([]);
    expect(draftErrors({ ...emptyDraft(), title: 'New', lyrics: 'line' }, true)).toEqual([]);
    expect(draftErrors(emptyDraft(), true).map((e) => e.field)).toEqual(['title', 'sections']);
  });
});

describe('positions', () => {
  it('says where a renamed song moves to', () => {
    expect(positions(book, 'a', 'Echo', 'alpha')).toEqual({ now: 1, after: 4 });
    expect(positions(book, 'c', 'Charlie', 'charlie')).toEqual({ now: 3, after: 3 });
  });

  it('places a new song', () => {
    expect(positions(book, undefined, 'Bz', '')).toEqual({ now: undefined, after: 3 });
  });

  it('counts the songs that move up when one is deleted', () => {
    expect(songsAfter(book, 'b')).toBe(2);
    expect(songsAfter(book, 'd')).toBe(0);
  });
});
