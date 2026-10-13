import { describe, expect, it } from 'vitest';
import { canonicalSections, formatSongText, parseSongText, partLetter } from '../src/markup.ts';
import type { Section } from '../src/types.ts';

const roundTrip = (sections: Section[]) => parseSongText(formatSongText(sections));

describe('parseSongText: blocks', () => {
  it('splits blocks on blank lines and numbers verses by default', () => {
    expect(parseSongText('one\ntwo\n\n\n   \nthree')).toEqual([
      { kind: 'verse', label: '1', lines: [[{ text: 'one' }], [{ text: 'two' }]] },
      { kind: 'verse', label: '2', lines: [[{ text: 'three' }]] },
    ]);
  });

  it('reads headers case-insensitively and labels only counted blocks', () => {
    const sections = parseSongText('{Chorus}\nc\n\n{verse}\nv1\n\n{verse*}\nu\n\nv2\n\n{part}\np\n\n{ PART* }\nq\n\n{part}\nr');
    expect(sections.map((s) => [s.kind, s.label])).toEqual([
      ['chorus', undefined],
      ['verse', '1'],
      ['verse', undefined],
      ['verse', '2'],
      ['section', 'a'],
      ['section', undefined],
      ['section', 'b'],
    ]);
  });

  it('applies a header on its own to the next block', () => {
    expect(parseSongText('{chorus}\n\nrefrain')).toEqual([{ kind: 'chorus', lines: [[{ text: 'refrain' }]] }]);
  });

  it('treats a header-like line inside a block, or an escaped one, as text', () => {
    expect(parseSongText('a\n{chorus}')[0].lines).toEqual([[{ text: 'a' }], [{ text: '{chorus}' }]]);
    expect(parseSongText('\\{chorus}\nb')[0]).toEqual({ kind: 'verse', label: '1', lines: [[{ text: '{chorus}' }], [{ text: 'b' }]] });
  });

  it('accepts CRLF and ignores leading and trailing blank lines', () => {
    expect(parseSongText('\r\n\r\nx\r\ny\r\n\r\n')).toEqual([{ kind: 'verse', label: '1', lines: [[{ text: 'x' }], [{ text: 'y' }]] }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseSongText('')).toEqual([]);
    expect(parseSongText('\n \n{chorus}\n')).toEqual([]);
  });
});

describe('parseSongText: inline markup', () => {
  const line = (text: string) => parseSongText(text)[0].lines[0];

  it('marks italic and bold runs', () => {
    expect(line('Who? *(Who but God’s Son)* and **bold** end')).toEqual([
      { text: 'Who? ' },
      { text: '(Who but God’s Son)', italic: true },
      { text: ' and ' },
      { text: 'bold', bold: true },
      { text: ' end' },
    ]);
    expect(line('***both***')).toEqual([{ text: 'both', italic: true, bold: true }]);
  });

  it('closes an unclosed marker at the end of the line', () => {
    expect(parseSongText('*open\nnext')[0].lines).toEqual([[{ text: 'open', italic: true }], [{ text: 'next' }]]);
  });

  it('puts a chord over the text that follows it', () => {
    expect(line('[D]What can wash a[F#m]way[A7]')).toEqual([
      { text: 'What can wash a', chord: 'D' },
      { text: 'way', chord: 'F#m' },
      { text: '', chord: 'A7' },
    ]);
    expect(line('[G]*word* more')).toEqual([{ text: 'word', italic: true, chord: 'G' }, { text: ' more' }]);
    expect(line('[A][B]x')).toEqual([{ text: '', chord: 'A' }, { text: 'x', chord: 'B' }]);
  });

  it('honours escapes and leaves other backslashes and a lone [ alone', () => {
    expect(line('5 \\* 3 \\[not a chord] \\\\ \\n [open')).toEqual([{ text: '5 * 3 [not a chord] \\ \\n [open' }]);
  });

  it('collapses and trims spaces but keeps non-breaking spaces and curly quotes', () => {
    expect(line('  a   b\t c *  d * ')).toEqual([{ text: 'a b c ' }, { text: 'd', italic: true }]);
    expect(line('a\u00A0b “c” ’d')).toEqual([{ text: 'a\u00A0b “c” ’d' }]);
  });

  it('drops lines that are empty after markup', () => {
    expect(parseSongText('** **\nx')[0].lines).toEqual([[{ text: 'x' }]]);
  });
});

describe('formatSongText', () => {
  it('writes headers only where the default does not apply', () => {
    const sections: Section[] = [
      { kind: 'verse', label: '1', lines: [[{ text: 'one' }]] },
      { kind: 'chorus', lines: [[{ text: 'c' }]] },
      { kind: 'verse', lines: [[{ text: 'u' }]] },
      { kind: 'section', label: 'a', lines: [[{ text: 'p' }]] },
      { kind: 'section', lines: [[{ text: 'q' }]] },
    ];
    expect(formatSongText(sections)).toBe('one\n\n{chorus}\nc\n\n{verse*}\nu\n\n{part}\np\n\n{part*}\nq');
    expect(roundTrip(sections)).toEqual(sections);
  });

  it('escapes markup characters, and { at a line start', () => {
    const sections: Section[] = [{ kind: 'verse', label: '1', lines: [[{ text: '{chorus} a*b [c] \\ {d}' }]] }];
    expect(formatSongText(sections)).toBe('\\{chorus} a\\*b \\[c] \\\\ {d}');
    expect(roundTrip(sections)).toEqual(sections);
  });

  it('round-trips every combination of formatting and chords', () => {
    const sections: Section[] = [
      {
        kind: 'verse',
        label: '1',
        lines: [
          [{ text: 'plain ' }, { text: 'it', italic: true }, { text: 'bold', bold: true }, { text: 'both', italic: true, bold: true }, { text: ' x' }],
          [{ text: 'both', italic: true, bold: true }, { text: 'it', italic: true }],
          [{ text: 'a', bold: true }, { text: 'b', italic: true }, { text: 'c', bold: true }],
          [{ text: 'a', chord: 'G' }, { text: 'b', chord: 'G/B', italic: true }, { text: '', chord: 'C' }],
          [{ text: '', chord: 'D' }, { text: 'x*[{', chord: 'E', bold: true }],
          [{ text: 'a', bold: true }, { text: 'b', italic: true, chord: 'C' }],
          [{ text: 'a', bold: true }, { text: '', chord: 'C' }],
          [{ text: 'a', italic: true }, { text: '', chord: 'C' }, { text: '', chord: 'D' }],
          [{ text: 'a', italic: true }, { text: 'b', chord: 'C' }, { text: 'c', bold: true }],
        ],
      },
    ];
    expect(roundTrip(sections)).toEqual(sections);
    // And the markup itself is stable.
    expect(formatSongText(roundTrip(sections))).toBe(formatSongText(sections));
  });

  it('gives a bare chord the text that follows it, and no formatting of its own', () => {
    expect(canonicalSections([{ kind: 'verse', label: '1', lines: [[{ text: '', chord: 'G', italic: true }, { text: 'b', bold: true }]] }])).toEqual([
      { kind: 'verse', label: '1', lines: [[{ text: 'b', bold: true, chord: 'G' }]] },
    ]);
    expect(canonicalSections([{ kind: 'verse', label: '1', lines: [[{ text: 'a' }, { text: '', chord: 'G', bold: true }]] }])).toEqual([
      { kind: 'verse', label: '1', lines: [[{ text: 'a' }, { text: '', chord: 'G' }]] },
    ]);
  });

  it('canonicalSections renumbers labels and merges neighbours', () => {
    expect(
      canonicalSections([
        { kind: 'verse', label: '7', lines: [[{ text: 'a ' }, { text: ' b' }]] },
        { kind: 'section', label: 'q', lines: [[{ text: 'c' }]] },
      ]),
    ).toEqual([
      { kind: 'verse', label: '1', lines: [[{ text: 'a b' }]] },
      { kind: 'section', label: 'a', lines: [[{ text: 'c' }]] },
    ]);
  });
});

describe('partLetter', () => {
  it('letters parts a..z, then aa, ab, ...', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(partLetter)).toEqual(['a', 'b', 'z', 'aa', 'ab', 'az', 'ba']);
  });
});
