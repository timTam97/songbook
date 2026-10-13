import { SCHEMA_VERSION, type Songbook } from '@songbook/core';
import { useRouteLoaderData } from 'react-router';
import { createSearch, type Search } from './search.ts';
import { indexSongbook, type SongIndex } from './songbook.ts';

/** The published book, indexed for lookups and search. */
export interface SongData {
  index: SongIndex;
  search: Search;
}

/** A load failure worth showing the reader, with a retry. */
export class SongbookLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SongbookLoadError';
  }
}

export const SONGBOOK_URL = '/songbook.json';

let pending: Promise<SongData> | undefined;

async function fetchSongbook(fetchImpl: typeof fetch): Promise<SongData> {
  let res: Response;
  try {
    // Same request as index.html's <link rel="preload" as="fetch" crossorigin>, so the preload is reused.
    res = await fetchImpl(SONGBOOK_URL, { credentials: 'same-origin' });
  } catch {
    throw new SongbookLoadError('The songbook could not be loaded. Check your connection and try again.');
  }
  if (!res.ok) throw new SongbookLoadError(`The songbook could not be loaded (error ${res.status}). Try again in a moment.`);
  let book: Songbook;
  try {
    book = (await res.json()) as Songbook;
  } catch {
    throw new SongbookLoadError('The songbook could not be read. Try again in a moment.');
  }
  if (book?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(book.songs)) {
    throw new SongbookLoadError('This page is out of date. Reload it to get the latest version.');
  }
  const index = indexSongbook(book);
  return { index, search: createSearch(index) };
}

/** Fetches /songbook.json once per page load. A failed load is not cached, so retrying fetches again. */
export function loadSongbook(fetchImpl: typeof fetch = fetch): Promise<SongData> {
  pending ??= fetchSongbook(fetchImpl).catch((err: unknown) => {
    pending = undefined;
    throw err;
  });
  return pending;
}

/** For tests: forget the cached book. */
export function resetSongbookCache(): void {
  pending = undefined;
}

/** The book, from the root route's loader. Only usable below the root route. */
export function useSongData(): SongData {
  const data = useRouteLoaderData('root') as SongData | undefined;
  if (!data) throw new Error('useSongData() must be used below the root route');
  return data;
}
