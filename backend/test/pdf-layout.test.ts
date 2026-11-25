import { buildSongbook, slugify, type Line, type Section, type SongFields } from '@songbook/core';
import { describe, expect, it } from 'vitest';
import {
  BODY_BOTTOM,
  BODY_TOP,
  COLUMN_WIDTH,
  COLUMNS,
  FOOTER_NOTE,
  INDEX_DESTINATION,
  layoutBook,
  roman,
  sectionMarker,
  songDestination,
  wrapLine,
  type Metrics,
  type Page,
  type TextItem,
} from '../src/pdf-layout.ts';

/** Every character is half its point size wide. */
const metrics: Metrics = { width: (text, _font, size) => [...text].length * size * 0.5 };
const width = (item: TextItem) => metrics.width(item.text, item.font, item.size);

/** 6pt a character at 12pt: 30 characters fit between 20 and 200. */
const wrap = (line: Line, limit = 200) => wrapLine(line, metrics, { size: 12, firstX: 20, restX: 38, limit });
const rowText = (rows: ReturnType<typeof wrap>) => rows.map((row) => row.map((p) => p.text).join(''));

describe('wrapLine', () => {
  it('keeps a line that fits as one run of text', () => {
    expect(wrap([{ text: 'Amazing grace, how sweet' }])).toEqual([[{ text: 'Amazing grace, how sweet', font: 'roman', x: 20 }]]);
  });

  it('wraps at spaces, indenting the continuation, and never past the limit', () => {
    const line = 'When peace like a river attendeth my way, when sorrows like sea billows roll';
    const rows = wrap([{ text: line }]);
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.map((row) => row[0].x)).toEqual([20, ...rows.slice(1).map(() => 38)]);
    for (const row of rows) for (const p of row) expect(p.x + metrics.width(p.text, p.font, 12)).toBeLessThanOrEqual(200);
    expect(rowText(rows).join(' ')).toBe(line);
  });

  it('does not break at a non-breaking space', () => {
    const rows = wrap([{ text: 'xxxxxxxxxxxxxxxxxxxxxxxxx Jesus\u00A0Christ' }]);
    expect(rowText(rows)).toEqual(['xxxxxxxxxxxxxxxxxxxxxxxxx', 'Jesus\u00A0Christ']);
  });

  it('breaks a word longer than a whole row between characters', () => {
    const rows = wrap([{ text: 'y'.repeat(70) }]);
    expect(rowText(rows).join('')).toBe('y'.repeat(70));
    for (const row of rows) for (const p of row) expect(p.x + metrics.width(p.text, p.font, 12)).toBeLessThanOrEqual(200);
  });

  it('sets each formatting run in its own font, end to end', () => {
    const line = [{ text: 'Who saved us ' }, { text: '(who but God)', italic: true }, { text: ' and ' }, { text: 'loud', bold: true, italic: true }];
    const [row, ...rest] = wrap(line, 400);
    expect(rest).toEqual([]);
    expect(row.map((p) => [p.text, p.font])).toEqual([
      ['Who saved us ', 'roman'],
      ['(who but God)', 'italic'],
      [' and ', 'roman'],
      ['loud', 'boldItalic'],
    ]);
    for (let k = 1; k < row.length; k++) expect(row[k].x).toBeCloseTo(row[k - 1].x + metrics.width(row[k - 1].text, row[k - 1].font, 12));
  });

  it('puts a chord over the start of its text, moving the text right rather than letting chords collide', () => {
    const [row] = wrap([{ text: 'a', chord: 'Cmaj7' }, { text: 'men', chord: 'G' }]);
    expect(row.map((p) => [p.text, p.chord])).toEqual([
      ['a', 'Cmaj7'],
      ['men', 'G'],
    ]);
    // "Cmaj7" at 8pt is 20pt wide, plus a 3pt gap.
    expect(row[1].x).toBeCloseTo(row[0].x + 23);
  });
});

describe('section markers and page numbers', () => {
  it('numbers verses, letters parts and leaves choruses and unlabelled blocks bare', () => {
    const s = (kind: Section['kind'], label?: string): Section => ({ kind, label, lines: [] });
    expect([s('verse', '2'), s('section', 'a'), s('chorus'), s('verse')].map(sectionMarker)).toEqual(['2.', 'a)', undefined, undefined]);
  });

  it('writes front-matter page numbers in roman numerals', () => {
    expect([1, 2, 3, 4, 9, 14, 40].map(roman)).toEqual(['i', 'ii', 'iii', 'iv', 'ix', 'xiv', 'xl']);
  });
});

/** A song whose every lyric line is unique ("s007 v2 l3 ..."), so the tests can find it on the page. */
function song(k: number, verses = 3, lines = 4, lineText = (v: number, l: number) => `s${pad(k)} v${v} l${l} la la`): SongFields {
  const sections: Section[] = Array.from({ length: verses }, (_, v) => ({
    kind: 'verse',
    label: String(v + 1),
    lines: Array.from({ length: lines }, (_, l) => [{ text: lineText(v + 1, l + 1) }]),
  }));
  sections.splice(1, 0, { kind: 'chorus', lines: [[{ text: `s${pad(k)} chorus la la` }]] });
  const title = `Song ${pad(k)}`;
  return { title, slug: slugify(title), refs: [], copyright: 'Public Domain', author: 'Anon', sections };
}
const pad = (k: number) => String(k).padStart(3, '0');

const UPDATED = '2026-11-25T14:30:00.000Z';
const book = (songs: SongFields[]) => buildSongbook({ title: 'Test Songs', updatedAt: UPDATED }, songs);
const texts = (page: Page) => page.items.filter((i): i is TextItem => i.type === 'text');
const columnOf = (item: TextItem) => (item.x < COLUMNS[1] ? 0 : 1);
const songStart = (pages: Page[]) => pages.findIndex((p) => p.destinations.some((d) => d.name === songDestination(1)));

/** Where the text item starting with `prefix` is: its page, column and item. */
function find(pages: Page[], prefix: string) {
  for (const [page, p] of pages.entries()) {
    const item = texts(p).find((i) => i.text.startsWith(prefix));
    if (item) return { page, column: columnOf(item), item };
  }
  throw new Error(`no text starting "${prefix}"`);
}

describe('layoutBook', () => {
  const big = book(Array.from({ length: 120 }, (_, k) => song(k + 1, 2 + (k % 4), 3 + (k % 3))));
  const pages = layoutBook(big, metrics);
  const first = songStart(pages);
  const songPages = pages.slice(first);

  it('opens with a title page and the index, and starts the songs on a right-hand page', () => {
    expect(texts(pages[0]).map((i) => i.text)).toEqual(['Test Songs', 'Updated 26 November 2026']);
    expect(texts(pages[1])[0].text).toBe('Index');
    expect(pages[1].destinations).toEqual([expect.objectContaining({ name: INDEX_DESTINATION })]);
    expect(pages[1].bookmarks).toEqual(['Index']);
    // Physical page first + 1 is odd. 120 songs fill two index pages, so a blank page comes before the songs.
    expect(first % 2).toBe(0);
    expect(pages[first - 1].items).toEqual([]);
    expect(songStart(layoutBook(book([song(1), song(2)]), metrics))).toBe(2);
  });

  it('lists every song in the index, linked to the page its heading is on', () => {
    const index = pages.slice(1, first).flatMap(texts);
    for (const s of big.songs) {
      const entry = index.find((i) => i.goTo === songDestination(s.number));
      expect(entry?.text, s.title).toBe(`${s.title}, ${s.number}`);
      const holding = pages.filter((p) => p.destinations.some((d) => d.name === songDestination(s.number)));
      expect(holding).toHaveLength(1);
      expect(texts(holding[0]).some((i) => i.text === String(s.number) && i.font === 'mono')).toBe(true);
      expect(texts(holding[0]).some((i) => i.text === `\u2014 ${s.title}` && i.font === 'sans')).toBe(true);
      expect(holding[0].bookmarks).toContain(`${s.number} \u2014 ${s.title}`);
    }
  });

  it('keeps the songs inside their column, between the running head and foot', () => {
    for (const page of songPages) {
      for (const item of texts(page).filter((i) => i.y > 60 && i.y < 800)) {
        const left = COLUMNS[columnOf(item)];
        expect(item.x).toBeGreaterThanOrEqual(left - 0.01);
        expect(item.x + width(item)).toBeLessThanOrEqual(left + COLUMN_WIDTH + 0.01);
        expect(item.y).toBeGreaterThan(BODY_TOP);
        expect(item.y).toBeLessThanOrEqual(BODY_BOTTOM);
      }
    }
  });

  it('never splits a verse, and never leaves a heading at the foot of a column', () => {
    for (const s of big.songs) {
      const k = pad(Number(s.title.slice(5)));
      const heading = find(pages, `\u2014 ${s.title}`);
      const firstLine = find(pages, `s${k} v1 l1`);
      expect([firstLine.page, firstLine.column], s.title).toEqual([heading.page, heading.column]);
      for (const section of s.sections.filter((x) => x.kind === 'verse')) {
        const top = find(pages, `s${k} v${section.label} l1`);
        const bottom = find(pages, `s${k} v${section.label} l${section.lines.length}`);
        expect([bottom.page, bottom.column], `${s.title} verse ${section.label}`).toEqual([top.page, top.column]);
      }
    }
  });

  it('sets headings, verse numbers and credits in the LaTeX book’s fonts', () => {
    const body = songPages.flatMap(texts).filter((i) => i.y > 60 && i.y < 800);
    const fontsOf = (match: (i: TextItem) => boolean) => [...new Set(body.filter(match).map((i) => `${i.font} ${i.size}`))];
    expect(fontsOf((i) => /^\d+$/.test(i.text))).toEqual(['mono 16.94']);
    expect(fontsOf((i) => i.text.startsWith('\u2014 '))).toEqual(['sans 14.35']);
    expect(fontsOf((i) => /^\d+\.$/.test(i.text))).toEqual(['marker 10.91']);
    expect(fontsOf((i) => i.text === 'Public Domain' || i.text.startsWith('W&M:'))).toEqual(['small 8']);
    // The number and its title sit on one baseline, centred together.
    const number = body.find((i) => i.text === '1' && i.font === 'mono')!;
    const title = body.find((i) => i.text === '\u2014 Song 001')!;
    expect(title.y).toBe(number.y);
    const left = COLUMNS[columnOf(number)];
    const gapBefore = number.x - left;
    const gapAfter = left + COLUMN_WIDTH - (title.x + width(title));
    expect(Math.abs(gapBefore - gapAfter)).toBeLessThan(0.01);
  });

  it('wraps a long heading, keeping the number on the first row', () => {
    const long = { ...song(1), title: `Song 001 ${'and the rest of a very long title '.repeat(3)}`.trim() };
    const out = layoutBook(book([long]), metrics);
    const rows = texts(out[songStart(out)]).filter((i) => i.font === 'sans' || i.font === 'mono');
    expect(rows[0]).toMatchObject({ text: '1', font: 'mono' });
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.slice(1).map((r) => r.text).join(' ')).toBe(`\u2014 ${long.title}`);
    for (const r of rows) expect(r.x + width(r)).toBeLessThanOrEqual(COLUMNS[0] + COLUMN_WIDTH + 0.01);
  });

  it('runs the date and the title across the top, swapping sides on even pages, and links back to the index', () => {
    const head = (page: Page) =>
      texts(page)
        .filter((i) => i.y < 60)
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text);
    expect(head(songPages[0])).toEqual(['26 November 2026', '1', 'Test Songs']);
    expect(head(songPages[1])).toEqual(['Test Songs', '2', '26 November 2026']);
    const foot = texts(songPages[1]).filter((i) => i.y > 800);
    expect(foot.map((i) => i.text)).toEqual([FOOTER_NOTE, '2', 'Back to Index']);
    expect(foot[2].goTo).toBe(INDEX_DESTINATION);
    expect(songPages[0].items.filter((i) => i.type === 'rule')).toHaveLength(2);
  });

  it('splits a verse taller than a whole column between its rows', () => {
    // 40 lines that each wrap onto a second row: about 1,160pt, more than a column holds.
    const long = song(1, 1, 40, (_v, l) => `s001 v1 l${l} ${'and on and on '.repeat(4)}`);
    const out = layoutBook(book([long]), metrics);
    const start = songStart(out);
    const top = find(out, 's001 v1 l1 ');
    const bottom = find(out, 's001 v1 l40 ');
    expect([top.page, top.column]).toEqual([start, 0]);
    expect(bottom.page * 2 + bottom.column).toBeGreaterThan(top.page * 2 + top.column);
    for (const page of out.slice(start)) for (const item of texts(page).filter((i) => i.y > 60 && i.y < 800)) expect(item.y).toBeLessThanOrEqual(BODY_BOTTOM);
  });
});
