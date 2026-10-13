import { orderSongs } from './order.ts';
import { deriveFirstLine } from './song.ts';
import type { BookMeta, Section, Segment, Song, SongFields, Songbook } from './types.ts';

/** Version of the published songbook.json format. The web app refuses a book it does not understand. */
export const SCHEMA_VERSION = 1;

function copySegment(seg: Segment): Segment {
  const out: Segment = { text: seg.text };
  if (seg.italic) out.italic = true;
  if (seg.bold) out.bold = true;
  if (seg.chord !== undefined) out.chord = seg.chord;
  return out;
}

/** Fresh objects in a fixed key order, so the same content always serializes to the same bytes. */
function copySections(sections: readonly Section[]): Section[] {
  return sections.map((section) => {
    const out: Section = { kind: section.kind, lines: section.lines.map((line) => line.map(copySegment)) };
    if (section.label !== undefined) out.label = section.label;
    return out;
  });
}

/**
 * A song as the public book carries it. Only known fields are copied, so
 * storage attributes (id, version, updatedBy, ...) never leak into the book.
 */
export function toPublicSong(song: SongFields, number: number): Song {
  const out: Song = {
    number,
    title: song.title,
    slug: song.slug,
    refs: song.refs.map(({ source, ref }) => ({ source, ref })),
    firstLine: deriveFirstLine(song.sections),
    sections: copySections(song.sections),
  };
  if (song.key !== undefined) out.key = song.key;
  if (song.author !== undefined) out.author = song.author;
  if (song.copyright !== undefined) out.copyright = song.copyright;
  if (song.scripture !== undefined) out.scripture = song.scripture;
  return out;
}

/**
 * The public songbook: songs in alphabetical order (see order.ts), numbered
 * 1..n. Adding, deleting or renaming a song renumbers the songs after it.
 */
export function buildSongbook(meta: BookMeta, songs: readonly SongFields[]): Songbook {
  const book: Songbook = { schemaVersion: SCHEMA_VERSION, title: meta.title, songs: [] };
  if (meta.released !== undefined) book.released = meta.released;
  if (meta.updatedAt !== undefined) book.updatedAt = meta.updatedAt;
  book.songs = orderSongs(songs).map((song, i) => toPublicSong(song, i + 1));
  return book;
}
