import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SongbookParseError } from './latex.ts';
import { parseSongbook, slugify } from './parse.ts';
import type { Line } from './types.ts';

const TEX_PATH = fileURLToPath(new URL('../../melbourne-songs.tex', import.meta.url));

const doc = (body: string, preamble = '') => `\\documentclass{book}
\\usepackage[wordbk]{songbook}
\\title{Test Songs}
\\newcommand{\\RelDate}{31~December,~2025}
${preamble}
\\begin{document}
${body}
\\end{document}
`;

const song = (title: string, body: string, opt = '') => `\\begin{song}${opt}{${title}}{}
  {\\SBPubDom}
  {Someone}
  {}
  {}
${body}
\\end{song}
`;

const text = (line: Line) => line.map((s) => s.text).join('');

describe('parseSongbook: structure', () => {
  it('reads book metadata and song headers', () => {
    const book = parseSongbook(
      doc(`\\begin{song}{Amazing Grace}{G}
  { CityAlight}
  {John Newton}
  {Ephesians~2:8}
  {\\NotCCLIed}
  \\begin{SBVerse}
    Amazing grace
  \\end{SBVerse}
\\end{song}`),
    );
    expect(book.title).toBe('Test Songs');
    expect(book.released).toBe('31 December, 2025');
    expect(book.songs[0]).toMatchObject({
      number: 1,
      title: 'Amazing Grace',
      slug: 'amazing-grace',
      key: 'G',
      copyright: 'CityAlight',
      author: 'John Newton',
      scripture: 'Ephesians 2:8',
      firstLine: 'Amazing grace',
    });
  });

  it('numbers verses, leaves choruses unnumbered and letters sections', () => {
    const book = parseSongbook(
      doc(
        song(
          'A',
          `\\begin{SBVerse}one\\end{SBVerse}
           \\begin{SBOpGroup}chorus\\end{SBOpGroup}
           \\begin{SBVerse}two\\end{SBVerse}
           \\begin{SBVerse*}unnumbered\\end{SBVerse*}
           \\begin{SBChorus}tagged\\end{SBChorus}
           \\begin{SBSection}sec\\end{SBSection}`,
        ),
      ),
    );
    expect(book.songs[0].sections.map((s) => [s.kind, s.label])).toEqual([
      ['verse', '1'],
      ['chorus', undefined],
      ['verse', '2'],
      ['verse', undefined],
      ['chorus', undefined],
      ['section', 'a'],
    ]);
  });

  it('numbers songs like SBSongCnt: comments skip, [N]-excluded songs consume a number', () => {
    const book = parseSongbook(
      doc(
        [
          song('First', '\\begin{SBVerse}a\\end{SBVerse}'),
          '% \\begin{song}{Commented}{}{}{}{}{}\n% \\end{song}',
          song('Hidden', '\\begin{SBVerse}b\\end{SBVerse}', '[N]'),
          song('Third', '\\begin{SBVerse}c\\end{SBVerse}'),
        ].join('\n'),
      ),
    );
    expect(book.songs.map((s) => [s.number, s.title])).toEqual([
      [1, 'First'],
      [3, 'Third'],
    ]);
  });

  it('prints excluded songs when printallsongs is set', () => {
    const tex = doc(song('Hidden', '\\begin{SBVerse}b\\end{SBVerse}', '[N]')).replace('[wordbk]', '[printallsongs,wordbk]');
    expect(parseSongbook(tex).songs).toHaveLength(1);
  });

  it('collects \\SBRef and ignores print-only commands', () => {
    const book = parseSongbook(
      doc(
        song(
          'A',
          `\\renewcommand{\\RevDate}{February~11,~1993}
           \\SBRef{Hosanna! Music Book~I}{\\#65}
           \\FLineIdx{What can wash}
           \\WBColBrk
           \\begin{SBVerse}x\\end{SBVerse}
           \\WBPageBrk`,
        ),
      ),
    );
    expect(book.songs[0].refs).toEqual([{ source: 'Hosanna! Music Book I', ref: '#65' }]);
  });

  it('de-duplicates slugs', () => {
    const book = parseSongbook(doc(song('Same', '\\begin{SBVerse}a\\end{SBVerse}') + song('Same', '\\begin{SBVerse}b\\end{SBVerse}')));
    expect(book.songs.map((s) => s.slug)).toEqual(['same', 'same-2']);
  });
});

describe('parseSongbook: lyrics', () => {
  const lines = (body: string) => parseSongbook(doc(song('T', `\\begin{SBVerse}\n${body}\n\\end{SBVerse}`))).songs[0].sections[0].lines;

  it('splits lines on blank lines and \\\\, joins wrapped source lines', () => {
    expect(lines('Line one\n    continues\n\n    Line two\\\\ Line three').map(text)).toEqual([
      'Line one continues',
      'Line two',
      'Line three',
    ]);
  });

  it('treats a comment-only line as not blank and lets % eat the newline', () => {
    expect(lines('one\n    % a comment\n    two\n\n    fo%\n    o').map(text)).toEqual(['one two', 'foo']);
  });

  it('converts TeX quotes, dashes, ties and escapes', () => {
    expect(text(lines("``Mine is thine.'' Jesus' blood --- tho' 1--2 a~b \\& \\# \\ldots{} end")[0])).toBe(
      '“Mine is thine.” Jesus’ blood — tho’ 1–2 a\u00A0b & # … end',
    );
  });

  it('keeps an escaped \\% and converts accents', () => {
    expect(text(lines("100\\% caf\\'e na\\\"{\\i}ve")[0])).toBe('100% café naïve');
  });

  it('marks italic and bold runs', () => {
    expect(lines('Who? \\textit{(Who but God’s Son)} and {\\bf bold}')[0]).toEqual([
      { text: 'Who? ' },
      { text: '(Who but God’s Son)', italic: true },
      { text: ' and ' },
      { text: 'bold', bold: true },
    ]);
  });

  it('keeps chords as data', () => {
    expect(lines('\\Ch{D}{What} can wash a\\Ch{F#m}{way}\\Chr{A7}{}')[0]).toEqual([
      { text: 'What can wash a', chord: 'D' },
      { text: 'way', chord: 'F#m' },
      { text: '', chord: 'A7' },
    ]);
  });

  it('fails loudly, with a line number, on unsupported commands', () => {
    const tex = doc(song('T', '\\begin{SBVerse}\n\\frobnicate{x}\n\\end{SBVerse}'));
    expect(() => parseSongbook(tex)).toThrow(SongbookParseError);
    expect(() => parseSongbook(tex)).toThrow(/:13: unsupported command \\frobnicate/);
  });

  it('fails loudly on text outside a verse', () => {
    expect(() => parseSongbook(doc(song('T', 'stray words\n\\begin{SBVerse}x\\end{SBVerse}')))).toThrow(/text outside a verse/);
  });
});

describe('slugify', () => {
  it('produces URL-safe slugs', () => {
    expect(slugify('And Is It So! I Shall Be Like Thy Son?')).toBe('and-is-it-so-i-shall-be-like-thy-son');
    expect(slugify('There’s A Hill Lone And Gray')).toBe('theres-a-hill-lone-and-gray');
    expect(slugify('Café Déjà Vu')).toBe('cafe-deja-vu');
  });
});

describe('melbourne-songs.tex', () => {
  const book = parseSongbook(readFileSync(TEX_PATH, 'utf8'));

  it('parses every song with contiguous numbers starting at 1', () => {
    expect(book.title).toBe('Melbourne Songs');
    expect(book.songs.length).toBeGreaterThan(0);
    // No [N]-excluded songs today, so numbers must be exactly 1..n as in the PDF.
    expect(book.songs.map((s) => s.number)).toEqual(book.songs.map((_, k) => k + 1));
  });

  it('has lyrics for every song and no LaTeX residue in the output', () => {
    for (const s of book.songs) {
      expect(s.sections.length, s.title).toBeGreaterThan(0);
      expect(s.firstLine, s.title).not.toBe('');
      for (const section of s.sections) {
        expect(section.lines.length, s.title).toBeGreaterThan(0);
        for (const line of section.lines) {
          for (const seg of line) expect(seg.text, `${s.number} ${s.title}`).not.toMatch(/[\\{}%$]|``|''/);
        }
      }
    }
  });

  it('has unique slugs', () => {
    expect(new Set(book.songs.map((s) => s.slug)).size).toBe(book.songs.length);
  });
});
