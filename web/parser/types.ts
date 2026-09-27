/**
 * Data model produced from melbourne-songs.tex. This is the only contract
 * between the LaTeX source and the web app.
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
 * verse   = SBVerse / SBVerse*  (numbered unless starred)
 * chorus  = SBOpGroup / SBChorus / SBChorus*
 * section = SBSection / SBSection* (lettered unless starred)
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

export interface Song {
  /** The song's number exactly as printed in the PDF (songbook's SBSongCnt counter). */
  number: number;
  title: string;
  /** URL-safe, unique per songbook. */
  slug: string;
  key?: string;
  author?: string;
  copyright?: string;
  scripture?: string;
  refs: SongRef[];
  firstLine: string;
  sections: Section[];
}

export interface Songbook {
  title: string;
  released?: string;
  songs: Song[];
}
