import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ADMIN_ROUTES } from '@songbook/core';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { groupsOf, handler } from '../src/admin.ts';
import { META, setEnv, songFields, songItem } from './fixtures.ts';

const ddb = mockClient(DynamoDBDocumentClient);
const lambda = mockClient(LambdaClient);

beforeEach(() => {
  ddb.reset();
  lambda.reset();
  ddb.on(TransactWriteCommand).resolves({});
  ddb.on(BatchWriteCommand).resolves({});
  ddb.on(GetCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  setEnv({ TABLE_NAME: 'table', PUBLISH_FUNCTION_NAME: 'publisher' });
});

interface Call {
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
  groups?: string;
}

async function call(routeKey: string, { body, query, params, groups = '[admins]' }: Call = {}) {
  const event = {
    routeKey,
    rawPath: routeKey.split(' ')[1],
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
    pathParameters: params,
    queryStringParameters: query,
    requestContext: { authorizer: { jwt: { claims: { 'cognito:groups': groups, email: 'editor@example.com', sub: 'abc' }, scopes: null } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
  const res = await handler(event);
  return { status: res.statusCode, body: JSON.parse(res.body ?? 'null'), headers: res.headers };
}

const given = (key: { pk: string; sk: string }, item: unknown) => ddb.on(GetCommand, { Key: key }).resolves({ Item: item as Record<string, unknown> });
const transactItems = (n = 0) => ddb.commandCalls(TransactWriteCommand)[n].args[0].input.TransactItems!;

function cancel(...codes: string[]) {
  return new TransactionCanceledException({ message: 'cancelled', $metadata: {}, CancellationReasons: codes.map((Code) => ({ Code })) });
}

describe('access', () => {
  it('requires the admins group', async () => {
    const res = await call('GET /api/admin/songs', { groups: '[editors]' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect(ddb.calls()).toHaveLength(0);
    expect((await call('GET /api/admin/songs', { groups: '' })).status).toBe(403);
  });

  it('reads the groups claim in the forms API Gateway passes', () => {
    expect(groupsOf('[admins]')).toEqual(['admins']);
    expect(groupsOf('[editors admins]')).toEqual(['editors', 'admins']);
    expect(groupsOf(['admins'])).toEqual(['admins']);
    expect(groupsOf(undefined)).toEqual([]);
  });

  it('answers JSON that is never cached', async () => {
    const res = await call('GET /api/admin/songs');
    expect(res.headers).toEqual({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  });

  it('has a handler for every route the CDK app creates, and 404s anything else', async () => {
    for (const route of ADMIN_ROUTES) {
      const [method, path] = route.split(' ');
      const res = await call(`${method} /api/admin${path}`, { params: { id: 'x', version: '1' }, body: {} });
      expect(res.body?.message, route).not.toBe('No such API route.');
    }
    expect((await call('GET /api/admin/nope')).status).toBe(404);
  });

  it('hides internal errors and does not log the request', async () => {
    ddb.on(QueryCommand).rejects(new Error('boom'));
    const res = await call('GET /api/admin/songs');
    expect(res.status).toBe(500);
    expect(res.body.message).not.toMatch(/boom/);
  });
});

describe('GET /songs', () => {
  it('lists songs in book order with their current numbers and the publish status', async () => {
    ddb.on(QueryCommand).resolves({ Items: [songItem('b', 'Bravo', 3), songItem('a', 'Alpha')] });
    given({ pk: 'BOOK', sk: 'META' }, META);
    given({ pk: 'BOOK', sk: 'PUBLISH' }, { publishedAt: '2026-10-03T00:00:00.000Z', bookUpdatedAt: META.updatedAt, songCount: 2 });
    const res = await call('GET /api/admin/songs');
    expect(res.status).toBe(200);
    expect(res.body.songs.map((s: { number: number; title: string; version: number }) => [s.number, s.title, s.version])).toEqual([
      [1, 'Alpha', 1],
      [2, 'Bravo', 3],
    ]);
    expect(res.body.book).toEqual({
      title: 'Test Songs',
      updatedAt: META.updatedAt,
      publishedAt: '2026-10-03T00:00:00.000Z',
      publishedBookUpdatedAt: META.updatedAt,
      publishedSongCount: 2,
    });
  });
});

describe('POST /songs', () => {
  it('creates a song with a new id, its slug, history v1, and touches the book', async () => {
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'SLUG' } }).resolves({ Items: [{ pk: 'SLUG', sk: 'new-song' }] });
    const { slug: _, ...input } = songFields('New Song');
    const res = await call('POST /api/admin/songs', { body: { ...input, title: '  New Song ' } });
    expect(res.status).toBe(201);
    expect(res.body.song).toMatchObject({ title: 'New Song', slug: 'new-song-2', version: 1, updatedBy: 'editor@example.com' });

    const [song, slug, hist, meta] = transactItems();
    expect(song.Put!.Item).toMatchObject({ pk: 'SONG', sk: res.body.song.id, version: 1 });
    expect(song.Put!.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(slug.Put!.Item).toEqual({ pk: 'SLUG', sk: 'new-song-2', id: res.body.song.id });
    expect(slug.Put!.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(hist.Put!.Item).toMatchObject({ pk: `HIST#${res.body.song.id}`, sk: 'v000001', action: 'create', changedBy: 'editor@example.com' });
    expect(meta.Update!.Key).toEqual({ pk: 'BOOK', sk: 'META' });
  });

  it('returns 409 when the slug is taken', async () => {
    ddb.on(TransactWriteCommand).rejects(cancel('None', 'ConditionalCheckFailed', 'None', 'None'));
    const res = await call('POST /api/admin/songs', { body: songFields('Alpha') });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slug-taken');
  });

  it('returns 400 with the field errors for an invalid song', async () => {
    const res = await call('POST /api/admin/songs', { body: { ...songFields('x'), title: '', sections: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid');
    expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(['title', 'sections']);
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    expect((await call('POST /api/admin/songs', { body: '{nope' })).status).toBe(400);
    expect((await call('POST /api/admin/songs', { body: '[]' })).status).toBe(400);
    expect((await call('POST /api/admin/songs', { body: JSON.stringify({ title: 'x'.repeat(200 * 1024) }) })).status).toBe(413);
  });
});

describe('PUT /songs/{id}', () => {
  const update = (expectedVersion: unknown, extra: Record<string, unknown> = {}) =>
    call('PUT /api/admin/songs/{id}', { params: { id: 'a' }, body: { ...songFields('Alpha', { author: 'Someone' }), expectedVersion, ...extra } });

  it('saves the next version and records it in history', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 2));
    const res = await update(2);
    expect(res.status).toBe(200);
    expect(res.body.song).toMatchObject({ id: 'a', version: 3, author: 'Someone' });
    const [song, hist, meta] = transactItems();
    expect(song.Put!.ConditionExpression).toBe('#v = :expected');
    expect(song.Put!.ExpressionAttributeValues).toEqual({ ':expected': 2 });
    expect(hist.Put!.Item).toMatchObject({ pk: 'HIST#a', sk: 'v000003', action: 'update', version: 3 });
    expect(meta.Update).toBeDefined();
    expect(transactItems()).toHaveLength(3); // slug unchanged: no reservation changes
  });

  it('returns 409 with the current version for a stale expectedVersion', async () => {
    given({ pk: 'SONG', sk: 'a' }, { ...songItem('a', 'Alpha', 5), updatedBy: 'other@example.com' });
    const res = await update(4);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'conflict', currentVersion: 5, updatedBy: 'other@example.com' });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('returns 409 when another save wins the race', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 2));
    ddb.on(TransactWriteCommand).rejects(cancel('ConditionalCheckFailed', 'None', 'None'));
    expect((await update(2)).body.error).toBe('conflict');
  });

  it('moves the slug reservation when the slug changes, and 409s if the new one is taken', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 1));
    await update(1, { slug: 'alpha-renamed' });
    const items = transactItems();
    expect(items[3].Put!.Item).toEqual({ pk: 'SLUG', sk: 'alpha-renamed', id: 'a' });
    expect(items[4].Delete!.Key).toEqual({ pk: 'SLUG', sk: 'alpha' });
    expect(items[4].Delete!.ConditionExpression).toBe('attribute_not_exists(pk) OR id = :id');

    ddb.on(TransactWriteCommand).rejects(cancel('None', 'None', 'None', 'ConditionalCheckFailed', 'None'));
    expect((await update(1, { slug: 'bravo' })).body.error).toBe('slug-taken');
  });

  it('keeps the slug when the body leaves it out, and needs expectedVersion', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 1));
    const { slug: _, ...noSlug } = songFields('Alpha Renamed');
    const res = await call('PUT /api/admin/songs/{id}', { params: { id: 'a' }, body: { ...noSlug, expectedVersion: 1 } });
    expect(res.body.song.slug).toBe('alpha');
    expect((await update(undefined)).status).toBe(400);
  });

  it('returns 404 for a song that does not exist', async () => {
    expect((await update(1)).status).toBe(404);
  });
});

describe('DELETE /songs/{id}', () => {
  it('deletes the song, its slug and its history, keeping a copy that expires in 30 days', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 3));
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'HIST#a' } }).resolves({
      Items: [1, 2, 3].map((v) => ({ pk: 'HIST#a', sk: `v00000${v}` })),
    });
    const before = Math.floor(Date.now() / 1000);
    const res = await call('DELETE /api/admin/songs/{id}', { params: { id: 'a' }, query: { expectedVersion: '3' } });
    expect(res.status).toBe(200);

    const [song, slug, copy, meta] = transactItems();
    expect(song.Delete!.Key).toEqual({ pk: 'SONG', sk: 'a' });
    expect(song.Delete!.ExpressionAttributeValues).toEqual({ ':expected': 3 });
    expect(slug.Delete!.Key).toEqual({ pk: 'SLUG', sk: 'alpha' });
    expect(copy.Put!.Item).toMatchObject({ pk: 'DELETED', sk: 'a', title: 'Alpha', version: 3, deletedBy: 'editor@example.com' });
    const expiresAt = copy.Put!.Item!.expiresAt as number;
    expect(expiresAt - before).toBeGreaterThanOrEqual(30 * 24 * 3600 - 5);
    expect(expiresAt - before).toBeLessThanOrEqual(30 * 24 * 3600 + 5);
    expect(meta.Update).toBeDefined();

    const deleted = ddb.commandCalls(BatchWriteCommand)[0].args[0].input.RequestItems!.table.map((r) => r.DeleteRequest!.Key);
    expect(deleted).toEqual([1, 2, 3].map((v) => ({ pk: 'HIST#a', sk: `v00000${v}` })));
    expect(res.body.deleted).toMatchObject({ id: 'a', title: 'Alpha' });
  });

  it('returns 409 for a stale expectedVersion, and 400 without one', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 3));
    expect((await call('DELETE /api/admin/songs/{id}', { params: { id: 'a' }, query: { expectedVersion: '2' } })).status).toBe(409);
    expect((await call('DELETE /api/admin/songs/{id}', { params: { id: 'a' } })).status).toBe(400);
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe('recently deleted', () => {
  const copy = (id: string, title: string, expiresAt: number, deletedAt = '2026-10-05T00:00:00.000Z') => ({
    pk: 'DELETED',
    sk: id,
    id,
    ...songFields(title),
    version: 2,
    deletedAt,
    deletedBy: 'editor@example.com',
    expiresAt,
  });
  const future = Math.floor(Date.now() / 1000) + 3600;

  it('lists unexpired copies, newest first', async () => {
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'DELETED' } }).resolves({
      Items: [copy('a', 'Alpha', future, '2026-10-01T00:00:00.000Z'), copy('b', 'Bravo', future), copy('c', 'Gone', 1000)],
    });
    const res = await call('GET /api/admin/deleted');
    expect(res.body.deleted.map((d: { title: string }) => d.title)).toEqual(['Bravo', 'Alpha']);
    expect(res.body.deleted[0].restorableUntil).toBe(new Date(future * 1000).toISOString());
  });

  it('restores a song with a fresh history, removing the copy', async () => {
    given({ pk: 'DELETED', sk: 'a' }, copy('a', 'Alpha', future));
    const res = await call('POST /api/admin/deleted/{id}/restore', { params: { id: 'a' } });
    expect(res.status).toBe(201);
    expect(res.body.song).toMatchObject({ id: 'a', version: 1, slug: 'alpha' });
    const [song, slug, hist, removed] = transactItems();
    expect(song.Put!.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(slug.Put!.Item).toEqual({ pk: 'SLUG', sk: 'alpha', id: 'a' });
    expect(hist.Put!.Item).toMatchObject({ pk: 'HIST#a', sk: 'v000001', action: 'restore' });
    expect(removed.Delete!.Key).toEqual({ pk: 'DELETED', sk: 'a' });
  });

  it('returns 409 if the slug has been taken since, and can restore under a new one', async () => {
    given({ pk: 'DELETED', sk: 'a' }, copy('a', 'Alpha', future));
    ddb.on(TransactWriteCommand).rejectsOnce(cancel('None', 'ConditionalCheckFailed', 'None', 'None', 'None'));
    const res = await call('POST /api/admin/deleted/{id}/restore', { params: { id: 'a' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slug-taken');
    const retry = await call('POST /api/admin/deleted/{id}/restore', { params: { id: 'a' }, body: { slug: 'alpha-restored' } });
    expect(retry.body.song.slug).toBe('alpha-restored');
  });

  it('returns 404 once the copy has expired', async () => {
    given({ pk: 'DELETED', sk: 'a' }, copy('a', 'Alpha', 1000));
    expect((await call('POST /api/admin/deleted/{id}/restore', { params: { id: 'a' } })).status).toBe(404);
  });
});

describe('history and revert', () => {
  const hist = (v: number, title: string, action = 'update') => ({
    pk: 'HIST#a',
    sk: `v00000${v}`,
    id: 'a',
    ...songFields(title, { author: `Author ${v}` }),
    version: v,
    action,
    changedAt: `2026-10-0${v}T00:00:00.000Z`,
    changedBy: 'editor@example.com',
  });

  it('lists versions newest first', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 2));
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'HIST#a' } }).resolves({ Items: [hist(2, 'Alpha'), hist(1, 'Alfa', 'import')] });
    const res = await call('GET /api/admin/songs/{id}/history', { params: { id: 'a' } });
    expect(res.body.history.map((h: { version: number; action: string }) => [h.version, h.action])).toEqual([
      [2, 'update'],
      [1, 'import'],
    ]);
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input.ScanIndexForward).toBe(false);
  });

  it('returns one version with its content', async () => {
    given({ pk: 'HIST#a', sk: 'v000001' }, hist(1, 'Alfa', 'import'));
    const res = await call('GET /api/admin/songs/{id}/history/{version}', { params: { id: 'a', version: '1' } });
    expect(res.body.entry).toMatchObject({ version: 1, action: 'import', title: 'Alfa', author: 'Author 1' });
    expect(res.body.entry.sections).toHaveLength(1);
    expect((await call('GET /api/admin/songs/{id}/history/{version}', { params: { id: 'a', version: '9' } })).status).toBe(404);
  });

  it('reverts by saving an old version as the next one, keeping the current slug', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 4));
    given({ pk: 'HIST#a', sk: 'v000001' }, { ...hist(1, 'Alfa', 'import'), slug: 'alfa' });
    const res = await call('POST /api/admin/songs/{id}/revert', { params: { id: 'a' }, body: { version: 1, expectedVersion: 4 } });
    expect(res.status).toBe(200);
    expect(res.body.song).toMatchObject({ version: 5, title: 'Alfa', author: 'Author 1', slug: 'alpha' });
    const [, entry] = transactItems();
    expect(entry.Put!.Item).toMatchObject({ sk: 'v000005', action: 'revert', revertedFrom: 1, title: 'Alfa' });
  });

  it('refuses a revert based on an old version', async () => {
    given({ pk: 'SONG', sk: 'a' }, songItem('a', 'Alpha', 4));
    given({ pk: 'HIST#a', sk: 'v000001' }, hist(1, 'Alfa'));
    expect((await call('POST /api/admin/songs/{id}/revert', { params: { id: 'a' }, body: { version: 1, expectedVersion: 3 } })).status).toBe(409);
  });
});

describe('book and publish', () => {
  it('renames the book and touches updatedAt', async () => {
    given({ pk: 'BOOK', sk: 'META' }, META);
    ddb.on(UpdateCommand).resolves({});
    const res = await call('PUT /api/admin/book', { body: { title: ' New Title ' } });
    expect(res.status).toBe(200);
    const update = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.ExpressionAttributeValues).toMatchObject({ ':title': 'New Title' });
    expect(update.ConditionExpression).toBe('attribute_exists(pk)');
    expect((await call('PUT /api/admin/book', { body: { title: '  ' } })).status).toBe(400);
  });

  it('republishes through the publisher', async () => {
    lambda.on(InvokeCommand).resolves({ Payload: Buffer.from(JSON.stringify({ published: true, songs: 2 })) as never });
    const res = await call('POST /api/admin/publish');
    expect(res.body.result).toEqual({ published: true, songs: 2 });
    expect(lambda.commandCalls(InvokeCommand)[0].args[0].input).toMatchObject({ FunctionName: 'publisher', InvocationType: 'RequestResponse' });
  });
});
