import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSongbook } from '../../parser/parse.ts';
import { createSearch, normalizeTerm } from './search.ts';
import { indexSongbook, neighbours, resolveSong, songPath } from './songbook.ts';

const tex = readFileSync(fileURLToPath(new URL('../../../melbourne-songs.tex', import.meta.url)), 'utf8');
const index = indexSongbook(parseSongbook(tex));
const search = createSearch(index);
const byTitle = (title: string) => index.songs.find((s) => s.title === title)!;

describe('search', () => {
  it('goes straight to a hymn by its number', () => {
    const hits = search('6');
    expect(hits[0]).toMatchObject({ via: 'number', song: { number: 6, title: 'Because He Lives' } });
    expect(search('#96')).toHaveLength(1);
    expect(search('#96')[0].song.title).toBe('You Are My All In All');
    expect(search('#999')).toEqual([]);
  });

  it('ranks title matches first', () => {
    expect(search('ancient of days')[0].song.title).toBe('Ancient Of Days');
  });

  it('matches while typing (prefix) and tolerates typos', () => {
    expect(search('ancie')[0].song.title).toBe('Ancient Of Days');
    expect(search('ancinet days')[0].song.title).toBe('Ancient Of Days');
  });

  it('finds lyrics and returns a highlighted snippet', () => {
    const hit = search('fairest of ten thousand').find((h) => h.song.title === 'All That Thrills My Soul Is Jesus');
    expect(hit?.snippet?.text).toBe('And the fairest of ten thousand');
    const [start, end] = hit!.snippet!.ranges[0];
    expect(hit!.snippet!.text.slice(start, end).toLowerCase()).toMatch(/fairest|of|ten|thousand/);
  });

  it('ignores apostrophe style and diacritics', () => {
    expect(normalizeTerm('God’s')).toBe('gods');
    expect(normalizeTerm("God's")).toBe('gods');
    expect(normalizeTerm('Café')).toBe('cafe');
    const curly = search('jesus’ blood').map((h) => h.song.number);
    expect(search("jesus' blood").map((h) => h.song.number)).toEqual(curly);
    expect(curly.length).toBeGreaterThan(0);
  });

  it('searches authors', () => {
    const titles = search('fanny crosby').map((h) => h.song.author);
    expect(titles.length).toBeGreaterThanOrEqual(6);
    expect(titles.slice(0, 6).every((a) => a === 'Fanny Crosby')).toBe(true);
  });

  it('returns nothing for an empty query', () => {
    expect(search('   ')).toEqual([]);
  });
});

describe('song lookup', () => {
  it('resolves by number, and prefers a matching slug', () => {
    const lives = byTitle('Because He Lives');
    expect(resolveSong(index, '6', undefined)).toBe(lives);
    expect(resolveSong(index, '1', lives.slug)).toBe(lives); // stale number, correct slug
    expect(resolveSong(index, '6', 'no-such-song')).toBe(lives);
    expect(resolveSong(index, 'abc', undefined)).toBeUndefined();
    expect(songPath(lives)).toBe('/songs/6/because-he-lives');
  });

  it('links neighbours by number', () => {
    expect(neighbours(index, index.byNumber.get(1)!).prev).toBeUndefined();
    expect(neighbours(index, index.byNumber.get(1)!).next?.number).toBe(2);
    expect(neighbours(index, index.byNumber.get(index.last)!).next).toBeUndefined();
  });
});
