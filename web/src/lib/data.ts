import book from 'virtual:songbook';
import { createSearch } from './search.ts';
import { indexSongbook } from './songbook.ts';

export const index = indexSongbook(book);
export const search = createSearch(index);
