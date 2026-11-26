/**
 * The single DynamoDB table each stage keeps its songbook in.
 *
 *   BOOK     / META         book title and release text, updatedAt (bumped by every edit), seededFrom
 *   BOOK     / PUBLISH      what the publisher last wrote to S3 (kept apart from META so the
 *                          publisher's own write does not trigger another publish)
 *   BOOK     / PDF          what the PDF generator last wrote to S3; through the stream, a new
 *                          PDF republishes songbook.json, which carries its date
 *   SONG     / <id>         the current song: SongFields + version, updatedAt, updatedBy
 *   HIST#<id>/ v000003      a snapshot of every version, append-only while the song exists
 *   DELETED  / <id>         safety copy of a deleted song, removed by TTL after 30 days
 *   SLUG     / <slug>       reservation, so two songs can never share a slug
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, paginateQuery } from '@aws-sdk/lib-dynamodb';
import { validateSong, type SongFields } from '@songbook/core';

export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const tableName = () => env('TABLE_NAME');

export type Key = { pk: string; sk: string };

export const keys = {
  meta: { pk: 'BOOK', sk: 'META' },
  publish: { pk: 'BOOK', sk: 'PUBLISH' },
  pdf: { pk: 'BOOK', sk: 'PDF' },
  song: (id: string): Key => ({ pk: 'SONG', sk: id }),
  history: (id: string, version: number): Key => ({ pk: `HIST#${id}`, sk: versionKey(version) }),
  deleted: (id: string): Key => ({ pk: 'DELETED', sk: id }),
  slug: (slug: string): Key => ({ pk: 'SLUG', sk: slug }),
};

/** v000001: sorts in version order, as a sort key must. */
export const versionKey = (version: number): string => `v${String(version).padStart(6, '0')}`;

export interface MetaItem extends Key {
  title: string;
  released?: string;
  /** ISO time of the latest edit; the public book shows it as "updated". */
  updatedAt: string;
  seededFrom?: string;
  seededAt?: string;
}

export interface PublishItem extends Key {
  publishedAt: string;
  publishedHash: string;
  songCount: number;
  /** META.updatedAt of the book that was published. */
  bookUpdatedAt?: string;
}

export interface PdfItem extends Key {
  generatedAt: string;
  generatedBy: string;
  /** META.updatedAt of the book the PDF was generated from. */
  bookUpdatedAt: string;
  songCount: number;
  pages: number;
  bytes: number;
  /** sha256 of the PDF. */
  hash: string;
}

export interface SongItem extends Key, SongFields {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export type { HistoryAction } from '@songbook/core';
import type { HistoryAction } from '@songbook/core';

export interface SlugItem extends Key {
  id: string;
}

export interface HistoryItem extends Key, SongFields {
  id: string;
  version: number;
  action: HistoryAction;
  changedAt: string;
  changedBy: string;
  /** For a revert: the version whose content was copied. */
  revertedFrom?: number;
}

export interface DeletedItem extends Key, SongFields {
  id: string;
  version: number;
  deletedAt: string;
  deletedBy: string;
  /** Epoch seconds; DynamoDB's TTL removes the item after this. */
  expiresAt: number;
}

/** Just the editable content of a stored song, history snapshot or deleted copy. */
export function songFields(item: SongFields): SongFields {
  const out: SongFields = { title: item.title, slug: item.slug, refs: item.refs ?? [], sections: item.sections };
  if (item.key !== undefined) out.key = item.key;
  if (item.author !== undefined) out.author = item.author;
  if (item.copyright !== undefined) out.copyright = item.copyright;
  if (item.scripture !== undefined) out.scripture = item.scripture;
  return out;
}

export async function getItem<T>(key: Key, consistent = true): Promise<T | undefined> {
  const out = await doc.send(new GetCommand({ TableName: tableName(), Key: key, ConsistentRead: consistent }));
  return out.Item as T | undefined;
}

export async function queryPartition<T>(pk: string, options: { consistent?: boolean; descending?: boolean } = {}): Promise<T[]> {
  const items: T[] = [];
  const pages = paginateQuery(
    { client: doc },
    {
      TableName: tableName(),
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ConsistentRead: options.consistent ?? true,
      ScanIndexForward: !options.descending,
    },
  );
  for await (const page of pages) items.push(...((page.Items ?? []) as T[]));
  return items;
}

/** The items at `keyList` that exist (in no particular order), with just the `attributes` named. */
export async function batchGet<T>(keyList: Key[], attributes: string[]): Promise<T[]> {
  const table = tableName();
  const names = Object.fromEntries(attributes.map((a, k) => [`#a${k}`, a]));
  const items: T[] = [];
  for (let i = 0; i < keyList.length; i += 100) {
    let pending: Key[] = keyList.slice(i, i + 100);
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt > 8) throw new Error('DynamoDB kept returning unprocessed reads');
      if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const out = await doc.send(
        new BatchGetCommand({
          RequestItems: {
            [table]: { Keys: pending, ProjectionExpression: Object.keys(names).join(', '), ExpressionAttributeNames: names, ConsistentRead: true },
          },
        }),
      );
      items.push(...((out.Responses?.[table] ?? []) as T[]));
      pending = (out.UnprocessedKeys?.[table]?.Keys ?? []) as Key[];
    }
  }
  return items;
}

export const getMeta = () => getItem<MetaItem>(keys.meta);
export const listSongs = () => queryPartition<SongItem>('SONG');

/**
 * The book's metadata and every current song, checked the way the public book
 * needs them: undefined before the seed has written META, and an error for a
 * book with no songs or an invalid song.
 */
export async function loadBook(): Promise<{ meta: MetaItem; songs: SongFields[] } | undefined> {
  const meta = await getMeta();
  // The seed writes META last, so this is an empty or half-seeded table.
  if (!meta) return undefined;
  const songs = (await listSongs()).map(songFields);
  if (songs.length === 0) throw new Error('Refusing to publish a songbook with no songs');
  const invalid = songs.flatMap((song) => {
    const errors = validateSong(song);
    return errors.length > 0 ? [`${song.slug}: ${errors.map((e) => e.message).join(' ')}`] : [];
  });
  if (invalid.length > 0) throw new Error(`Refusing to publish invalid songs: ${invalid.join('; ')}`);
  return { meta, songs };
}

/** One JSON log line, so CloudWatch Logs Insights can filter on fields. */
export function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ message, ...fields }));
}
