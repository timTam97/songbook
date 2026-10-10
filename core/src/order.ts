/**
 * The book is alphabetical: a song's number is its position in this order.
 *
 * The rule is the one sort_songs.py has always applied to the .tex: lowercase
 * the title and compare by code point. The .tex spells apostrophes `'` where
 * the parser emits `’`, so curly apostrophes count as `'` here.
 */
export function songOrderKey(title: string): string {
  return title.toLowerCase().replace(/[’‘]/g, "'");
}

/** Compares strings by Unicode code point, as Python does (JS `<` compares UTF-16 code units). */
export function compareCodePoints(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

export interface Orderable {
  title: string;
  slug: string;
}

/** Book order. Two songs with the same title are ordered by slug, which is unique. */
export function compareSongs(a: Orderable, b: Orderable): number {
  return compareCodePoints(songOrderKey(a.title), songOrderKey(b.title)) || compareCodePoints(a.slug, b.slug);
}

/** A sorted copy, in book order. Song n is at index n - 1. */
export function orderSongs<T extends Orderable>(songs: readonly T[]): T[] {
  return [...songs].sort(compareSongs);
}
