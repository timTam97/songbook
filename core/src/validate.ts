import { canonicalSections, formatSongText, parseSongText, partLetter } from './markup.ts';
import type { Section, SongFields } from './types.ts';

export interface FieldError {
  /** Path of the offending value, e.g. "title", "refs[0].source", "sections[2].lines[0]". */
  field: string;
  message: string;
}

export const LIMITS = {
  title: 200,
  /** key, author, copyright, scripture, and each ref's source and ref. */
  metadata: 300,
  slug: 100,
  refs: 10,
  sections: 50,
  linesPerSection: 40,
  lineLength: 500,
  chord: 20,
  /** Serialized song, in bytes of UTF-8 JSON. */
  itemBytes: 50 * 1024,
} as const;

const OPTIONAL_TEXT = ['key', 'author', 'copyright', 'scripture'] as const;
const KINDS = new Set(['verse', 'chorus', 'section']);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Bytes of `s` in UTF-8 (no TextEncoder, so core needs neither DOM nor Node types). */
function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** "Verse 2, line 3" style position for messages the editor shows next to the lyrics. */
function where(sections: readonly unknown[], s: number, line?: number): string {
  const section = isObject(sections[s]) ? sections[s] : undefined;
  const name =
    section?.kind === 'verse' && typeof section.label === 'string'
      ? `Verse ${section.label}`
      : section?.kind === 'chorus'
        ? `Chorus (block ${s + 1})`
        : `Block ${s + 1}`;
  return line === undefined ? name : `${name}, line ${line + 1}`;
}

function checkText(errors: FieldError[], field: string, value: unknown, label: string, max: number, required: boolean): void {
  if (value === undefined && !required) return;
  if (typeof value !== 'string') {
    errors.push({ field, message: `${label} must be text.` });
    return;
  }
  if (value.trim() === '') {
    if (required || value !== '') errors.push({ field, message: `${label} can't be blank.` });
    else errors.push({ field, message: `${label} can't be empty; leave it out instead.` });
    return;
  }
  if (value !== value.trim()) errors.push({ field, message: `${label} can't start or end with spaces.` });
  if ([...value].length > max) errors.push({ field, message: `${label} is longer than ${max} characters.` });
  if (CONTROL.test(value)) errors.push({ field, message: `${label} contains a control character.` });
}

function checkSections(errors: FieldError[], sections: unknown): void {
  if (!Array.isArray(sections)) {
    errors.push({ field: 'sections', message: 'Lyrics are missing.' });
    return;
  }
  if (sections.length === 0) errors.push({ field: 'sections', message: 'A song needs at least one verse.' });
  if (sections.length > LIMITS.sections) {
    errors.push({ field: 'sections', message: `A song can have at most ${LIMITS.sections} verses and choruses.` });
  }
  let verses = 0;
  let parts = 0;
  sections.forEach((section, s) => {
    const at = `sections[${s}]`;
    if (!isObject(section)) {
      errors.push({ field: at, message: `${where(sections, s)} is not a verse or chorus.` });
      return;
    }
    if (typeof section.kind !== 'string' || !KINDS.has(section.kind)) {
      errors.push({ field: `${at}.kind`, message: `${where(sections, s)} has an unknown kind.` });
    }
    // Labels are derived (see markup.ts), so they must be exactly the running count.
    if (section.label !== undefined) {
      const expected = section.kind === 'verse' ? String(++verses) : section.kind === 'section' ? partLetter(parts++) : undefined;
      if (section.label !== expected) {
        errors.push({ field: `${at}.label`, message: `${where(sections, s)} should be labelled ${expected ?? 'nothing'}.` });
      }
    }
    const lines = section.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      errors.push({ field: `${at}.lines`, message: `${where(sections, s)} has no lines.` });
      return;
    }
    if (lines.length > LIMITS.linesPerSection) {
      errors.push({ field: `${at}.lines`, message: `${where(sections, s)} has more than ${LIMITS.linesPerSection} lines.` });
    }
    lines.forEach((line, l) => checkLine(errors, `${at}.lines[${l}]`, line, where(sections, s, l)));
  });
}

function checkLine(errors: FieldError[], field: string, line: unknown, name: string): void {
  if (!Array.isArray(line) || line.length === 0) {
    errors.push({ field, message: `${name} is empty.` });
    return;
  }
  let length = 0;
  let visible = false;
  for (const [k, seg] of line.entries()) {
    const at = `${field}[${k}]`;
    if (!isObject(seg) || typeof seg.text !== 'string') {
      errors.push({ field: at, message: `${name} has malformed text.` });
      return;
    }
    for (const flag of ['italic', 'bold'] as const) {
      if (seg[flag] !== undefined && seg[flag] !== true) errors.push({ field: `${at}.${flag}`, message: `${name}: ${flag} must be true or absent.` });
    }
    const extra = Object.keys(seg).filter((key) => !['text', 'italic', 'bold', 'chord'].includes(key));
    if (extra.length > 0) errors.push({ field: at, message: `${name} has unexpected data (${extra.join(', ')}).` });
    if (CONTROL.test(seg.text)) errors.push({ field: at, message: `${name} contains a control character or line break.` });
    length += [...seg.text].length;
    if (seg.text.trim() !== '') visible = true;
    if (seg.chord !== undefined) {
      visible = true;
      const chord = seg.chord;
      if (typeof chord !== 'string' || chord === '' || chord !== chord.trim() || /[\]\s]/.test(chord) || CONTROL.test(chord)) {
        errors.push({ field: `${at}.chord`, message: `${name} has an invalid chord.` });
      } else if (chord.length > LIMITS.chord) {
        errors.push({ field: `${at}.chord`, message: `${name} has a chord longer than ${LIMITS.chord} characters.` });
      }
    }
  }
  if (!visible) errors.push({ field, message: `${name} is blank.` });
  if (length > LIMITS.lineLength) errors.push({ field, message: `${name} is longer than ${LIMITS.lineLength} characters.` });
}

export interface ValidateOptions {
  /** On create the server picks the slug from the title, so the client may leave it out. */
  slugOptional?: boolean;
}

/**
 * Every problem with a song, as messages fit for the editor. Empty means valid.
 * Accepts untrusted input (an API body), so it checks shapes as well as limits.
 */
export function validateSong(input: unknown, options: ValidateOptions = {}): FieldError[] {
  const errors: FieldError[] = [];
  if (!isObject(input)) return [{ field: '', message: 'Expected a song.' }];

  const known = new Set(['title', 'slug', 'refs', 'sections', ...OPTIONAL_TEXT]);
  const extra = Object.keys(input).filter((key) => !known.has(key));
  if (extra.length > 0) errors.push({ field: '', message: `Unexpected fields: ${extra.join(', ')}.` });

  checkText(errors, 'title', input.title, 'Title', LIMITS.title, true);
  if (input.slug !== undefined || !options.slugOptional) {
    if (typeof input.slug !== 'string' || !SLUG.test(input.slug)) {
      errors.push({ field: 'slug', message: 'Slug must be lowercase letters and digits joined by single hyphens.' });
    } else if (input.slug.length > LIMITS.slug) {
      errors.push({ field: 'slug', message: `Slug is longer than ${LIMITS.slug} characters.` });
    }
  }
  const names: Record<(typeof OPTIONAL_TEXT)[number], string> = { key: 'Key', author: 'Author', copyright: 'Copyright', scripture: 'Scripture' };
  for (const field of OPTIONAL_TEXT) checkText(errors, field, input[field], names[field], LIMITS.metadata, false);

  if (!Array.isArray(input.refs)) {
    errors.push({ field: 'refs', message: 'References must be a list.' });
  } else {
    if (input.refs.length > LIMITS.refs) errors.push({ field: 'refs', message: `At most ${LIMITS.refs} references.` });
    input.refs.forEach((ref, k) => {
      if (!isObject(ref)) {
        errors.push({ field: `refs[${k}]`, message: `Reference ${k + 1} is malformed.` });
        return;
      }
      const extraRef = Object.keys(ref).filter((key) => key !== 'source' && key !== 'ref');
      if (extraRef.length > 0) errors.push({ field: `refs[${k}]`, message: `Reference ${k + 1} has unexpected data.` });
      checkText(errors, `refs[${k}].source`, ref.source, `Reference ${k + 1} source`, LIMITS.metadata, true);
      if (ref.ref !== '') checkText(errors, `refs[${k}].ref`, ref.ref, `Reference ${k + 1} number`, LIMITS.metadata, true);
    });
  }

  checkSections(errors, input.sections);

  if (errors.length === 0) {
    const bytes = utf8Length(JSON.stringify(input));
    if (bytes > LIMITS.itemBytes) errors.push({ field: '', message: `The song is too large (${Math.ceil(bytes / 1024)} KB; the limit is 50 KB).` });
    else if (!roundTrips(input.sections as Section[])) {
      errors.push({ field: 'sections', message: 'The lyrics are not in canonical form (see canonicalSections).' });
    }
  }
  return errors;
}

/** True when the editor markup represents these sections exactly. */
export function roundTrips(sections: readonly Section[]): boolean {
  return sameData(parseSongText(formatSongText(sections)), sections);
}

/** Deep equality of JSON-like data, ignoring object key order (DynamoDB does not keep it). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a).filter((k) => a[k] !== undefined);
  const otherKeys = Object.keys(b).filter((k) => b[k] !== undefined);
  return keys.length === otherKeys.length && keys.every((k) => sameData(a[k], b[k]));
}

const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

/**
 * Tidy an editor's input before validateSong: trim the text fields, drop
 * empty optional ones, keep only known fields, and put the lyrics in the
 * canonical form the markup gives them. Anything malformed is passed
 * through unchanged for validateSong to report.
 */
export function normalizeSongInput(input: unknown): unknown {
  if (!isObject(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) out[key] = value;
  out.title = trimmed(input.title);
  if (input.slug !== undefined) out.slug = trimmed(input.slug);
  for (const field of OPTIONAL_TEXT) {
    const value = trimmed(input[field]);
    if (value === undefined || value === '' || value === null) delete out[field];
    else out[field] = value;
  }
  if (input.refs === undefined) out.refs = [];
  else if (Array.isArray(input.refs)) {
    out.refs = input.refs.map((ref) => (isObject(ref) ? { source: trimmed(ref.source), ref: trimmed(ref.ref) ?? '' } : ref));
  }
  if (Array.isArray(input.sections) && validShape(input.sections)) out.sections = canonicalSections(input.sections);
  return out;
}

/** Just enough structure for formatSongText to run; validateSong checks the rest. */
function validShape(sections: unknown[]): sections is Section[] {
  return sections.every(
    (s) =>
      isObject(s) &&
      KINDS.has(s.kind as string) &&
      Array.isArray(s.lines) &&
      s.lines.every((line) => Array.isArray(line) && line.every((seg) => isObject(seg) && typeof seg.text === 'string' && (seg.chord === undefined || typeof seg.chord === 'string'))),
  );
}

/** Narrow a validated value. Throws if validateSong would report anything. */
export function assertValidSong(input: unknown): asserts input is SongFields {
  const errors = validateSong(input);
  if (errors.length > 0) throw new Error(`Invalid song: ${errors.map((e) => `${e.field || 'song'}: ${e.message}`).join('; ')}`);
}
