/**
 * Lays out the printed book in the style of the LaTeX songbook it replaces:
 * a title page, an index of titles with their numbers, then the songs in two
 * columns with running headers and footers, on A4.
 *
 * Pure: text is measured through `Metrics`, so tests can lay out a book with
 * fake metrics. pdf-render.ts measures with the real fonts and draws the result.
 *
 * Coordinates are points from the top-left corner of the page; a text item's
 * y is its baseline.
 */
import { copyrightLine, formatBookDate, type Line, type Section, type Song, type Songbook } from '@songbook/core';

export type FontName = 'roman' | 'italic' | 'bold' | 'boldItalic' | 'display' | 'small' | 'sans' | 'sansSmall';

export interface Metrics {
  /** Advance width of `text` set in `font` at `size` points. */
  width(text: string, font: FontName, size: number): number;
}

export interface TextItem {
  type: 'text';
  x: number;
  /** Baseline. */
  y: number;
  text: string;
  font: FontName;
  size: number;
  /** A named destination the text links to. */
  goTo?: string;
}

export interface RuleItem {
  type: 'rule';
  x: number;
  y: number;
  width: number;
}

export type Item = TextItem | RuleItem;

export interface Page {
  items: Item[];
  /** Link targets on this page, at the y of their top. */
  destinations: Array<{ name: string; y: number }>;
  /** Bookmarks (the PDF viewer's outline) that open this page, in order. */
  bookmarks: string[];
}

// --- Page geometry (A4) -----------------------------------------------------------------------

export const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const TEXT_WIDTH = PAGE.width - 2 * MARGIN;
const COLUMN_GAP = 20;
export const COLUMN_WIDTH = (TEXT_WIDTH - COLUMN_GAP) / 2;
export const COLUMNS = [MARGIN, MARGIN + COLUMN_WIDTH + COLUMN_GAP];

const HEADER_BASELINE = 44;
const HEADER_RULE = 50;
export const BODY_TOP = 66;
export const BODY_BOTTOM = 790;
const FOOTER_RULE = 798;
const FOOTER_BASELINE = 812;

// --- Type -------------------------------------------------------------------------------------

interface Type {
  size: number;
  /** Height of a row. */
  leading: number;
  /** Baseline, down from the top of the row. */
  baseline: number;
}

/** Lyrics: 12pt on 14.5pt, as the LaTeX book set them. */
const LYRIC: Type = { size: 12, leading: 14.5, baseline: 11 };
const TITLE: Type = { size: 14, leading: 17, baseline: 13 };
const COPYRIGHT: Type = { size: 7, leading: 9, baseline: 7 };
const CREDIT: Type = { size: 8, leading: 10, baseline: 8 };
const CHORD = { size: 8, height: 9 };
const MARKER_SIZE = 10;
/** Where verse text starts, after its number. Choruses start at the column's edge. */
export const VERSE_INDENT = 20;
/** Extra indent of a lyric line's continuation rows when it wraps. */
export const HANG = 18;
const SECTION_GAP = 11;
const SONG_GAP = 26;
const HEADING_GAP = 9;
const INDEX_GROUP_GAP = 8;
/** Least space between a chord and the next one on its line. */
const CHORD_GAP = 3;

/** Footer text, as the LaTeX book printed it. */
export const FOOTER_NOTE = 'please reach out for corrections';
export const INDEX_DESTINATION = 'index';
export const songDestination = (number: number) => `song-${number}`;
export const songHeading = (song: Pick<Song, 'number' | 'title'>) => `${song.number} \u2014 ${song.title}`;

// --- Lines ------------------------------------------------------------------------------------

interface Piece {
  text: string;
  font: FontName;
  chord?: string;
}

export interface Placed extends Piece {
  /** From the column's edge. */
  x: number;
}

/** One printed row; its items are relative to the row's top-left corner. */
interface Row {
  height: number;
  items: TextItem[];
}

const fontOf = (seg: { italic?: boolean; bold?: boolean }): FontName =>
  seg.bold ? (seg.italic ? 'boldItalic' : 'bold') : seg.italic ? 'italic' : 'roman';

/**
 * A line as words, each a list of pieces (one per formatting run) and the
 * spaces after it. Only ordinary spaces break a line: a non-breaking space
 * stays inside its word.
 */
function wordsOf(line: Line): Array<{ pieces: Piece[]; space?: Piece }> {
  const words: Array<{ pieces: Piece[]; space?: Piece }> = [{ pieces: [] }];
  for (const seg of line) {
    const font = fontOf(seg);
    let chord = seg.chord;
    for (const chunk of seg.text.split(/( +)/)) {
      if (chunk === '' && chord === undefined) continue;
      const word = words.at(-1)!;
      if (chunk.startsWith(' ')) {
        // A chord over a space sits where the space starts.
        if (chord !== undefined) word.pieces.push({ text: '', font, chord });
        // The space keeps the formatting it was typed in.
        word.space = { text: chunk, font };
        words.push({ pieces: [] });
      } else {
        word.pieces.push(chord === undefined ? { text: chunk, font } : { text: chunk, font, chord });
      }
      chord = undefined;
    }
  }
  return words.filter((w) => w.pieces.length > 0);
}

export interface WrapOptions {
  size: number;
  /** Where the first row starts, and where continuation rows start, from the column's edge. */
  firstX: number;
  restX: number;
  /** The right edge no row may pass. */
  limit: number;
}

/**
 * Breaks a line into rows at spaces (greedily), as pieces with x positions.
 * A chord goes over the start of its piece; the piece moves right if its
 * chord would run into the one before. A word wider than a whole row is
 * broken between characters. Neighbouring pieces in one font are joined, so
 * the PDF holds whole runs of text, which copy and search as such.
 */
export function wrapLine(line: Line, metrics: Metrics, { size, firstX, restX, limit }: WrapOptions): Placed[][] {
  const width = (piece: Piece) => metrics.width(piece.text, piece.font, size);
  const rows: Placed[][] = [[]];
  let x = firstX;
  let chordEnd = -Infinity;
  /** The spaces after the last word on this row, placed only if another word follows on it. */
  let space: Piece | undefined;

  const fit = (pieces: Piece[], from: number) => {
    let at = from;
    let chordAt = chordEnd;
    const placed = pieces.map((piece): Placed => {
      if (piece.chord !== undefined) {
        at = Math.max(at, chordAt);
        chordAt = at + metrics.width(piece.chord, 'sansSmall', CHORD.size) + CHORD_GAP;
      }
      const out = { ...piece, x: at };
      at += width(piece);
      return out;
    });
    return { placed, end: at, chordEnd: chordAt };
  };
  const commit = ({ placed, end, chordEnd: c }: ReturnType<typeof fit>) => {
    rows.at(-1)!.push(...placed);
    x = end;
    chordEnd = c;
  };
  const newRow = () => {
    rows.push([]);
    x = restX;
    chordEnd = -Infinity;
    space = undefined;
  };

  for (const word of wordsOf(line)) {
    const before = space ? width(space) : 0;
    let attempt = fit(word.pieces, x + before);
    if (attempt.end > limit && rows.at(-1)!.length > 0) {
      newRow();
      attempt = fit(word.pieces, x);
    } else if (space) {
      rows.at(-1)!.push({ ...space, x });
    }
    if (attempt.end <= limit) {
      commit(attempt);
    } else {
      // Wider than a whole row: one character at a time.
      for (const piece of word.pieces) {
        const chars = piece.text ? [...piece.text] : [''];
        chars.forEach((ch, k) => {
          const one: Piece = k === 0 && piece.chord !== undefined ? { text: ch, font: piece.font, chord: piece.chord } : { text: ch, font: piece.font };
          let step = fit([one], x);
          if (step.end > limit && rows.at(-1)!.length > 0) {
            newRow();
            step = fit([one], x);
          }
          commit(step);
        });
      }
    }
    space = word.space;
  }
  return rows.filter((row) => row.length > 0).map((row) => joinRuns(row, width));
}

function joinRuns(row: Placed[], width: (piece: Piece) => number): Placed[] {
  const out: Placed[] = [];
  let end = -Infinity;
  for (const piece of row) {
    const last = out.at(-1);
    if (last && piece.chord === undefined && piece.font === last.font && Math.abs(piece.x - end) < 0.01) last.text += piece.text;
    else out.push({ ...piece });
    end = piece.x + width(piece);
  }
  return out;
}

/** "1." for a verse, "a)" for a lettered part, nothing for a chorus or an unlabelled block. */
export function sectionMarker(section: Section): string | undefined {
  if (section.kind === 'chorus' || !section.label) return undefined;
  return section.kind === 'section' ? `${section.label})` : `${section.label}.`;
}

/** The rows of one lyric line, with the section's marker (if any) beside the first. */
function lineRows(line: Line, metrics: Metrics, textX: number, marker: string | undefined): Row[] {
  const rows = wrapLine(line, metrics, { size: LYRIC.size, firstX: textX, restX: textX + HANG, limit: COLUMN_WIDTH });
  return rows.map((pieces, k) => {
    const chordHeight = pieces.some((p) => p.chord !== undefined) ? CHORD.height : 0;
    const baseline = chordHeight + LYRIC.baseline;
    const items: TextItem[] = [];
    if (k === 0 && marker) items.push(text(VERSE_INDENT - 5 - metrics.width(marker, 'roman', MARKER_SIZE), baseline, marker, 'roman', MARKER_SIZE));
    for (const p of pieces) {
      if (p.text) items.push(text(p.x, baseline, p.text, p.font, LYRIC.size));
      if (p.chord) items.push(text(p.x, chordHeight - 1, p.chord, 'sansSmall', CHORD.size));
    }
    return { height: chordHeight + LYRIC.leading, items };
  });
}

function sectionRows(section: Section, metrics: Metrics): Row[] {
  // As in the LaTeX book, a chorus starts at the column's edge and a verse after its number.
  const textX = section.kind === 'chorus' ? 0 : VERSE_INDENT;
  const marker = sectionMarker(section);
  return section.lines.flatMap((line, k) => lineRows(line, metrics, textX, k === 0 ? marker : undefined));
}

/** `s` broken at spaces to fit the column, each row centred in it. */
function centredRows(s: string, font: FontName, type: Type, metrics: Metrics): Row[] {
  const rows: string[] = [];
  for (const word of s.split(/ +/).filter(Boolean)) {
    const last = rows.at(-1);
    if (last !== undefined && metrics.width(`${last} ${word}`, font, type.size) <= COLUMN_WIDTH) rows[rows.length - 1] = `${last} ${word}`;
    else rows.push(word);
  }
  return rows.map((row) => ({
    height: type.leading,
    items: [text(Math.max(0, (COLUMN_WIDTH - metrics.width(row, font, type.size)) / 2), type.baseline, row, font, type.size)],
  }));
}

/** The song's number and title, then its copyright, authors, scripture and sources, centred. */
function headingRows(song: Song, metrics: Metrics): Row[] {
  const credits: Array<[string | undefined, FontName, Type]> = [
    [copyrightLine(song.copyright), 'sansSmall', COPYRIGHT],
    [song.author && `W&M: ${song.author}`, 'small', CREDIT],
    [song.scripture, 'small', CREDIT],
    ...song.refs.map((r): [string, FontName, Type] => [`${r.source} ${r.ref}`.trim(), 'small', CREDIT]),
  ];
  return [
    ...centredRows(songHeading(song), 'sans', TITLE, metrics),
    ...credits.flatMap(([s, font, type]) => (s ? centredRows(s, font, type, metrics) : [])),
  ];
}

const heightOf = (rows: Row[]) => rows.reduce((h, r) => h + r.height, 0);

// --- Columns ----------------------------------------------------------------------------------

/**
 * Two-column pages, filled top to bottom, left column first. Each page's
 * columns start at `top(pageIndex)` and end at BODY_BOTTOM.
 */
class Columns {
  readonly pages: Page[] = [];
  private page!: Page;
  private column = 0;
  private y = 0;

  constructor(private readonly top: (pageIndex: number) => number) {
    this.addPage();
  }

  private addPage() {
    this.page = blank();
    this.pages.push(this.page);
    this.column = 0;
    this.y = this.top(this.pages.length - 1);
  }

  private nextColumn() {
    if (this.column === 1) return this.addPage();
    this.column = 1;
    this.y = this.top(this.pages.length - 1);
  }

  private get atTop(): boolean {
    return this.y === this.top(this.pages.length - 1);
  }

  /**
   * Places `rows` after `gap` (dropped at the top of a column), first moving
   * to the next column if the first `keep` points of the block would not fit
   * here. A block taller than what is left is split between rows. Returns
   * where its first row went.
   */
  place(rows: Row[], gap: number, keep = heightOf(rows)): { page: Page; y: number } {
    if (!this.atTop && gap + keep > BODY_BOTTOM - this.y) this.nextColumn();
    if (!this.atTop) this.y += gap;
    const start = { page: this.page, y: this.y };
    rows.forEach((row, k) => {
      if (k > 0 && !this.atTop && row.height > BODY_BOTTOM - this.y) this.nextColumn();
      for (const item of row.items) this.page.items.push({ ...item, x: COLUMNS[this.column] + item.x, y: this.y + item.y });
      this.y += row.height;
    });
    return start;
  }
}

// --- Pages ------------------------------------------------------------------------------------

const blank = (): Page => ({ items: [], destinations: [], bookmarks: [] });

function text(x: number, y: number, s: string, font: FontName, size: number, goTo?: string): TextItem {
  const item: TextItem = { type: 'text', x, y, text: s, font, size };
  if (goTo !== undefined) item.goTo = goTo;
  return item;
}

export function roman(n: number): string {
  const numerals: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  for (const [value, numeral] of numerals) {
    for (; n >= value; n -= value) out += numeral;
  }
  return out;
}

const centred = (s: string, y: number, font: FontName, size: number, metrics: Metrics) => text((PAGE.width - metrics.width(s, font, size)) / 2, y, s, font, size);
const flushRight = (s: string, y: number, font: FontName, size: number, metrics: Metrics, goTo?: string) =>
  text(PAGE.width - MARGIN - metrics.width(s, font, size), y, s, font, size, goTo);

/** The date the book prints: its latest edit, or else the LaTeX book's release text. */
export const bookDate = (book: Songbook): string => (book.updatedAt ? formatBookDate(book.updatedAt) : (book.released ?? ''));

function titlePage(book: Songbook, metrics: Metrics): Page {
  const page = blank();
  const y = PAGE.height * 0.38;
  page.items.push(centred(book.title, y, 'display', 20.74, metrics));
  if (book.updatedAt) page.items.push(centred(`Updated ${formatBookDate(book.updatedAt)}`, y + 72, 'roman', 12, metrics));
  else if (book.released) page.items.push(centred(book.released, y + 72, 'roman', 12, metrics));
  return page;
}

/** Every title with its number, in book order and grouped by first letter, each a link to its song. */
function indexPages(book: Songbook, metrics: Metrics): Page[] {
  const HEADING_BASELINE = 112;
  const columns = new Columns((k) => (k === 0 ? 146 : BODY_TOP - 10));
  const first = columns.pages[0];
  first.items.push(text(COLUMNS[0], HEADING_BASELINE, 'Index', 'bold', 24.88));
  first.destinations.push({ name: INDEX_DESTINATION, y: HEADING_BASELINE - 30 });
  first.bookmarks.push('Index');

  let group: string | undefined;
  for (const song of book.songs) {
    const initial = [...song.title.trim()][0]?.toLowerCase() ?? '';
    const gap = group !== undefined && initial !== group ? INDEX_GROUP_GAP : 0;
    group = initial;
    const goTo = songDestination(song.number);
    const rows = wrapLine([{ text: `${song.title}, ${song.number}` }], metrics, { size: LYRIC.size, firstX: 0, restX: 2 * HANG, limit: COLUMN_WIDTH });
    columns.place(
      rows.map((pieces) => ({ height: LYRIC.leading, items: pieces.map((p) => text(p.x, LYRIC.baseline, p.text, p.font, LYRIC.size, goTo)) })),
      gap,
    );
  }
  // Front matter is numbered i, ii, ...; the title page is i, unprinted.
  columns.pages.forEach((page, k) => page.items.push(centred(roman(k + 2), FOOTER_BASELINE, 'roman', 12, metrics)));
  return columns.pages;
}

function headAndFoot(page: Page, number: number, book: Songbook, metrics: Metrics) {
  const label = String(number);
  const date = bookDate(book);
  // Odd pages have the date on the left and the title on the right; even pages the other way round.
  const [left, right] = number % 2 === 1 ? [date, book.title] : [book.title, date];
  page.items.push(
    text(MARGIN, HEADER_BASELINE, left, 'roman', 12),
    centred(label, HEADER_BASELINE, 'roman', 12, metrics),
    flushRight(right, HEADER_BASELINE, 'roman', 12, metrics),
    { type: 'rule', x: MARGIN, y: HEADER_RULE, width: TEXT_WIDTH },
    { type: 'rule', x: MARGIN, y: FOOTER_RULE, width: TEXT_WIDTH },
    text(MARGIN, FOOTER_BASELINE, FOOTER_NOTE, 'small', 8),
    centred(label, FOOTER_BASELINE, 'roman', 12, metrics),
    flushRight('Back to Index', FOOTER_BASELINE, 'small', 8, metrics, INDEX_DESTINATION),
  );
}

function songPages(book: Songbook, metrics: Metrics): Page[] {
  const columns = new Columns(() => BODY_TOP);
  const column = BODY_BOTTOM - BODY_TOP;
  for (const song of book.songs) {
    const heading = headingRows(song, metrics);
    const sections = song.sections.map((s) => sectionRows(s, metrics));
    // Sections stay whole. One taller than a column is split, and starts wherever three rows fit.
    const keep = (rows: Row[]) => (heightOf(rows) <= column ? heightOf(rows) : heightOf(rows.slice(0, 3)));
    // A heading never ends a column on its own: it starts where its first section can start too.
    const at = columns.place(heading, SONG_GAP, heightOf(heading) + HEADING_GAP + keep(sections[0] ?? []));
    at.page.destinations.push({ name: songDestination(song.number), y: at.y });
    at.page.bookmarks.push(songHeading(song));
    sections.forEach((rows, k) => columns.place(rows, k === 0 ? HEADING_GAP : SECTION_GAP, keep(rows)));
  }
  columns.pages.forEach((page, k) => headAndFoot(page, k + 1, book, metrics));
  return columns.pages;
}

/**
 * The whole book: the title page, the index, a blank page when needed so that
 * song page 1 is a right-hand page, then the songs. `book.songs` must be in
 * book order, as buildSongbook returns them.
 */
export function layoutBook(book: Songbook, metrics: Metrics): Page[] {
  const front = [titlePage(book, metrics), ...indexPages(book, metrics)];
  if (front.length % 2 === 1) front.push(blank());
  return [...front, ...songPages(book, metrics)];
}
