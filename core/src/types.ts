/**
 * The songbook's data model. The web app, the admin portal and the Lambdas
 * all share it.
 */

/** A run of lyric text with uniform formatting. A chord, if present, sits above the first character. */
export interface Segment {
  text: string;
  italic?: boolean;
  bold?: boolean;
  chord?: string;
}

/** One printed line of a verse or chorus. */
export type Line = Segment[];

/**
 * verse   = numbered unless unlabelled (SBVerse / SBVerse* in the .tex)
 * chorus  = never labelled (SBOpGroup / SBChorus)
 * section = lettered unless unlabelled (SBSection / SBSection*); "part" in the editor
 */
export type SectionKind = 'verse' | 'chorus' | 'section';

export interface Section {
  kind: SectionKind;
  /** Verse number ("1"), section letter ("a") or undefined for unlabelled blocks. */
  label?: string;
  lines: Line[];
}

export interface SongRef {
  source: string;
  ref: string;
}

/** What an editor controls. `number` and `firstLine` are derived when the book is published. */
export interface SongFields {
  title: string;
  /** URL-safe, unique per songbook. */
  slug: string;
  key?: string;
  author?: string;
  copyright?: string;
  scripture?: string;
  refs: SongRef[];
  sections: Section[];
}

export interface Song extends SongFields {
  /** Position in the book's alphabetical order, 1..n (see order.ts). */
  number: number;
  firstLine: string;
}

export interface BookMeta {
  title: string;
  /** Free-text release date, as printed on the PDF. */
  released?: string;
  /** ISO 8601 time of the latest edit to the book. */
  updatedAt?: string;
}

export interface Songbook extends BookMeta {
  /** Set on books built by buildSongbook (see SCHEMA_VERSION); absent from the .tex parser's output. */
  schemaVersion?: number;
  songs: Song[];
}

/** A book to import into an empty table: the seed deploy asset, and what `npm run seed` sends. */
export interface SeedFile {
  /** Where the book came from, e.g. "melbourne-songs.tex@1a2b3c4". */
  source: string;
  book: Songbook;
}
