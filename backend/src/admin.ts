/**
 * The admin API: one Lambda behind an HTTP API whose every route requires a
 * Cognito JWT (checked by API Gateway). This handler also requires the
 * caller to be in the admins group.
 *
 * Every write is one TransactWriteItems call that keeps the invariants in
 * store.ts: a slug belongs to one song, a save based on an old version is
 * refused (409), every version is in the song's history, and BOOK/META's
 * updatedAt moves, which (through the stream) republishes the book.
 */
import { randomUUID } from 'node:crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BatchWriteCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ADMIN_API_PREFIX,
  ADMIN_GROUP,
  LIMITS,
  RESTORE_DAYS,
  normalizeSongInput,
  orderSongs,
  uniqueSlug,
  validateSong,
  type AdminRoute,
  type AdminSong,
  type ApiErrorBody,
  type BookStatus,
  type DeletedSong,
  type FieldError,
  type HistoryAction,
  type HistoryEntry,
  type HistorySummary,
  type PublishResponse,
  type SongFields,
  type SongListResponse,
  type SongSummary,
} from '@songbook/core';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  doc,
  env,
  getItem,
  getMeta,
  keys,
  listSongs,
  queryPartition,
  songFields,
  tableName,
  type DeletedItem,
  type HistoryItem,
  type Key,
  type PublishItem,
  type SlugItem,
  type SongItem,
} from './store.ts';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** Largest request body accepted, in bytes (a song is at most 50 KB as JSON). */
const MAX_BODY = 100 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

const fail = (status: number, error: ApiErrorBody['error'], message: string, extra: Partial<ApiErrorBody> = {}): never => {
  throw new HttpError(status, { error, message, ...extra });
};

interface Request {
  event: Event;
  actor: string;
  now: string;
  param(name: string): string;
  body(): Record<string, unknown>;
}

interface Reply {
  status?: number;
  body: unknown;
}

const lambda = new LambdaClient({});

// --- Helpers --------------------------------------------------------------------------------

/** HTTP APIs pass a JWT array claim as a string like "[admins editors]". */
export function groupsOf(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map(String);
  if (typeof claim !== 'string') return [];
  return claim
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

function parseBody(event: Event): Record<string, unknown> {
  const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
  if (Buffer.byteLength(raw) > MAX_BODY) fail(413, 'too-large', 'The request is too large.');
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    fail(400, 'bad-request', 'The request body is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail(400, 'bad-request', 'Expected a JSON object.');
  return parsed as Record<string, unknown>;
}

function version(value: unknown, name: string): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) fail(400, 'bad-request', `${name} must be a version number.`);
  return n as number;
}

function invalid(errors: FieldError[]): never {
  return fail(400, 'invalid', errors.length === 1 ? errors[0].message : `${errors.length} things need fixing before this can be saved.`, { errors });
}

const toAdminSong = (item: SongItem): AdminSong => ({
  id: item.id,
  version: item.version,
  updatedAt: item.updatedAt,
  updatedBy: item.updatedBy,
  ...songFields(item),
});

const toHistorySummary = (item: HistoryItem): HistorySummary => {
  const out: HistorySummary = { version: item.version, action: item.action, changedAt: item.changedAt, changedBy: item.changedBy, title: item.title };
  if (item.revertedFrom !== undefined) out.revertedFrom = item.revertedFrom;
  return out;
};

/** Cancellation reason codes of a failed transaction, or undefined for any other error. */
function cancelled(err: unknown): string[] | undefined {
  if (!(err instanceof Error) || err.name !== 'TransactionCanceledException') return undefined;
  const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? [];
  return reasons.map((r) => r.Code ?? 'None');
}

type TransactItem = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']>[number];

const touchBook = (now: string): TransactItem => ({
  Update: {
    TableName: tableName(),
    Key: keys.meta,
    UpdateExpression: 'SET updatedAt = :now',
    ConditionExpression: 'attribute_exists(pk)',
    ExpressionAttributeValues: { ':now': now },
  },
});

const putNew = (item: Record<string, unknown>): TransactItem => ({
  Put: { TableName: tableName(), Item: item, ConditionExpression: 'attribute_not_exists(pk)' },
});

/** Delete the slug reservation if it is this song's (or already gone). */
const releaseSlug = (slug: string, id: string): TransactItem => ({
  Delete: {
    TableName: tableName(),
    Key: keys.slug(slug),
    ConditionExpression: 'attribute_not_exists(pk) OR id = :id',
    ExpressionAttributeValues: { ':id': id },
  },
});

async function transact(items: TransactItem[]): Promise<void> {
  await doc.send(new TransactWriteCommand({ TransactItems: items }));
}

async function currentSong(id: string): Promise<SongItem> {
  const song = await getItem<SongItem>(keys.song(id));
  if (!song) fail(404, 'not-found', 'That song does not exist. It may have been deleted.');
  return song as SongItem;
}

function conflict(current: SongItem): never {
  return fail(409, 'conflict', `${current.updatedBy} saved a newer version of this song (version ${current.version}).`, {
    currentVersion: current.version,
    updatedBy: current.updatedBy,
    updatedAt: current.updatedAt,
  });
}

/** Normalize and validate an editor's song, or fail with 400. */
function songInput(body: Record<string, unknown>, slugOptional: boolean): SongFields & { slug?: string } {
  const input = normalizeSongInput(body);
  const errors = validateSong(input, { slugOptional });
  if (errors.length > 0) invalid(errors);
  return input as SongFields;
}

async function deleteHistory(id: string): Promise<void> {
  const entries = await queryPartition<Key>(`HIST#${id}`);
  for (let i = 0; i < entries.length; i += 25) {
    let requests = entries.slice(i, i + 25).map(({ pk, sk }) => ({ DeleteRequest: { Key: { pk, sk } } }));
    for (let attempt = 0; requests.length > 0 && attempt < 8; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const out = await doc.send(new BatchWriteCommand({ RequestItems: { [tableName()]: requests } }));
      requests = (out.UnprocessedItems?.[tableName()] ?? []) as typeof requests;
    }
  }
}

/**
 * Save `fields` as the next version of `current`, recording it in history.
 * Fails with 409 if someone saved since `expectedVersion`, or if a changed slug is taken.
 */
async function saveVersion(
  req: Request,
  current: SongItem,
  expectedVersion: number,
  fields: SongFields,
  action: HistoryAction,
  revertedFrom?: number,
): Promise<AdminSong> {
  if (current.version !== expectedVersion) conflict(current);
  const id = current.id;
  const next = current.version + 1;
  const song: SongItem = { ...keys.song(id), id, ...fields, version: next, updatedAt: req.now, updatedBy: req.actor };
  const history: HistoryItem = { ...keys.history(id, next), id, ...fields, version: next, action, changedAt: req.now, changedBy: req.actor };
  if (revertedFrom !== undefined) history.revertedFrom = revertedFrom;
  const items: TransactItem[] = [
    {
      Put: {
        TableName: tableName(),
        Item: song,
        ConditionExpression: '#v = :expected',
        ExpressionAttributeNames: { '#v': 'version' },
        ExpressionAttributeValues: { ':expected': expectedVersion },
      },
    },
    putNew(history as unknown as Record<string, unknown>),
    touchBook(req.now),
  ];
  const slugChanged = fields.slug !== current.slug;
  if (slugChanged) items.push(putNew({ ...keys.slug(fields.slug), id }), releaseSlug(current.slug, id));
  try {
    await transact(items);
  } catch (err) {
    const codes = cancelled(err);
    if (codes?.[0] === 'ConditionalCheckFailed') conflict(await currentSong(id));
    if (codes?.[3] === 'ConditionalCheckFailed') fail(409, 'slug-taken', `Another song already uses the link name “${fields.slug}”.`);
    throw err;
  }
  return toAdminSong(song);
}

// --- Routes ---------------------------------------------------------------------------------

async function listSongsRoute(): Promise<Reply> {
  const [songs, meta, published] = await Promise.all([listSongs(), getMeta(), getItem<PublishItem>(keys.publish)]);
  const rows: SongSummary[] = orderSongs(songs).map((s, k) => ({
    id: s.id,
    number: k + 1,
    title: s.title,
    slug: s.slug,
    version: s.version,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  }));
  const book: BookStatus = { title: meta?.title ?? '', updatedAt: meta?.updatedAt ?? '' };
  if (meta?.seededFrom) book.seededFrom = meta.seededFrom;
  if (published) {
    book.publishedAt = published.publishedAt;
    if (published.bookUpdatedAt) book.publishedBookUpdatedAt = published.bookUpdatedAt;
    book.publishedSongCount = published.songCount;
  }
  const body: SongListResponse = { songs: rows, book };
  return { body };
}

async function getSongRoute(req: Request): Promise<Reply> {
  return { body: { song: toAdminSong(await currentSong(req.param('id'))) } };
}

async function createSongRoute(req: Request): Promise<Reply> {
  const input = songInput(req.body(), true);
  const id = randomUUID();
  let slug = input.slug;
  if (!slug) {
    const taken = new Set((await queryPartition<SlugItem>('SLUG')).map((s) => s.sk));
    slug = uniqueSlug(input.title, (s) => taken.has(s));
  }
  const fields: SongFields = { ...input, slug };
  const song: SongItem = { ...keys.song(id), id, ...fields, version: 1, updatedAt: req.now, updatedBy: req.actor };
  const history: HistoryItem = { ...keys.history(id, 1), id, ...fields, version: 1, action: 'create', changedAt: req.now, changedBy: req.actor };
  try {
    await transact([
      putNew(song as unknown as Record<string, unknown>),
      putNew({ ...keys.slug(slug), id }),
      putNew(history as unknown as Record<string, unknown>),
      touchBook(req.now),
    ]);
  } catch (err) {
    const codes = cancelled(err);
    if (codes?.[1] === 'ConditionalCheckFailed') fail(409, 'slug-taken', `Another song already uses the link name “${slug}”.`);
    if (codes?.[3] === 'ConditionalCheckFailed') fail(409, 'not-seeded', 'The songbook has not been set up yet.');
    throw err;
  }
  return { status: 201, body: { song: toAdminSong(song) } };
}

async function updateSongRoute(req: Request): Promise<Reply> {
  const { expectedVersion, ...rest } = req.body();
  const expected = version(expectedVersion, 'expectedVersion');
  const current = await currentSong(req.param('id'));
  const input = songInput({ ...rest, slug: rest.slug ?? current.slug }, false);
  return { body: { song: await saveVersion(req, current, expected, input, 'update') } };
}

async function deleteSongRoute(req: Request): Promise<Reply> {
  const expected = version(req.event.queryStringParameters?.expectedVersion, 'expectedVersion');
  const current = await currentSong(req.param('id'));
  if (current.version !== expected) conflict(current);
  const id = current.id;
  const expiresAt = Math.floor(Date.parse(req.now) / 1000) + RESTORE_DAYS * 24 * 3600;
  const copy: DeletedItem = {
    ...keys.deleted(id),
    id,
    ...songFields(current),
    version: current.version,
    deletedAt: req.now,
    deletedBy: req.actor,
    expiresAt,
  };
  try {
    await transact([
      {
        Delete: {
          TableName: tableName(),
          Key: keys.song(id),
          ConditionExpression: '#v = :expected',
          ExpressionAttributeNames: { '#v': 'version' },
          ExpressionAttributeValues: { ':expected': expected },
        },
      },
      releaseSlug(current.slug, id),
      { Put: { TableName: tableName(), Item: copy } },
      touchBook(req.now),
    ]);
  } catch (err) {
    if (cancelled(err)?.[0] === 'ConditionalCheckFailed') conflict(await currentSong(id));
    throw err;
  }
  // History goes with the song; the DELETED copy holds its last version.
  await deleteHistory(id);
  return { body: { deleted: toDeletedSong(copy) } };
}

const toDeletedSong = (item: DeletedItem): DeletedSong => ({
  id: item.id,
  title: item.title,
  slug: item.slug,
  deletedAt: item.deletedAt,
  deletedBy: item.deletedBy,
  restorableUntil: new Date(item.expiresAt * 1000).toISOString(),
});

async function listDeletedRoute(req: Request): Promise<Reply> {
  const now = Date.parse(req.now) / 1000;
  // TTL deletes lazily, so hide anything already past its expiry.
  const items = (await queryPartition<DeletedItem>('DELETED')).filter((d) => d.expiresAt > now);
  items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return { body: { deleted: items.map(toDeletedSong) } };
}

async function restoreRoute(req: Request): Promise<Reply> {
  const id = req.param('id');
  const copy = await getItem<DeletedItem>(keys.deleted(id));
  if (!copy || copy.expiresAt <= Date.parse(req.now) / 1000) fail(404, 'not-found', 'That song can no longer be restored.');
  const deleted = copy as DeletedItem;
  // An optional new slug, for when another song has taken this one's since.
  const body = req.event.body ? req.body() : {};
  const fields = songInput({ ...songFields(deleted), ...(body.slug !== undefined ? { slug: body.slug } : {}) }, false);
  const song: SongItem = { ...keys.song(id), id, ...fields, version: 1, updatedAt: req.now, updatedBy: req.actor };
  const history: HistoryItem = { ...keys.history(id, 1), id, ...fields, version: 1, action: 'restore', changedAt: req.now, changedBy: req.actor };
  try {
    await transact([
      putNew(song as unknown as Record<string, unknown>),
      putNew({ ...keys.slug(fields.slug), id }),
      putNew(history as unknown as Record<string, unknown>),
      { Delete: { TableName: tableName(), Key: keys.deleted(id), ConditionExpression: 'attribute_exists(pk)' } },
      touchBook(req.now),
    ]);
  } catch (err) {
    const codes = cancelled(err);
    if (codes?.[1] === 'ConditionalCheckFailed') {
      fail(409, 'slug-taken', `Another song now uses the link name “${fields.slug}”. Restore it under a different one.`);
    }
    if (codes?.[0] === 'ConditionalCheckFailed' || codes?.[3] === 'ConditionalCheckFailed') fail(409, 'conflict', 'This song has already been restored.');
    throw err;
  }
  return { status: 201, body: { song: toAdminSong(song) } };
}

async function historyRoute(req: Request): Promise<Reply> {
  const id = req.param('id');
  await currentSong(id);
  const entries = await queryPartition<HistoryItem>(`HIST#${id}`, { descending: true });
  return { body: { history: entries.map(toHistorySummary) } };
}

async function historyEntryRoute(req: Request): Promise<Reply> {
  const id = req.param('id');
  const item = await getItem<HistoryItem>(keys.history(id, version(req.param('version'), 'version')));
  if (!item) fail(404, 'not-found', 'That version does not exist.');
  const entry: HistoryEntry = { ...toHistorySummary(item as HistoryItem), ...songFields(item as HistoryItem) };
  return { body: { entry } };
}

async function revertRoute(req: Request): Promise<Reply> {
  const body = req.body();
  const target = version(body.version, 'version');
  const expected = version(body.expectedVersion, 'expectedVersion');
  const current = await currentSong(req.param('id'));
  const snapshot = await getItem<HistoryItem>(keys.history(current.id, target));
  if (!snapshot) fail(404, 'not-found', 'That version does not exist.');
  // The slug stays: it is what keeps shared links to this song working.
  const fields = songInput({ ...songFields(snapshot as HistoryItem), slug: current.slug }, false);
  return { body: { song: await saveVersion(req, current, expected, fields, 'revert', target) } };
}

async function getBookRoute(): Promise<Reply> {
  return listSongsRoute().then((r) => ({ body: { book: (r.body as SongListResponse).book } }));
}

async function putBookRoute(req: Request): Promise<Reply> {
  const { title } = req.body();
  const value = typeof title === 'string' ? title.trim() : '';
  if (value === '') invalid([{ field: 'title', message: "The book's title can't be blank." }]);
  if ([...value].length > LIMITS.title) invalid([{ field: 'title', message: `The title is longer than ${LIMITS.title} characters.` }]);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid([{ field: 'title', message: 'The title contains a control character.' }]);
  try {
    await doc.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: keys.meta,
        UpdateExpression: 'SET title = :title, updatedAt = :now',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':title': value, ':now': req.now },
      }),
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') fail(409, 'not-seeded', 'The songbook has not been set up yet.');
    throw err;
  }
  return getBookRoute();
}

async function publishRoute(): Promise<Reply> {
  const out = await lambda.send(new InvokeCommand({ FunctionName: env('PUBLISH_FUNCTION_NAME'), InvocationType: 'RequestResponse', Payload: '{}' }));
  const text = out.Payload ? Buffer.from(out.Payload).toString('utf8') : '{}';
  if (out.FunctionError) throw new Error(`publish failed: ${text}`);
  const result = JSON.parse(text) as PublishResponse;
  return { body: { result } };
}

const ROUTES: Record<AdminRoute, (req: Request) => Promise<Reply>> = {
  'GET /songs': listSongsRoute,
  'POST /songs': createSongRoute,
  'GET /songs/{id}': getSongRoute,
  'PUT /songs/{id}': updateSongRoute,
  'DELETE /songs/{id}': deleteSongRoute,
  'GET /songs/{id}/history': historyRoute,
  'GET /songs/{id}/history/{version}': historyEntryRoute,
  'POST /songs/{id}/revert': revertRoute,
  'GET /deleted': listDeletedRoute,
  'POST /deleted/{id}/restore': restoreRoute,
  'GET /book': getBookRoute,
  'PUT /book': putBookRoute,
  'POST /publish': publishRoute,
};

function respond(status: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

/** "GET /api/admin/songs/{id}" -> "GET /songs/{id}" */
function routeOf(routeKey: string): AdminRoute | undefined {
  const [method, path] = routeKey.split(' ');
  if (!path?.startsWith(ADMIN_API_PREFIX)) return undefined;
  const key = `${method} ${path.slice(ADMIN_API_PREFIX.length)}`;
  return key in ROUTES ? (key as AdminRoute) : undefined;
}

export async function handler(event: Event): Promise<APIGatewayProxyStructuredResultV2> {
  const route = routeOf(event.routeKey);
  try {
    const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
    if (!groupsOf(claims['cognito:groups']).includes(ADMIN_GROUP)) {
      return respond(403, { error: 'forbidden', message: 'This account is not allowed to edit the songbook.' } satisfies ApiErrorBody);
    }
    if (!route) return respond(404, { error: 'not-found', message: 'No such API route.' } satisfies ApiErrorBody);
    let body: Record<string, unknown> | undefined;
    const req: Request = {
      event,
      actor: String(claims.email ?? claims['cognito:username'] ?? claims.username ?? claims.sub ?? 'unknown'),
      now: new Date().toISOString(),
      param(name) {
        const value = event.pathParameters?.[name];
        if (!value) fail(400, 'bad-request', `Missing ${name}.`);
        return value as string;
      },
      body: () => (body ??= parseBody(event)),
    };
    const reply = await ROUTES[route](req);
    return respond(reply.status ?? 200, reply.body);
  } catch (err) {
    if (err instanceof HttpError) return respond(err.status, err.body);
    // Never log the request body: it is song content, and could be anything.
    const e = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { message: String(err) };
    console.error(JSON.stringify({ message: 'admin request failed', route: event.routeKey, error: e }));
    return respond(500, { error: 'internal', message: 'Something went wrong on the server. Try again; if it keeps happening, check the logs.' });
  }
}
