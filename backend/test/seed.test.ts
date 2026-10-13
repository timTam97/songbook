import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkSeed, handler } from '../src/seed.ts';
import { META, seedBook, setEnv } from './fixtures.ts';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
  ddb.on(TransactWriteCommand).resolves({});
  ddb.on(PutCommand).resolves({});
  setEnv({ TABLE_NAME: 'table', STAGE: 'beta', SEED_BUCKET: 'assets', SEED_KEY: 'seed.json' });
});

const book = seedBook(['Alpha', 'Bravo', 'Charlie']);

function slugTaken() {
  return new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
  });
}

describe('seed', () => {
  it('is a no-op once META exists', async () => {
    ddb.on(GetCommand).resolves({ Item: META });
    expect(await handler({ book, source: 'test' })).toEqual({ seeded: false, reason: 'already-seeded' });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('imports every song as SONG + SLUG + HIST v1 with a new id, then writes META last', async () => {
    ddb.on(GetCommand).resolves({});
    expect(await handler({ book, source: 'melbourne-songs.tex@abc' })).toEqual({ seeded: true, songs: 3, skipped: 0 });

    const transactions = ddb.commandCalls(TransactWriteCommand).map((c) => c.args[0].input.TransactItems!);
    expect(transactions).toHaveLength(3);
    const ids = new Set<string>();
    for (const items of transactions) {
      const [song, slug, hist] = items.map((i) => i.Put!);
      ids.add(song.Item!.id as string);
      expect(song.Item).toMatchObject({ pk: 'SONG', sk: song.Item!.id, version: 1, updatedBy: 'seed' });
      expect(song.Item).not.toHaveProperty('number');
      expect(song.Item).not.toHaveProperty('firstLine');
      expect(slug.Item).toEqual({ pk: 'SLUG', sk: song.Item!.slug, id: song.Item!.id });
      expect(hist.Item).toMatchObject({ pk: `HIST#${song.Item!.id}`, sk: 'v000001', action: 'import', version: 1 });
      for (const put of [song, slug, hist]) expect(put.ConditionExpression).toBe('attribute_not_exists(pk)');
    }
    expect(ids.size).toBe(3);

    const meta = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(meta.Item).toMatchObject({ pk: 'BOOK', sk: 'META', title: 'Test Songs', released: '31 December, 2025', seededFrom: 'melbourne-songs.tex@abc' });
    expect(meta.ConditionExpression).toBe('attribute_not_exists(pk)');
    // META after every song.
    const order = ddb.calls().map((c) => c.args[0].constructor.name);
    expect(order.lastIndexOf('TransactWriteCommand')).toBeLessThan(order.indexOf('PutCommand'));
  });

  it('resumes an interrupted seed, skipping songs whose slug is already reserved', async () => {
    ddb.on(GetCommand).resolves({});
    ddb.on(TransactWriteCommand).rejectsOnce(slugTaken()).resolves({});
    expect(await handler({ book })).toEqual({ seeded: true, songs: 3, skipped: 1 });
  });

  it('reads the deploy asset when the event carries no book', async () => {
    ddb.on(GetCommand).resolves({});
    s3.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => JSON.stringify({ source: 'asset', book }) } as never,
    });
    expect(await handler({})).toMatchObject({ seeded: true, songs: 3 });
    expect(s3.commandCalls(GetObjectCommand)[0].args[0].input).toEqual({ Bucket: 'assets', Key: 'seed.json' });
  });

  it('on reset, deletes META first, then everything else, then seeds', async () => {
    ddb.on(DeleteCommand).resolves({});
    ddb
      .on(ScanCommand)
      .resolvesOnce({ Items: [{ pk: 'SONG', sk: 'x' }], LastEvaluatedKey: { pk: 'SONG', sk: 'x' } })
      .resolvesOnce({ Items: [{ pk: 'SLUG', sk: 'alpha' }] });
    ddb.on(BatchWriteCommand).resolves({});
    expect(await handler({ book, reset: true })).toEqual({ seeded: true, songs: 3, skipped: 0, deleted: 3 });
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ pk: 'BOOK', sk: 'META' });
    const deletes = ddb.commandCalls(BatchWriteCommand).flatMap((c) => c.args[0].input.RequestItems!.table.map((r) => r.DeleteRequest!.Key));
    expect(deletes).toEqual([
      { pk: 'SONG', sk: 'x' },
      { pk: 'SLUG', sk: 'alpha' },
    ]);
  });

  it('refuses to reset anything but beta', async () => {
    setEnv({ STAGE: 'prod' });
    await expect(handler({ book, reset: true })).rejects.toThrow(/only allowed on the beta stage/);
    expect(ddb.calls()).toHaveLength(0);
  });
});

describe('checkSeed', () => {
  it('accepts a valid book', () => {
    expect(checkSeed(book)).toHaveLength(3);
  });

  it('rejects numbers that alphabetical order would change', () => {
    const swapped = { ...book, songs: book.songs.map((s, k) => ({ ...s, number: book.songs.length - k })) };
    expect(() => checkSeed(swapped)).toThrow(/numbers would change/);
  });

  it('rejects invalid songs, duplicate slugs and empty books', () => {
    expect(() => checkSeed({ ...book, songs: [{ ...book.songs[0], title: '' }, ...book.songs.slice(1)] })).toThrow(/song 1 \(alpha\): title/);
    expect(() => checkSeed({ ...book, songs: [book.songs[0], { ...book.songs[1], slug: 'alpha' }] })).toThrow(/slugs are not unique/);
    expect(() => checkSeed({ ...book, songs: [] })).toThrow(/no songs/);
    expect(() => checkSeed({} as never)).toThrow(/not a songbook/);
  });
});
