/**
 * Rebuilds the public songbook.json from the table and puts it in the site bucket.
 *
 * Invoked by:
 *  - the table's stream (SONG items and BOOK/META only), batched so a burst of
 *    saves is one publish; skipped when the book has not changed;
 *  - the deploy, after the seed and before the new index.html goes live;
 *  - the admin API's Republish button and `npm run republish`.
 * The last two always write (a forced publish).
 *
 * Reserved concurrency 1 keeps two publishes from racing.
 */
import { createHash } from 'node:crypto';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildSongbook, validateSong } from '@songbook/core';
import { doc, env, getItem, getMeta, keys, listSongs, log, songFields, tableName, type PublishItem } from './store.ts';

export const SONGBOOK_KEY = 'songbook.json';
export const SONGBOOK_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({});

export interface PublishResult {
  published: boolean;
  reason?: 'not-seeded' | 'unchanged';
  songs?: number;
  hash?: string;
  publishedAt?: string;
}

export async function publish({ force }: { force: boolean }): Promise<PublishResult> {
  const meta = await getMeta();
  if (!meta) {
    // The seed writes META last, so this is an empty or half-seeded table.
    log('not seeded yet; nothing published');
    return { published: false, reason: 'not-seeded' };
  }
  const songs = (await listSongs()).map(songFields);
  if (songs.length === 0) throw new Error('Refusing to publish a songbook with no songs');

  const invalid = songs.flatMap((song) => {
    const errors = validateSong(song);
    return errors.length > 0 ? [`${song.slug}: ${errors.map((e) => e.message).join(' ')}`] : [];
  });
  if (invalid.length > 0) throw new Error(`Refusing to publish invalid songs: ${invalid.join('; ')}`);

  const book = buildSongbook({ title: meta.title, released: meta.released, updatedAt: meta.updatedAt }, songs);
  const body = JSON.stringify(book);
  const hash = createHash('sha256').update(body).digest('hex');

  if (!force) {
    const last = await getItem<PublishItem>(keys.publish);
    if (last?.publishedHash === hash) {
      log('songbook unchanged; not republished', { hash });
      return { published: false, reason: 'unchanged', songs: songs.length, hash };
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: env('BUCKET_NAME'),
      Key: SONGBOOK_KEY,
      Body: body,
      ContentType: 'application/json',
      CacheControl: SONGBOOK_CACHE_CONTROL,
    }),
  );
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: env('DISTRIBUTION_ID'),
      InvalidationBatch: { CallerReference: `songbook-${hash.slice(0, 16)}-${Date.now()}`, Paths: { Quantity: 1, Items: [`/${SONGBOOK_KEY}`] } },
    }),
  );

  const publishedAt = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: keys.publish,
      UpdateExpression: 'SET publishedAt = :at, publishedHash = :hash, songCount = :n, bookUpdatedAt = :updated',
      ExpressionAttributeValues: { ':at': publishedAt, ':hash': hash, ':n': songs.length, ':updated': meta.updatedAt },
    }),
  );
  log('published songbook.json', { songs: songs.length, hash, force });
  return { published: true, songs: songs.length, hash, publishedAt };
}

const isStreamEvent = (event: unknown) => typeof event === 'object' && event !== null && Array.isArray((event as { Records?: unknown }).Records);

export async function handler(event: unknown): Promise<PublishResult> {
  return publish({ force: !isStreamEvent(event) });
}
