import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler, SONGBOOK_CACHE_CONTROL } from '../src/publish.ts';
import { META, setEnv, songItem } from './fixtures.ts';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);
const cf = mockClient(CloudFrontClient);

const STREAM_EVENT = { Records: [{ eventName: 'MODIFY', dynamodb: { Keys: { pk: { S: 'SONG' }, sk: { S: 'a' } } } }] };

function givenTable(meta: unknown, songs: unknown[], publish?: unknown) {
  ddb.on(GetCommand, { Key: { pk: 'BOOK', sk: 'META' } }).resolves({ Item: meta as Record<string, unknown> | undefined });
  ddb.on(GetCommand, { Key: { pk: 'BOOK', sk: 'PUBLISH' } }).resolves({ Item: publish as Record<string, unknown> | undefined });
  ddb.on(QueryCommand).resolves({ Items: songs as Record<string, unknown>[] });
}

beforeEach(() => {
  ddb.reset();
  s3.reset();
  cf.reset();
  s3.on(PutObjectCommand).resolves({});
  cf.on(CreateInvalidationCommand).resolves({});
  ddb.on(UpdateCommand).resolves({});
  setEnv({ TABLE_NAME: 'table', BUCKET_NAME: 'bucket', DISTRIBUTION_ID: 'DIST' });
});

const published = (): Record<string, unknown> => JSON.parse(String(s3.commandCalls(PutObjectCommand)[0].args[0].input.Body));

describe('publish', () => {
  it('writes the numbered book to songbook.json with the right headers, invalidates it and records the publish', async () => {
    givenTable(META, [songItem('2', 'Bravo'), songItem('1', 'Alpha', 4)]);
    const result = await handler({});
    expect(result).toMatchObject({ published: true, songs: 2 });

    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(put).toMatchObject({ Bucket: 'bucket', Key: 'songbook.json', ContentType: 'application/json', CacheControl: SONGBOOK_CACHE_CONTROL });
    expect(SONGBOOK_CACHE_CONTROL).toBe('public, max-age=0, must-revalidate');
    const book = published() as { schemaVersion: number; title: string; updatedAt: string; songs: Array<Record<string, unknown>> };
    expect(book).toMatchObject({ schemaVersion: 1, title: 'Test Songs', updatedAt: META.updatedAt });
    expect(book.songs.map((s) => [s.number, s.title, s.firstLine])).toEqual([
      [1, 'Alpha', 'Alpha first line'],
      [2, 'Bravo', 'Bravo first line'],
    ]);
    // Storage attributes stay private.
    expect(Object.keys(book.songs[0])).not.toContain('version');
    expect(Object.keys(book.songs[0])).not.toContain('updatedBy');

    expect(cf.commandCalls(CreateInvalidationCommand)[0].args[0].input).toMatchObject({
      DistributionId: 'DIST',
      InvalidationBatch: { Paths: { Quantity: 1, Items: ['/songbook.json'] } },
    });
    const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.Key).toEqual({ pk: 'BOOK', sk: 'PUBLISH' });
    expect(update.ExpressionAttributeValues).toMatchObject({ ':hash': result.hash, ':n': 2, ':updated': META.updatedAt });
  });

  it('refuses to publish a book with no songs', async () => {
    givenTable(META, []);
    await expect(handler({})).rejects.toThrow(/no songs/);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('publishes nothing before the seed has written META', async () => {
    givenTable(undefined, [songItem('1', 'Alpha')]);
    expect(await handler(STREAM_EVENT)).toEqual({ published: false, reason: 'not-seeded' });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('refuses to publish an invalid song', async () => {
    givenTable(META, [songItem('1', 'Alpha'), { ...songItem('2', 'Bravo'), sections: [] }]);
    await expect(handler({})).rejects.toThrow(/invalid songs: bravo/);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('skips an unchanged book when the stream calls, but always writes when forced', async () => {
    givenTable(META, [songItem('1', 'Alpha')]);
    const first = await handler({});
    givenTable(META, [songItem('1', 'Alpha')], { pk: 'BOOK', sk: 'PUBLISH', publishedHash: first.hash });

    expect(await handler(STREAM_EVENT)).toMatchObject({ published: false, reason: 'unchanged' });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(1);

    expect(await handler({})).toMatchObject({ published: true });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(2);
  });

  it('publishes from the stream when the book changed', async () => {
    givenTable(META, [songItem('1', 'Alpha')], { pk: 'BOOK', sk: 'PUBLISH', publishedHash: 'old' });
    expect(await handler(STREAM_EVENT)).toMatchObject({ published: true });
  });

  it('produces the same bytes, and hash, for the same content', async () => {
    givenTable(META, [songItem('1', 'Alpha'), songItem('2', 'Bravo')]);
    const a = await handler({});
    givenTable(META, [songItem('2', 'Bravo'), songItem('1', 'Alpha')]);
    const b = await handler({});
    expect(a.hash).toBe(b.hash);
  });
});
