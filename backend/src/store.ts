/**
 * The single DynamoDB table each stage keeps its songbook in.
 *
 *   BOOK     / META         book title and release text, updatedAt (bumped by every edit), seededFrom
 *   BOOK     / PUBLISH      what the publisher last wrote to S3 (kept apart from META so the
 *                          publisher's own write does not trigger another publish)
 *   SONG     / <id>         the current song: SongFields + version, updatedAt, updatedBy
 *   HIST#<id>/ v000003      a snapshot of every version, append-only while the song exists
 *   DELETED  / <id>         safety copy of a deleted song, removed by TTL after 30 days
 *   SLUG     / <slug>       reservation, so two songs can never share a slug
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, paginateQuery } from '@aws-sdk/lib-dynamodb';
import type { SongFields } from '@songbook/core';

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

export const getMeta = () => getItem<MetaItem>(keys.meta);
export const listSongs = () => queryPartition<SongItem>('SONG');

/** One JSON log line, so CloudWatch Logs Insights can filter on fields. */
export function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ message, ...fields }));
}
