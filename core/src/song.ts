import type { Line, Section } from './types.ts';

export const lineText = (line: Line): string => line.map((seg) => seg.text).join('');

/** The first lyric line as plain text, for the index and search: no non-breaking spaces or trailing punctuation. */
export function deriveFirstLine(sections: readonly Section[]): string {
  const first = sections[0]?.lines[0];
  if (!first) return '';
  return lineText(first)
    .replace(/\u00A0/g, ' ')
    .replace(/[\s,;:]+$/, '');
}

/** URL-safe slug: "There’s A Hill Lone And Gray" -> "theres-a-hill-lone-and-gray". */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Longest slug uniqueSlug produces before any "-2" suffix; validateSong allows 100. */
export const MAX_GENERATED_SLUG = 80;

/** `slugify(title)`, cut to a word boundary if long, with "-2", "-3", ... appended until `isTaken` says the slug is free. */
export function uniqueSlug(title: string, isTaken: (slug: string) => boolean): string {
  let root = slugify(title) || 'song';
  if (root.length > MAX_GENERATED_SLUG) {
    const cut = root.slice(0, MAX_GENERATED_SLUG + 1);
    root = (cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut.slice(0, MAX_GENERATED_SLUG)).replace(/-+$/, '');
  }
  if (!isTaken(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
}
