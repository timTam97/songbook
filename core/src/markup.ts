/**
 * The admin editor's lyric markup, and its conversion to and from sections.
 *
 *     Amazing grace! How sweet the sound
 *     That saved a wretch like me!
 *
 *     {chorus}
 *     Who saved us from eternal loss? *(Who but God's Son upon the cross?)*
 *
 * - Blank lines separate blocks. A block is a numbered verse unless its first
 *   line is a header: {chorus}, {verse} (the default), {verse*} (unnumbered),
 *   {part} (a lettered section) or {part*} (unlettered). Headers are
 *   case-insensitive. Labels are never typed: verses are numbered 1..n and
 *   parts lettered a, b, c in order.
 * - Inline: *italic*, **bold**, and [G] for a chord over the text that follows.
 *   Markers toggle and never span lines. A backslash escapes * [ { and \.
 * - Spaces and tabs are collapsed and trimmed; non-breaking spaces and curly
 *   quotes pass through untouched. Adjacent text with identical formatting is
 *   one segment, so parse -> format -> parse is stable.
 */
import type { Line, Section, SectionKind, Segment } from './types.ts';

interface BlockSpec {
  kind: SectionKind;
  labelled: boolean;
}

const HEADERS: Record<string, BlockSpec> = {
  chorus: { kind: 'chorus', labelled: false },
  verse: { kind: 'verse', labelled: true },
  'verse*': { kind: 'verse', labelled: false },
  part: { kind: 'section', labelled: true },
  'part*': { kind: 'section', labelled: false },
};

const HEADER_LINE = /^\{\s*(chorus|verse\*?|part\*?)\s*\}$/i;
const DEFAULT_BLOCK: BlockSpec = HEADERS.verse;
const ESCAPABLE = new Set(['*', '[', '{', '\\']);

/** 0 -> "a", 25 -> "z", 26 -> "aa". */
export function partLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const sameStyle = (a: Segment, b: Segment) => !!a.italic === !!b.italic && !!a.bold === !!b.bold;
const isEmpty = (seg: Segment) => seg.text === '' && seg.chord === undefined;
/** A chord over nothing yet: "[G]" with no text after it on the line, or before another chord. */
const isBareChord = (seg: Segment) => seg.text === '' && seg.chord !== undefined;

/**
 * Canonical segments:
 *  - no empty segments;
 *  - a bare chord followed by text without a chord takes that text (the chord sits over it);
 *  - neighbours with the same formatting and no chord between them are one segment;
 *  - a bare chord has no formatting, since it has no text to format.
 */
function mergeNeighbours(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (isEmpty(seg)) continue;
    const prev = out.at(-1);
    if (prev && seg.chord === undefined && isBareChord(prev)) {
      out[out.length - 1] = { ...seg, chord: prev.chord };
    } else if (prev && seg.chord === undefined && sameStyle(prev, seg)) {
      prev.text += seg.text;
    } else {
      out.push({ ...seg });
    }
  }
  for (const seg of out) {
    if (isBareChord(seg)) {
      delete seg.italic;
      delete seg.bold;
    }
  }
  return out;
}

/** Collapse and trim spaces (not non-breaking ones) and merge neighbours with the same formatting. */
export function tidyLine(segments: readonly Segment[]): Line {
  const merged = mergeNeighbours(segments);
  let prevEndsSpace = true; // the line start counts as a space, so leading spaces go
  for (const seg of merged) {
    seg.text = seg.text.replace(/[ \t]+/g, ' ');
    if (prevEndsSpace) seg.text = seg.text.replace(/^ /, '');
    if (seg.text !== '') prevEndsSpace = seg.text.endsWith(' ');
  }
  for (let k = merged.length - 1; k >= 0; k--) {
    merged[k].text = merged[k].text.replace(/ $/, '');
    if (!isEmpty(merged[k])) break;
  }
  // Dropping a segment that became empty can leave two compatible neighbours.
  return mergeNeighbours(merged);
}

function parseLine(raw: string): Line {
  const segments: Segment[] = [];
  let italic = false;
  let bold = false;
  let text = '';
  let chord: string | undefined;

  const push = () => {
    if (text === '' && chord === undefined) return;
    const seg: Segment = { text };
    if (italic) seg.italic = true;
    if (bold) seg.bold = true;
    if (chord !== undefined) seg.chord = chord;
    segments.push(seg);
    text = '';
    chord = undefined;
  };

  for (let i = 0; i < raw.length; ) {
    const c = raw[i];
    if (c === '\\' && ESCAPABLE.has(raw[i + 1] ?? '')) {
      text += raw[i + 1];
      i += 2;
      continue;
    }
    if (c === '*') {
      // A chord waiting for its text keeps waiting: "[G]*word*" puts G over the italic word.
      if (text !== '') push();
      if (raw[i + 1] === '*') {
        bold = !bold;
        i += 2;
      } else {
        italic = !italic;
        i += 1;
      }
      continue;
    }
    if (c === '[') {
      const end = raw.indexOf(']', i + 1);
      if (end !== -1) {
        push();
        chord = raw.slice(i + 1, end).trim();
        i = end + 1;
        continue;
      }
    }
    text += c;
    i++;
  }
  push();
  return tidyLine(segments);
}

/** Editor markup -> sections. Never throws; validateSong reports anything out of bounds. */
export function parseSongText(markup: string): Section[] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of markup.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*$/.test(line)) {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length > 0) blocks.push(block);

  const sections: Section[] = [];
  let verses = 0;
  let parts = 0;
  // A header on a line of its own, followed by a blank line, applies to the next block.
  let pending: BlockSpec | undefined;
  for (const raw of blocks) {
    let spec = pending ?? DEFAULT_BLOCK;
    pending = undefined;
    let rows = raw;
    const header = HEADER_LINE.exec(raw[0].trim());
    if (header) {
      spec = HEADERS[header[1].toLowerCase()];
      rows = raw.slice(1);
      if (rows.length === 0) {
        pending = spec;
        continue;
      }
    }
    const lines = rows.map(parseLine).filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    const section: Section = { kind: spec.kind, lines };
    if (spec.labelled) section.label = spec.kind === 'verse' ? String(++verses) : partLetter(parts++);
    sections.push(section);
  }
  return sections;
}

function escapeText(text: string, atLineStart: boolean): string {
  const escaped = text.replace(/[\\*[]/g, (c) => `\\${c}`);
  return atLineStart && escaped.startsWith('{') ? `\\${escaped}` : escaped;
}

function formatLine(line: Line): string {
  let out = '';
  let italic = false;
  let bold = false;
  for (const seg of line) {
    // The chord goes before any style change: a chord waits through "*" and "**" for its text,
    // so "[G]*word*" puts G over the italic word, while "*a[G]*" closes the italic first.
    if (seg.chord !== undefined) out += `[${seg.chord}]`;
    if (seg.text === '') continue; // a bare chord has no formatting
    // Bold before italic, both when opening and closing: "***" always reads as "**" then "*".
    if (!!seg.bold !== bold) {
      out += '**';
      bold = !bold;
    }
    if (!!seg.italic !== italic) {
      out += '*';
      italic = !italic;
    }
    out += escapeText(seg.text, out === '');
  }
  if (bold) out += '**';
  if (italic) out += '*';
  return out;
}

function sectionHeader(section: Section): string | undefined {
  if (section.kind === 'chorus') return '{chorus}';
  if (section.kind === 'section') return section.label === undefined ? '{part*}' : '{part}';
  return section.label === undefined ? '{verse*}' : undefined;
}

/** Sections -> editor markup. Inverse of parseSongText for any validated song. */
export function formatSongText(sections: readonly Section[]): string {
  return sections
    .map((section) => {
      const header = sectionHeader(section);
      const lines = section.lines.map(formatLine);
      return (header ? [header, ...lines] : lines).join('\n');
    })
    .join('\n\n');
}

/** The form parseSongText gives these sections: labels renumbered, segments tidied and merged. */
export function canonicalSections(sections: readonly Section[]): Section[] {
  return parseSongText(formatSongText(sections));
}
