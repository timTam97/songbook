import MiniSearch from 'minisearch';
import { lineText, songText, type Song, type SongIndex } from './songbook.ts';

/** Case/diacritic/apostrophe-insensitive term: "God’s" and "gods" both become "gods". */
export function normalizeTerm(term: string): string {
  return term
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '');
}

const WORD = /[\p{L}\p{N}'’‘]+/gu;
const tokenize = (text: string): string[] => text.match(WORD) ?? [];

export interface Snippet {
  text: string;
  /** [start, end) character ranges of matched words within `text`. */
  ranges: Array<[number, number]>;
}

export interface SearchHit {
  song: Song;
  /** 'number' when the query was the hymn's number. */
  via: 'number' | 'text';
  /** A lyric line containing the match, when the title alone does not explain the hit. */
  snippet?: Snippet;
}

interface Doc {
  id: number;
  title: string;
  firstLine: string;
  author: string;
  lyrics: string;
}

function findSnippet(song: Song, terms: Set<string>): Snippet | undefined {
  let best: Snippet | undefined;
  let bestHits = 0;
  for (const section of song.sections) {
    for (const line of section.lines) {
      const text = lineText(line).replace(/\u00A0/g, ' ');
      const ranges: Array<[number, number]> = [];
      const seen = new Set<string>();
      for (const m of text.matchAll(WORD)) {
        const term = normalizeTerm(m[0]);
        if (terms.has(term)) {
          ranges.push([m.index, m.index + m[0].length]);
          seen.add(term);
        }
      }
      if (seen.size > bestHits) {
        best = { text, ranges };
        bestHits = seen.size;
        if (bestHits === terms.size) return best;
      }
    }
  }
  return best;
}

export function createSearch(index: SongIndex) {
  const mini = new MiniSearch<Doc>({
    fields: ['title', 'firstLine', 'author', 'lyrics'],
    tokenize,
    processTerm: (term) => normalizeTerm(term) || null,
    searchOptions: {
      boost: { title: 4, firstLine: 2.5, author: 2 },
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      combineWith: 'AND',
    },
  });
  mini.addAll(
    index.songs.map((s) => ({
      id: s.number,
      title: s.title,
      firstLine: s.firstLine,
      author: s.author ?? '',
      lyrics: songText(s),
    })),
  );

  return function search(query: string, limit = 50): SearchHit[] {
    const q = query.trim();
    if (q === '') return [];
    const hits: SearchHit[] = [];

    const asNumber = /^#?\s*(\d{1,4})$/.exec(q);
    if (asNumber) {
      const song = index.byNumber.get(Number(asNumber[1]));
      if (song) hits.push({ song, via: 'number' });
      if (asNumber[0].startsWith('#')) return hits;
    }

    let results = mini.search(q);
    if (results.length === 0) results = mini.search(q, { combineWith: 'OR' });

    for (const r of results) {
      if (hits.length >= limit) break;
      const song = index.byNumber.get(r.id as number)!;
      if (hits.some((h) => h.song === song)) continue;
      const terms = new Set(r.terms);
      const titleExplains = tokenize(song.title).some((w) => terms.has(normalizeTerm(w)));
      const snippet = titleExplains ? undefined : findSnippet(song, terms);
      hits.push({ song, via: 'text', ...(snippet ? { snippet } : {}) });
    }
    return hits;
  };
}

export type Search = ReturnType<typeof createSearch>;
