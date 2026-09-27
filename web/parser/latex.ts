import type { Line, Segment } from './types.ts';

/**
 * Marks "a comment ate this end-of-line". TeX's `%` swallows the newline, so
 * `foo%\nbar` is `foobar`, and a comment-only line is not a blank line (no
 * paragraph break). A private-use character keeps one physical output line per
 * input line, which lets errors report real line numbers.
 */
export const EOL_EATEN = '\uE000';

export class SongbookParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`melbourne-songs.tex:${line}: ${message}`);
    this.name = 'SongbookParseError';
    this.line = line;
  }
}

/** 1-based line number of `offset` in `text` (cleaned text keeps the original line structure). */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Index of the first `%` that is not escaped by an odd run of backslashes, or -1. */
function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '%') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 0) return i;
  }
  return -1;
}

/** Remove TeX comments while preserving line structure (see EOL_EATEN). */
export function stripComments(tex: string): string {
  return tex
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const at = commentStart(line);
      return at === -1 ? line : line.slice(0, at) + EOL_EATEN;
    })
    .join('\n');
}

export function skipSpace(s: string, i: number): number {
  while (i < s.length && (/\s/.test(s[i]) || s[i] === EOL_EATEN)) i++;
  return i;
}

/**
 * Read a balanced `{...}` group starting at `s[i]` (which must be `{`).
 * Returns the inner text and the index just past the closing brace.
 */
export function readGroup(s: string, i: number, base = 0, source = s): [string, number] {
  if (s[i] !== '{') {
    throw new SongbookParseError(`expected "{" but found ${JSON.stringify(s.slice(i, i + 20))}`, lineAt(source, base + i));
  }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++; // skip the escaped character, e.g. \{ or \}
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  throw new SongbookParseError('unbalanced "{"', lineAt(source, base + i));
}

/** Read an optional `[...]` argument at `s[i]`. */
export function readOptional(s: string, i: number): [string | undefined, number] {
  if (s[i] !== '[') return [undefined, i];
  const end = s.indexOf(']', i);
  if (end === -1) return [undefined, i];
  return [s.slice(i + 1, end), end + 1];
}

/** Read a control sequence name starting at `s[i]` (which must be `\`). */
export function readControl(s: string, i: number): [string, number] {
  let j = i + 1;
  if (/[A-Za-z@]/.test(s[j] ?? '')) {
    while (j < s.length && /[A-Za-z@]/.test(s[j])) j++;
    if (s[j] === '*') j++;
    return [s.slice(i + 1, j), j];
  }
  return [s[j] ?? '', j + 1];
}

// ---------------------------------------------------------------------------
// Inline conversion: TeX lyric text -> formatted segments
// ---------------------------------------------------------------------------

const SYMBOLS: Record<string, string> = {
  ldots: '…',
  dots: '…',
  textellipsis: '…',
  copyright: '©',
  textcopyright: '©',
  textregistered: '®',
  texttrademark: '™',
  dag: '†',
  ddag: '‡',
  S: '§',
  P: '¶',
  pounds: '£',
  textemdash: '—',
  textendash: '–',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  i: 'ı',
  j: 'ȷ',
  ss: 'ß',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  o: 'ø',
  O: 'Ø',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  SBPubDom: 'Public Domain',
  SBUnknownTag: 'Unknown',
  // Page/column control and words-only no-ops: meaningless on the web.
  WBColBrk: '',
  WBPageBrk: '',
  newpage: '',
  clearpage: '',
  pagebreak: '',
  nopagebreak: '',
  linebreak: '',
  nolinebreak: '',
  relax: '',
  SBem: '',
  SBen: '',
  hfill: ' ',
  hfil: ' ',
  quad: '\u2003',
  qquad: '\u2003\u2003',
  NotCCLIed: '',
  PGranted: '',
  CCLIed: '',
  PPending: '',
};

/** Single-character control symbols: \& \# \, \  etc. */
const CONTROL_SYMBOLS: Record<string, string> = {
  '&': '&',
  '#': '#',
  $: '$',
  '%': '%',
  _: '_',
  '{': '{',
  '}': '}',
  ',': '\u2009',
  ' ': ' ',
  '\n': ' ',
  '\t': ' ',
  '-': '', // discretionary hyphen
  '/': '', // italic correction
  '@': '',
  '!': '',
  ';': ' ',
  ':': ' ',
};

/** Accent commands mapped to Unicode combining marks. */
const ACCENTS: Record<string, string> = {
  "'": '\u0301',
  '`': '\u0300',
  '^': '\u0302',
  '"': '\u0308',
  '~': '\u0303',
  '=': '\u0304',
  '.': '\u0307',
  c: '\u0327',
  u: '\u0306',
  v: '\u030C',
  H: '\u030B',
  k: '\u0328',
  r: '\u030A',
};

interface Style {
  italic: boolean;
  bold: boolean;
}

const ITALIC_DECLS = new Set(['it', 'itshape', 'sl', 'slshape', 'em']);
const BOLD_DECLS = new Set(['bf', 'bfseries']);
const UPRIGHT_DECLS = new Set(['rm', 'upshape', 'normalfont', 'sf', 'sffamily', 'tt', 'ttfamily', 'small', 'footnotesize', 'scriptsize', 'tiny', 'large', 'Large', 'normalsize']);

type Token = { kind: 'text'; seg: Segment } | { kind: 'break' };

class InlineConverter {
  private tokens: Token[] = [];
  private pendingChord: string | undefined;

  constructor(
    private readonly source: string,
    private readonly base: number,
  ) {}

  private fail(message: string, i: number): never {
    throw new SongbookParseError(message, lineAt(this.source, this.base + i));
  }

  private emit(text: string, style: Style) {
    if (text === '' && this.pendingChord === undefined) return;
    const seg: Segment = { text };
    if (style.italic) seg.italic = true;
    if (style.bold) seg.bold = true;
    if (this.pendingChord !== undefined) {
      seg.chord = this.pendingChord;
      this.pendingChord = undefined;
    }
    this.tokens.push({ kind: 'text', seg });
  }

  /** Convert `s` (a substring of the source starting at `offset`) with an initial style. */
  run(s: string, offset: number, style: Style): void {
    let i = 0;
    let buf = '';
    const flush = () => {
      this.emit(buf, style);
      buf = '';
    };

    while (i < s.length) {
      const c = s[i];

      if (c === '\\') {
        const next = s[i + 1];
        if (next === '\\') {
          // Forced line break: \\, \\*, \\[len]
          flush();
          this.tokens.push({ kind: 'break' });
          i += 2;
          if (s[i] === '*') i++;
          i = skipSpace(s, i);
          [, i] = readOptional(s, i);
          continue;
        }
        const [name, after] = readControl(s, i);
        let j = after;

        if (name in ACCENTS) {
          // \'e  \'{e}  \c{c}
          j = skipSpace(s, j);
          let base: string;
          if (s[j] === '{') {
            let inner: string;
            [inner, j] = readGroup(s, j, this.base + offset, this.source);
            base = inner.trim() === '\\i' ? 'i' : inner.trim();
          } else if (s[j] === '\\') {
            const [cs, k] = readControl(s, j);
            base = cs === 'i' ? 'i' : cs === 'j' ? 'j' : this.fail(`unsupported accent target \\${cs}`, offset + j);
            j = k;
          } else {
            base = s[j] ?? '';
            j++;
          }
          buf += (base + ACCENTS[name]).normalize('NFC');
          i = j;
          continue;
        }

        if (name.length === 1 && !/[A-Za-z]/.test(name)) {
          if (!(name in CONTROL_SYMBOLS)) this.fail(`unsupported control symbol \\${name}`, offset + i);
          buf += CONTROL_SYMBOLS[name];
          i = j;
          continue;
        }

        // Control word: TeX skips the spaces that follow it.
        const skipped = skipSpace(s, j);

        if (name === 'Ch' || name === 'Chr') {
          let chord: string;
          let text: string;
          let k = skipped;
          [chord, k] = readGroup(s, k, this.base + offset, this.source);
          k = skipSpace(s, k);
          const textStart = k;
          [text, k] = readGroup(s, k, this.base + offset, this.source);
          flush();
          this.pendingChord = chord.trim();
          this.run(text, offset + textStart + 1, style);
          if (this.pendingChord !== undefined) this.emit('', style); // chord over an empty syllable
          i = k;
          continue;
        }

        if (name === 'textit' || name === 'emph' || name === 'textsl' || name === 'textbf') {
          flush();
          const k0 = skipped;
          const [inner, k] = readGroup(s, k0, this.base + offset, this.source);
          const nested: Style =
            name === 'textbf'
              ? { ...style, bold: true }
              : name === 'emph'
                ? { ...style, italic: !style.italic }
                : { ...style, italic: true };
          this.run(inner, offset + k0 + 1, nested);
          i = k;
          continue;
        }

        if (name === 'textrm' || name === 'textup' || name === 'textnormal' || name === 'textsf' || name === 'mbox' || name === 'hbox' || name === 'text') {
          flush();
          const [inner, k] = readGroup(s, skipped, this.base + offset, this.source);
          this.run(inner, offset + skipped + 1, name === 'textnormal' ? { italic: false, bold: false } : style);
          i = k;
          continue;
        }

        if (ITALIC_DECLS.has(name) || BOLD_DECLS.has(name) || UPRIGHT_DECLS.has(name)) {
          // Declaration: applies to the rest of the current group.
          flush();
          if (ITALIC_DECLS.has(name)) style = { ...style, italic: name === 'em' ? !style.italic : true };
          else if (BOLD_DECLS.has(name)) style = { ...style, bold: true };
          else if (name === 'rm' || name === 'upshape' || name === 'normalfont') style = { italic: false, bold: false };
          i = skipped;
          continue;
        }

        if (name === 'vspace' || name === 'vspace*' || name === 'hspace' || name === 'hspace*' || name === 'SBMargNote' || name === 'index' || name === 'label' || name === 'FLineIdx') {
          const [, k] = readGroup(s, skipped, this.base + offset, this.source);
          if (name.startsWith('hspace')) buf += ' ';
          i = k;
          continue;
        }

        if (name in SYMBOLS) {
          buf += SYMBOLS[name];
          // `\ldots{}` idiom: an empty group just ends the control word.
          i = s.startsWith('{}', skipped) ? skipped + 2 : skipped;
          continue;
        }

        this.fail(`unsupported command \\${name} in lyrics (add it to web/parser/latex.ts)`, offset + i);
      }

      if (c === '{') {
        flush();
        const [inner, k] = readGroup(s, i, this.base + offset, this.source);
        this.run(inner, offset + i + 1, style);
        i = k;
        continue;
      }
      if (c === '}') this.fail('unbalanced "}"', offset + i);
      if (c === '$') this.fail('math mode is not supported in lyrics', offset + i);

      if (c === '`') {
        buf += s[i + 1] === '`' ? '“' : '‘';
        i += s[i + 1] === '`' ? 2 : 1;
        continue;
      }
      if (c === "'") {
        buf += s[i + 1] === "'" ? '”' : '’';
        i += s[i + 1] === "'" ? 2 : 1;
        continue;
      }
      if (c === '"') {
        buf += '”';
        i++;
        continue;
      }
      if (c === '-') {
        let run = 1;
        while (s[i + run] === '-') run++;
        buf += run >= 3 ? '—' : run === 2 ? '–' : '-';
        i += Math.min(run, 3);
        continue;
      }
      if (c === '~') {
        buf += '\u00A0';
        i++;
        continue;
      }
      if (c === EOL_EATEN) {
        // `%` swallowed the newline; TeX also skips the next line's indentation.
        i++;
        if (s[i] === '\n') {
          i++;
          while (s[i] === ' ' || s[i] === '\t') i++;
        }
        continue;
      }
      if (/\s/.test(c)) {
        buf += ' ';
        i++;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
  }

  /** Group tokens into lines, merging and trimming segments. */
  lines(): Line[] {
    const out: Line[] = [];
    let current: Segment[] = [];
    const push = () => {
      const line = tidy(current);
      if (line.length > 0) out.push(line);
      current = [];
    };
    for (const t of this.tokens) {
      if (t.kind === 'break') push();
      else current.push(t.seg);
    }
    push();
    return out;
  }
}

const sameStyle = (a: Segment, b: Segment) => !!a.italic === !!b.italic && !!a.bold === !!b.bold;

/** Collapse whitespace, merge compatible neighbours, trim the line ends. */
function tidy(segments: Segment[]): Line {
  const merged: Segment[] = [];
  for (const seg of segments) {
    const prev = merged.at(-1);
    if (prev && seg.chord === undefined && sameStyle(prev, seg)) prev.text += seg.text;
    else merged.push({ ...seg });
  }
  let prevEndsSpace = true; // treat line start as a space so leading spaces are dropped
  for (const seg of merged) {
    seg.text = seg.text.replace(/[ \t\n]+/g, ' ');
    if (prevEndsSpace) seg.text = seg.text.replace(/^ /, '');
    if (seg.text !== '') prevEndsSpace = seg.text.endsWith(' ');
  }
  for (let k = merged.length - 1; k >= 0; k--) {
    merged[k].text = merged[k].text.replace(/ $/, '');
    if (merged[k].text !== '' || merged[k].chord !== undefined) break;
  }
  return merged.filter((seg) => seg.text !== '' || seg.chord !== undefined);
}

/**
 * Convert one lyric block (the body of an SBVerse, SBOpGroup, ...) to lines.
 * Every TeX paragraph and every `\\` starts a new line.
 */
export function convertLines(body: string, source: string, base: number): Line[] {
  const lines: Line[] = [];
  // A whitespace-only physical line ends a TeX paragraph. A comment-only line
  // is not blank (it holds EOL_EATEN), so it does not break the paragraph.
  const re = /\n[ \t]*(?:\n[ \t]*)+/g;
  let start = 0;
  const chunks: Array<[string, number]> = [];
  for (let m = re.exec(body); m; m = re.exec(body)) {
    chunks.push([body.slice(start, m.index), start]);
    start = m.index + m[0].length;
  }
  chunks.push([body.slice(start), start]);
  for (const [chunk, at] of chunks) {
    if (chunk.replaceAll(EOL_EATEN, '').trim() === '') continue;
    const conv = new InlineConverter(source, base);
    conv.run(chunk, at, { italic: false, bold: false });
    lines.push(...conv.lines());
  }
  return lines;
}

/** Convert a metadata field (title, author, ...) to plain text. */
export function convertPlain(tex: string, source: string, base: number): string {
  const conv = new InlineConverter(source, base);
  conv.run(tex, 0, { italic: false, bold: false });
  return conv
    .lines()
    .map((line) => line.map((seg) => seg.text).join(''))
    .join(' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
