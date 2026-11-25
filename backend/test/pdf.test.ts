import { readFileSync } from 'node:fs';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildSongbook, type SeedFile } from '@songbook/core';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler, PDF_CACHE_CONTROL, renderBook } from '../src/pdf.ts';
import { META, setEnv, songItem } from './fixtures.ts';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);
const cf = mockClient(CloudFrontClient);

function givenTable(meta: unknown, songs: unknown[]) {
  ddb.on(GetCommand, { Key: { pk: 'BOOK', sk: 'META' } }).resolves({ Item: meta as Record<string, unknown> | undefined });
  ddb.on(GetCommand, { Key: { pk: 'BOOK', sk: 'PDF' } }).resolves({});
  ddb.on(QueryCommand).resolves({ Items: songs as Record<string, unknown>[] });
}

beforeEach(() => {
  ddb.reset();
  s3.reset();
  cf.reset();
  s3.on(PutObjectCommand).resolves({});
  cf.on(CreateInvalidationCommand).resolves({});
  ddb.on(PutCommand).resolves({});
  setEnv({ TABLE_NAME: 'table', BUCKET_NAME: 'bucket', DISTRIBUTION_ID: 'DIST' });
});

const pdfText = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('generating the PDF', () => {
  it('writes melbourne-songs.pdf from the table, invalidates it and records who generated it', async () => {
    givenTable(META, [songItem('2', 'Bravo'), songItem('1', 'Alpha')]);
    const result = await handler({ actor: 'editor@example.com' });
    expect(result).toMatchObject({ generated: true, pdf: { songCount: 2, generatedBy: 'editor@example.com', bookUpdatedAt: META.updatedAt } });

    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(put).toMatchObject({ Bucket: 'bucket', Key: 'melbourne-songs.pdf', ContentType: 'application/pdf', CacheControl: PDF_CACHE_CONTROL });
    expect(PDF_CACHE_CONTROL).toBe('public, max-age=0, must-revalidate');
    const bytes = put.Body as Uint8Array;
    expect(pdfText(bytes).slice(0, 8)).toBe('%PDF-1.7');
    expect(result.pdf?.bytes).toBe(bytes.length);
    // Title page, one index page, then the songs (song page 1 is page 3).
    expect(result.pdf?.pages).toBe(3);
    // Song numbers follow the book order, as on the site.
    expect(pdfText(bytes)).toContain('(song-1)');
    expect(pdfText(bytes)).toContain('(song-2)');

    expect(cf.commandCalls(CreateInvalidationCommand)[0].args[0].input).toMatchObject({
      DistributionId: 'DIST',
      InvalidationBatch: { Paths: { Quantity: 1, Items: ['/melbourne-songs.pdf'] } },
    });
    const record = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(record.TableName).toBe('table');
    expect(record.Item).toMatchObject({ pk: 'BOOK', sk: 'PDF', ...result.pdf, hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  const STREAM = { Records: [{ eventName: 'MODIFY', dynamodb: { Keys: { pk: { S: 'SONG' }, sk: { S: '1' } } } }] };

  it('says it was made automatically when the stream runs it, and by a deploy when a trigger does', async () => {
    givenTable(META, [songItem('1', 'Alpha')]);
    expect((await handler(STREAM)).pdf?.generatedBy).toBe('automatic');
    expect((await handler({})).pdf?.generatedBy).toBe('deploy');
    expect(s3.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key)).toEqual(['melbourne-songs.pdf', 'melbourne-songs.pdf']);
  });

  it('skips a stream batch when the latest PDF already holds the latest edit, but never a deploy or a request', async () => {
    givenTable(META, [songItem('1', 'Alpha')]);
    ddb.on(GetCommand, { Key: { pk: 'BOOK', sk: 'PDF' } }).resolves({ Item: { pk: 'BOOK', sk: 'PDF', bookUpdatedAt: META.updatedAt } });
    expect(await handler(STREAM)).toEqual({ generated: false, reason: 'unchanged' });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect((await handler({})).generated).toBe(true);
    expect((await handler({ actor: 'editor@example.com' })).generated).toBe(true);

    // An edit since: the stream makes a new one.
    ddb.on(GetCommand, { Key: { pk: 'BOOK', sk: 'PDF' } }).resolves({ Item: { pk: 'BOOK', sk: 'PDF', bookUpdatedAt: '2026-01-01T00:00:00.000Z' } });
    expect((await handler(STREAM)).generated).toBe(true);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(3);
  });

  it('generates nothing before the seed has written META', async () => {
    givenTable(undefined, [songItem('1', 'Alpha')]);
    expect(await handler({})).toEqual({ generated: false, reason: 'not-seeded' });
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('refuses a book with no songs or an invalid song, writing nothing', async () => {
    givenTable(META, []);
    await expect(handler({})).rejects.toThrow(/no songs/);
    givenTable(META, [songItem('1', 'Alpha'), { ...songItem('2', 'Bravo'), sections: [] }]);
    await expect(handler({})).rejects.toThrow(/invalid songs: bravo/);
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

describe('the PDF of the whole book', () => {
  const { book: seed } = JSON.parse(readFileSync(new URL('../../data/seed-songbook.json', import.meta.url), 'utf8')) as SeedFile;
  const book = buildSongbook({ title: seed.title, updatedAt: '2026-11-25T14:30:00.000Z' }, seed.songs);

  it('renders every song, with a link target and a bookmark for each, and the same bytes every time', async () => {
    const a = await renderBook(book);
    const text = pdfText(a.bytes);
    expect(text.slice(0, 5)).toBe('%PDF-');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(a.pages).toBeGreaterThan(20);
    expect(a.pages).toBeLessThan(60);
    for (const s of book.songs) expect(text).toContain(`(song-${s.number})`);
    expect(text).toContain('/Outlines');
    // Fonts are embedded subsets of Latin Modern, never a built-in PDF font.
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+LMRoman12-Regular/);
    expect(text).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier)/);
    const b = await renderBook(book);
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
  });
});
