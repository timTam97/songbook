/**
 * Fills an empty table from a seed songbook, once.
 *
 * Runs on the first deploy (a CDK Trigger) with the seed file shipped as a
 * deploy asset, and from `npm run seed`, which passes the book in the event.
 * It is a no-op once BOOK/META exists. META is written last, so a seed that
 * was interrupted resumes where it stopped, and the publisher never sees a
 * half-seeded book.
 *
 * `reset` (beta only) empties the table first, so beta can pick up .tex edits
 * made on master. It discards everything edited on beta.
 */
import { randomUUID } from 'node:crypto';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BatchWriteCommand, DeleteCommand, PutCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { buildSongbook, validateSong, type SeedFile, type Song, type SongFields, type Songbook } from '@songbook/core';
import { doc, env, getMeta, keys, log, songFields, tableName, type Key, type MetaItem } from './store.ts';

export type { SeedFile };

export interface SeedEvent extends Partial<SeedFile> {
  reset?: boolean;
}

export interface SeedResult {
  seeded: boolean;
  reason?: 'already-seeded';
  songs?: number;
  skipped?: number;
  deleted?: number;
}

const s3 = new S3Client({});
const SEED_ACTOR = 'seed';

/**
 * Everything that must hold before a single item is written: every song is
 * valid and survives the editor markup, slugs are unique, and the numbers the
 * book order derives are the numbers the seed carries.
 */
export function checkSeed(book: Songbook): SongFields[] {
  const problems: string[] = [];
  if (!book || typeof book.title !== 'string' || !Array.isArray(book.songs)) throw new Error('Seed is not a songbook');
  if (book.songs.length === 0) problems.push('the seed has no songs');
  const songs = book.songs.map((song: Song) => songFields(song));
  songs.forEach((song, k) => {
    for (const e of validateSong(song)) problems.push(`song ${book.songs[k].number} (${song.slug}): ${e.field || 'song'}: ${e.message}`);
  });
  const slugs = new Set(songs.map((s) => s.slug));
  if (slugs.size !== songs.length) problems.push('slugs are not unique');
  if (problems.length === 0) {
    const derived = buildSongbook({ title: book.title }, songs).songs.map((s) => `${s.number} ${s.slug}`);
    const given = [...book.songs].sort((a, b) => a.number - b.number).map((s) => `${s.number} ${s.slug}`);
    const moved = derived.filter((d, k) => d !== given[k]);
    if (moved.length > 0) problems.push(`numbers would change: ${moved.slice(0, 5).join(', ')}${moved.length > 5 ? ', ...' : ''}`);
  }
  if (problems.length > 0) throw new Error(`Seed rejected: ${problems.join('; ')}`);
  return songs;
}

async function loadSeedAsset(): Promise<SeedFile> {
  const out = await s3.send(new GetObjectCommand({ Bucket: env('SEED_BUCKET'), Key: env('SEED_KEY') }));
  return JSON.parse(await out.Body!.transformToString('utf-8')) as SeedFile;
}

async function batchDelete(keyList: Key[]): Promise<void> {
  for (let i = 0; i < keyList.length; i += 25) {
    let requests = keyList.slice(i, i + 25).map((key) => ({ DeleteRequest: { Key: key } }));
    for (let attempt = 0; requests.length > 0; attempt++) {
      if (attempt > 8) throw new Error('DynamoDB kept returning unprocessed deletes');
      if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const out = await doc.send(new BatchWriteCommand({ RequestItems: { [tableName()]: requests } }));
      requests = (out.UnprocessedItems?.[tableName()] ?? []) as typeof requests;
    }
  }
}

/** Delete every item. META goes first, so the publisher stops publishing while the rest goes. */
async function emptyTable(): Promise<number> {
  await doc.send(new DeleteCommand({ TableName: tableName(), Key: keys.meta }));
  let deleted = 1;
  let start: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new ScanCommand({ TableName: tableName(), ProjectionExpression: 'pk, sk', ExclusiveStartKey: start, ConsistentRead: true }),
    );
    const found = (page.Items ?? []) as Key[];
    await batchDelete(found.map(({ pk, sk }) => ({ pk, sk })));
    deleted += found.length;
    start = page.LastEvaluatedKey;
  } while (start);
  return deleted;
}

/** One song, atomically: SONG, its SLUG reservation and HIST v1. False if the slug was already imported. */
async function importSong(song: SongFields, at: string): Promise<boolean> {
  const id = randomUUID();
  const table = tableName();
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: { ...keys.song(id), id, ...song, version: 1, updatedAt: at, updatedBy: SEED_ACTOR },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          { Put: { TableName: table, Item: { ...keys.slug(song.slug), id }, ConditionExpression: 'attribute_not_exists(pk)' } },
          {
            Put: {
              TableName: table,
              Item: { ...keys.history(id, 1), id, ...song, version: 1, action: 'import', changedAt: at, changedBy: SEED_ACTOR },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      }),
    );
    return true;
  } catch (err) {
    // The slug is taken: an earlier, interrupted run imported this song.
    if (err instanceof TransactionCanceledException && err.CancellationReasons?.[1]?.Code === 'ConditionalCheckFailed') return false;
    throw err;
  }
}

export async function seed(event: SeedEvent): Promise<SeedResult> {
  if (event.reset && env('STAGE') !== 'beta') throw new Error('Reset is only allowed on the beta stage');
  const file: SeedFile = event.book ? { source: event.source ?? 'event', book: event.book } : await loadSeedAsset();
  const songs = checkSeed(file.book);

  let deleted: number | undefined;
  if (event.reset) {
    deleted = await emptyTable();
    log('emptied table for reseed', { deleted });
  } else if (await getMeta()) {
    log('already seeded; nothing to do');
    return { seeded: false, reason: 'already-seeded' };
  }

  const at = new Date().toISOString();
  let skipped = 0;
  for (const song of songs) if (!(await importSong(song, at))) skipped++;

  const meta: MetaItem = { ...keys.meta, title: file.book.title, updatedAt: at, seededFrom: file.source, seededAt: at };
  if (file.book.released !== undefined) meta.released = file.book.released;
  await doc.send(new PutCommand({ TableName: tableName(), Item: meta, ConditionExpression: 'attribute_not_exists(pk)' }));
  log('seeded songbook', { songs: songs.length, skipped, source: file.source });
  return { seeded: true, songs: songs.length, skipped, ...(deleted !== undefined ? { deleted } : {}) };
}

export async function handler(event: unknown): Promise<SeedResult> {
  return seed(typeof event === 'object' && event !== null ? (event as SeedEvent) : {});
}
