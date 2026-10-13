import { describe, expect, it } from 'vitest';
import { LIMITS, normalizeSongInput, sameData, validateSong } from '../src/validate.ts';
import type { SongFields } from '../src/types.ts';

const valid = (): SongFields => ({
  title: 'Amazing Grace',
  slug: 'amazing-grace',
  author: 'John Newton',
  refs: [{ source: 'Hosanna! Music Book I', ref: '#65' }],
  sections: [
    { kind: 'verse', label: '1', lines: [[{ text: 'Amazing grace! How sweet the sound' }]] },
    { kind: 'chorus', lines: [[{ text: 'Refrain ' }, { text: 'here', italic: true }]] },
  ],
});

const fields = (input: unknown) => validateSong(input).map((e) => e.field);

describe('validateSong', () => {
  it('accepts a valid song', () => {
    expect(validateSong(valid())).toEqual([]);
  });

  it('rejects non-objects and unknown fields', () => {
    expect(validateSong(null)).toHaveLength(1);
    expect(validateSong([])).toHaveLength(1);
    expect(fields({ ...valid(), number: 4 })).toEqual(['']);
  });

  it('checks the title', () => {
    expect(fields({ ...valid(), title: '' })).toEqual(['title']);
    expect(fields({ ...valid(), title: '  ' })).toEqual(['title']);
    expect(fields({ ...valid(), title: ' Padded' })).toEqual(['title']);
    expect(fields({ ...valid(), title: 'x'.repeat(LIMITS.title) })).toEqual([]);
    expect(fields({ ...valid(), title: 'x'.repeat(LIMITS.title + 1) })).toEqual(['title']);
    expect(fields({ ...valid(), title: 'Tab\there' })).toEqual(['title']);
    expect(fields({ ...valid(), title: 42 })).toEqual(['title']);
  });

  it('checks the slug, which may be left out only when allowed', () => {
    expect(fields({ ...valid(), slug: 'Amazing Grace' })).toEqual(['slug']);
    expect(fields({ ...valid(), slug: 'a--b' })).toEqual(['slug']);
    expect(fields({ ...valid(), slug: '-a' })).toEqual(['slug']);
    expect(fields({ ...valid(), slug: 'a'.repeat(LIMITS.slug + 1) })).toEqual(['slug']);
    const { slug: _, ...noSlug } = valid();
    expect(fields(noSlug)).toEqual(['slug']);
    expect(validateSong(noSlug, { slugOptional: true })).toEqual([]);
  });

  it('checks optional metadata', () => {
    expect(fields({ ...valid(), key: '' })).toEqual(['key']);
    expect(fields({ ...valid(), copyright: 'x'.repeat(LIMITS.metadata + 1) })).toEqual(['copyright']);
    expect(fields({ ...valid(), scripture: 'John\u00073:16' })).toEqual(['scripture']);
    expect(fields({ ...valid(), author: null })).toEqual(['author']);
  });

  it('checks references', () => {
    expect(fields({ ...valid(), refs: 'none' })).toEqual(['refs']);
    expect(fields({ ...valid(), refs: Array(LIMITS.refs + 1).fill({ source: 'a', ref: '1' }) })).toEqual(['refs']);
    expect(fields({ ...valid(), refs: [{ source: '', ref: '1' }] })).toEqual(['refs[0].source']);
    expect(fields({ ...valid(), refs: [{ source: 'a', ref: '' }] })).toEqual([]);
    expect(fields({ ...valid(), refs: [{ source: 'a', ref: '1', url: 'x' }] })).toEqual(['refs[0]']);
  });

  it('needs between 1 and 50 sections, each with 1 to 40 lines', () => {
    expect(fields({ ...valid(), sections: [] })).toEqual(['sections']);
    expect(fields({ ...valid(), sections: undefined })).toEqual(['sections']);
    const verse = (n: number) => ({ kind: 'verse', label: String(n), lines: [[{ text: 'x' }]] });
    expect(fields({ ...valid(), sections: Array.from({ length: LIMITS.sections }, (_, k) => verse(k + 1)) })).toEqual([]);
    expect(fields({ ...valid(), sections: Array.from({ length: LIMITS.sections + 1 }, (_, k) => verse(k + 1)) })).toEqual(['sections']);
    expect(fields({ ...valid(), sections: [{ kind: 'verse', label: '1', lines: [] }] })).toEqual(['sections[0].lines']);
    const many = Array(LIMITS.linesPerSection + 1).fill([{ text: 'x' }]);
    expect(fields({ ...valid(), sections: [{ kind: 'verse', label: '1', lines: many }] })).toEqual(['sections[0].lines']);
  });

  it('requires labels to be the running verse number or part letter', () => {
    const lines = [[{ text: 'x' }]];
    expect(fields({ ...valid(), sections: [{ kind: 'verse', label: '2', lines }] })).toEqual(['sections[0].label']);
    expect(fields({ ...valid(), sections: [{ kind: 'chorus', label: '1', lines }] })).toEqual(['sections[0].label']);
    expect(
      fields({
        ...valid(),
        sections: [
          { kind: 'section', label: 'a', lines },
          { kind: 'verse', lines },
          { kind: 'section', label: 'b', lines },
          { kind: 'verse', label: '1', lines },
        ],
      }),
    ).toEqual([]);
    expect(fields({ ...valid(), sections: [{ kind: 'bridge', lines }] })).toEqual(['sections[0].kind']);
  });

  it('checks lines and segments', () => {
    const one = (line: unknown) => fields({ ...valid(), sections: [{ kind: 'verse', label: '1', lines: [line] }] });
    expect(one([])).toEqual(['sections[0].lines[0]']);
    expect(one([{ text: '   ' }])).toEqual(['sections[0].lines[0]']);
    expect(one([{ text: 'x'.repeat(LIMITS.lineLength + 1) }])).toEqual(['sections[0].lines[0]']);
    expect(one([{ text: 'x'.repeat(LIMITS.lineLength) }])).toEqual([]);
    expect(one([{ text: 'line\nbreak' }])).toEqual(['sections[0].lines[0][0]']);
    expect(one([{ text: 'x', italic: false }])).toEqual(['sections[0].lines[0][0].italic']);
    expect(one([{ text: 'x', colour: 'red' }])).toEqual(['sections[0].lines[0][0]']);
    expect(one([{ text: 'x', chord: 'G]' }])).toEqual(['sections[0].lines[0][0].chord']);
    expect(one([{ text: 'x', chord: '' }])).toEqual(['sections[0].lines[0][0].chord']);
    expect(one([{ text: 'x', chord: 'C'.repeat(LIMITS.chord + 1) }])).toEqual(['sections[0].lines[0][0].chord']);
    expect(one([{ text: '', chord: 'G' }])).toEqual([]);
    expect(one(['text'])).toEqual(['sections[0].lines[0][0]']);
  });

  it('requires lyrics in the canonical form the editor markup gives', () => {
    const lines = [[{ text: 'a ' }, { text: 'b' }]];
    expect(fields({ ...valid(), sections: [{ kind: 'verse', label: '1', lines }] })).toEqual(['sections']);
  });

  it('caps the size of a song', () => {
    const line = [{ text: 'x'.repeat(LIMITS.lineLength) }];
    const sections = Array.from({ length: 3 }, (_, k) => ({ kind: 'verse', label: String(k + 1), lines: Array(40).fill(line) }));
    expect(validateSong({ ...valid(), sections })[0].message).toMatch(/too large/);
  });

  it('names the verse and line in messages', () => {
    const sections = [
      { kind: 'verse', label: '1', lines: [[{ text: 'ok' }]] },
      { kind: 'verse', label: '2', lines: [[{ text: 'ok' }], [{ text: ' ' }]] },
    ];
    expect(validateSong({ ...valid(), sections })[0].message).toBe('Verse 2, line 2 is blank.');
  });
});

describe('normalizeSongInput', () => {
  it('trims text, drops empty optional fields and canonicalizes the lyrics', () => {
    const input = {
      title: '  Amazing Grace ',
      slug: ' amazing-grace',
      key: '',
      author: ' John Newton ',
      copyright: '   ',
      refs: [{ source: ' Book ', ref: ' 3 ' }],
      sections: [{ kind: 'verse', label: '9', lines: [[{ text: ' a ' }, { text: ' b ' }]] }],
    };
    const out = normalizeSongInput(input);
    expect(out).toEqual({
      title: 'Amazing Grace',
      slug: 'amazing-grace',
      author: 'John Newton',
      refs: [{ source: 'Book', ref: '3' }],
      sections: [{ kind: 'verse', label: '1', lines: [[{ text: 'a b' }]] }],
    });
    expect(validateSong(out)).toEqual([]);
  });

  it('defaults refs and leaves malformed values for validateSong to report', () => {
    expect(normalizeSongInput({ title: 'x', sections: 'nope' })).toEqual({ title: 'x', refs: [], sections: 'nope' });
    expect(normalizeSongInput('nope')).toBe('nope');
    expect(fields(normalizeSongInput({ title: 'x', slug: 'x', sections: [{ kind: 'verse', lines: [[{ text: 5 }]] }] }))).toEqual([
      'sections[0].lines[0][0]',
    ]);
  });
});

describe('sameData', () => {
  it('ignores key order and undefined values', () => {
    expect(sameData({ a: 1, b: [{ c: 'x', d: undefined }] }, { b: [{ c: 'x' }], a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameData([1, 2], [2, 1])).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
