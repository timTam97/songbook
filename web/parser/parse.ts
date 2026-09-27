import {
  SongbookParseError,
  convertLines,
  convertPlain,
  lineAt,
  readControl,
  readGroup,
  readOptional,
  skipSpace,
  stripComments,
} from './latex.ts';
import type { Section, SectionKind, Song, SongRef, Songbook } from './types.ts';

/** Lyric environments from songbook.sty and how they appear on the web. */
const SECTION_ENVS: Record<string, { kind: SectionKind; counted: boolean }> = {
  SBVerse: { kind: 'verse', counted: true },
  'SBVerse*': { kind: 'verse', counted: false },
  SBSection: { kind: 'section', counted: true },
  'SBSection*': { kind: 'section', counted: false },
  SBChorus: { kind: 'chorus', counted: false },
  'SBChorus*': { kind: 'chorus', counted: false },
  SBOpGroup: { kind: 'chorus', counted: false },
};

/** Song-body commands that only affect the printed book. Value = number of {} arguments to skip. */
const IGNORED_BODY_COMMANDS: Record<string, number> = {
  WBColBrk: 0,
  WBPageBrk: 0,
  newpage: 0,
  clearpage: 0,
  pagebreak: 0,
  nopagebreak: 0,
  columnbreak: 0,
  FLineIdx: 1,
  SBMargNote: 1,
  vspace: 1,
  'vspace*': 1,
  SBBridge: 1, // chords-only in songbook.sty
};

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findEnvEnd(text: string, env: string, from: number): number {
  // Environments of the same name could nest; songbook's don't in practice, but count anyway.
  const open = `\\begin{${env}}`;
  const close = `\\end{${env}}`;
  let depth = 1;
  let i = from;
  while (depth > 0) {
    const nextClose = text.indexOf(close, i);
    if (nextClose === -1) return -1;
    const nextOpen = text.indexOf(open, i);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + open.length;
    } else {
      depth--;
      i = nextClose + close.length;
      if (depth === 0) return nextClose;
    }
  }
  return -1;
}

/** Find `\newcommand{\Name}{value}` in the preamble. */
function preambleMacro(text: string, name: string): string | undefined {
  const at = text.search(new RegExp(`\\\\(?:re)?newcommand\\s*\\{\\\\${name}\\}`));
  if (at === -1) return undefined;
  const open = text.indexOf('{', text.indexOf('}', at) + 1);
  if (open === -1) return undefined;
  try {
    return readGroup(text, open)[0];
  } catch {
    return undefined;
  }
}

function parseSongBody(song: Song, body: string, bodyStart: number, source: string): void {
  let verse = 0;
  let section = 0;
  let i = 0;
  while (true) {
    i = skipSpace(body, i);
    if (i >= body.length) break;
    const here = bodyStart + i;

    if (body.startsWith('\\begin{', i)) {
      const nameEnd = body.indexOf('}', i);
      const env = body.slice(i + 7, nameEnd);
      const spec = SECTION_ENVS[env];
      if (!spec) {
        throw new SongbookParseError(`unsupported environment "${env}" in song "${song.title}"`, lineAt(source, here));
      }
      const contentStart = nameEnd + 1;
      const end = findEnvEnd(body, env, contentStart);
      if (end === -1) throw new SongbookParseError(`missing \\end{${env}}`, lineAt(source, here));

      const lines = convertLines(body.slice(contentStart, end), source, bodyStart + contentStart);
      const s: Section = { kind: spec.kind, lines };
      if (spec.counted && spec.kind === 'verse') s.label = String(++verse);
      if (spec.counted && spec.kind === 'section') s.label = String.fromCharCode(97 + section++);
      if (lines.length > 0) song.sections.push(s);
      i = end + `\\end{${env}}`.length;
      continue;
    }

    if (body[i] === '\\') {
      const [name, after] = readControl(body, i);
      let j = skipSpace(body, after);

      if (name === 'SBRef') {
        let source_: string;
        let ref: string;
        [source_, j] = readGroup(body, j, bodyStart, source);
        j = skipSpace(body, j);
        [ref, j] = readGroup(body, j, bodyStart, source);
        const r: SongRef = {
          source: convertPlain(source_, source, bodyStart),
          ref: convertPlain(ref, source, bodyStart),
        };
        song.refs.push(r);
        i = j;
        continue;
      }

      if (name === 'renewcommand' || name === 'def') {
        // e.g. \renewcommand{\RevDate}{February~11,~1993} -- print-only metadata.
        if (body[j] === '{') [, j] = readGroup(body, j, bodyStart, source);
        else [, j] = readControl(body, j);
        j = skipSpace(body, j);
        [, j] = readOptional(body, j);
        j = skipSpace(body, j);
        [, j] = readGroup(body, j, bodyStart, source);
        i = j;
        continue;
      }

      if (name in IGNORED_BODY_COMMANDS) {
        for (let n = 0; n < IGNORED_BODY_COMMANDS[name]; n++) {
          j = skipSpace(body, j);
          [, j] = readGroup(body, j, bodyStart, source);
        }
        i = j;
        continue;
      }

      throw new SongbookParseError(
        `unsupported command \\${name} between verses of "${song.title}" (add it to web/parser/parse.ts)`,
        lineAt(source, here),
      );
    }

    const snippet = body.slice(i, i + 40).split('\n')[0];
    throw new SongbookParseError(
      `text outside a verse/chorus in "${song.title}": ${JSON.stringify(snippet)}`,
      lineAt(source, here),
    );
  }
}

/**
 * Parse melbourne-songs.tex into a Songbook.
 *
 * Song numbers follow songbook.sty exactly: SBSongCnt is incremented by every
 * \begin{song} that is not commented out, including songs excluded with
 * \begin{song}[N], which consume a number but are not printed.
 */
export function parseSongbook(tex: string): Songbook {
  const text = stripComments(tex);

  const docStart = text.indexOf('\\begin{document}');
  if (docStart === -1) throw new SongbookParseError('missing \\begin{document}', 1);
  const docEndRaw = text.indexOf('\\end{document}', docStart);
  const docEnd = docEndRaw === -1 ? text.length : docEndRaw;
  const preamble = text.slice(0, docStart);

  const titleAt = preamble.search(/\\title\s*\{/);
  const title = titleAt === -1 ? 'Songbook' : convertPlain(readGroup(preamble, preamble.indexOf('{', titleAt))[0], text, titleAt);
  const relDate = preambleMacro(preamble, 'RelDate');
  const released = relDate ? convertPlain(relDate, text, 0) : undefined;

  const printAll = /\\usepackage\s*\[[^\]]*\bprintallsongs\b[^\]]*\]\s*\{songbook\}/.test(preamble);

  const songs: Song[] = [];
  const slugs = new Map<string, number>();
  const BEGIN = '\\begin{song}';
  const END = '\\end{song}';
  let counter = 0;
  let pos = docStart;

  while (true) {
    const start = text.indexOf(BEGIN, pos);
    if (start === -1 || start >= docEnd) break;
    const endAt = text.indexOf(END, start);
    if (endAt === -1 || endAt > docEnd) throw new SongbookParseError('missing \\end{song}', lineAt(text, start));
    const nested = text.indexOf(BEGIN, start + BEGIN.length);
    if (nested !== -1 && nested < endAt) {
      throw new SongbookParseError('\\begin{song} inside another song (missing \\end{song}?)', lineAt(text, nested));
    }

    counter++;
    let i = skipSpace(text, start + BEGIN.length);
    let include: string | undefined;
    [include, i] = readOptional(text, i);
    const args: string[] = [];
    const argStarts: number[] = [];
    for (let n = 0; n < 6; n++) {
      i = skipSpace(text, i);
      argStarts.push(i + 1);
      let arg: string;
      [arg, i] = readGroup(text, i, 0, text);
      args.push(arg);
    }
    pos = endAt + END.length;

    const excluded = include !== undefined && include.trim() !== 'Y' && !printAll;
    if (excluded) continue;

    const [titleTex, keyTex, copyrightTex, authorTex, scriptureTex] = args;
    const plain = (k: number) => convertPlain(args[k], text, argStarts[k]) || undefined;
    const songTitle = convertPlain(titleTex, text, argStarts[0]);
    if (!songTitle) throw new SongbookParseError('song has an empty title', lineAt(text, start));

    let slug = slugify(songTitle) || `song-${counter}`;
    const seen = slugs.get(slug) ?? 0;
    slugs.set(slug, seen + 1);
    if (seen > 0) slug = `${slug}-${seen + 1}`;

    const song: Song = {
      number: counter,
      title: songTitle,
      slug,
      refs: [],
      firstLine: '',
      sections: [],
    };
    const key = keyTex.trim() ? plain(1) : undefined;
    const copyright = copyrightTex.trim() ? plain(2) : undefined;
    const author = authorTex.trim() ? plain(3) : undefined;
    const scripture = scriptureTex.trim() ? plain(4) : undefined;
    if (key) song.key = key;
    if (copyright) song.copyright = copyright;
    if (author) song.author = author;
    if (scripture) song.scripture = scripture;

    parseSongBody(song, text.slice(i, endAt), i, text);
    if (song.sections.length === 0) {
      throw new SongbookParseError(`song "${songTitle}" has no verses`, lineAt(text, start));
    }
    const first = song.sections[0].lines[0];
    song.firstLine = first
      .map((seg) => seg.text)
      .join('')
      .replace(/\u00A0/g, ' ')
      .replace(/[\s,;:]+$/, '');
    songs.push(song);
  }

  if (songs.length === 0) throw new SongbookParseError('no songs found', lineAt(text, docStart));
  const book: Songbook = { title, songs };
  if (released) book.released = released;
  return book;
}
