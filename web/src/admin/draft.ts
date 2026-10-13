/**
 * What the editor works on: the song's fields as form strings plus its lyrics
 * in the editor markup, and the conversions to and from the API's song.
 */
import {
  compareSongs,
  formatSongText,
  normalizeSongInput,
  orderSongs,
  parseSongText,
  slugify,
  validateSong,
  type AdminSong,
  type FieldError,
  type SongSummary,
} from '@songbook/core';

export interface Draft {
  title: string;
  slug: string;
  key: string;
  author: string;
  copyright: string;
  scripture: string;
  refs: Array<{ source: string; ref: string }>;
  lyrics: string;
}

export const emptyDraft = (): Draft => ({ title: '', slug: '', key: '', author: '', copyright: '', scripture: '', refs: [], lyrics: '' });

export function toDraft(song: AdminSong): Draft {
  return {
    title: song.title,
    slug: song.slug,
    key: song.key ?? '',
    author: song.author ?? '',
    copyright: song.copyright ?? '',
    scripture: song.scripture ?? '',
    refs: song.refs.map(({ source, ref }) => ({ source, ref })),
    lyrics: formatSongText(song.sections),
  };
}

/** The API body for a draft, normalized the way the server will normalize it. An empty slug is left to the server. */
export function toInput(draft: Draft): Record<string, unknown> {
  const input: Record<string, unknown> = {
    title: draft.title,
    key: draft.key,
    author: draft.author,
    copyright: draft.copyright,
    scripture: draft.scripture,
    refs: draft.refs.filter((r) => r.source.trim() !== '' || r.ref.trim() !== ''),
    sections: parseSongText(draft.lyrics),
  };
  if (draft.slug.trim() !== '') input.slug = draft.slug;
  return normalizeSongInput(input) as Record<string, unknown>;
}

/** What validateSong would say about the draft, as the server will. */
export function draftErrors(draft: Draft, isNew: boolean): FieldError[] {
  return validateSong(toInput(draft), { slugOptional: isNew });
}

/** Two drafts that would save the same song. */
export const sameDraft = (a: Draft, b: Draft) => JSON.stringify(toInput(a)) === JSON.stringify(toInput(b));

/**
 * Where the song would sit in the book with this title: its number now (undefined
 * for a new song) and after saving. Numbers are positions in alphabetical order.
 */
export function positions(songs: readonly SongSummary[], id: string | undefined, title: string, slug: string): { now?: number; after: number } {
  const me = { id: id ?? '\0new', title: title.trim(), slug: slug.trim() || slugify(title) };
  const others = songs.filter((s) => s.id !== id);
  const after = orderSongs([...others, me]).indexOf(me) + 1;
  const now = id ? songs.find((s) => s.id === id)?.number : undefined;
  return { now, after };
}

/** How many songs move up a number if this one is deleted. */
export const songsAfter = (songs: readonly SongSummary[], id: string): number => {
  const me = songs.find((s) => s.id === id);
  return me ? songs.filter((s) => compareSongs(s, me) > 0).length : 0;
};
