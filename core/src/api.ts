/**
 * The admin API's contract, shared by its Lambda, the admin portal and the
 * CDK app (which gives every route the JWT authorizer).
 */
import type { SongFields } from './types.ts';
import type { FieldError } from './validate.ts';

export const ADMIN_API_PREFIX = '/api/admin';

/** Every route, as "METHOD path" under ADMIN_API_PREFIX. */
export const ADMIN_ROUTES = [
  'GET /songs',
  'POST /songs',
  'GET /songs/{id}',
  'PUT /songs/{id}',
  'DELETE /songs/{id}',
  'GET /songs/{id}/history',
  'GET /songs/{id}/history/{version}',
  'POST /songs/{id}/revert',
  'GET /deleted',
  'POST /deleted/{id}/restore',
  'GET /book',
  'PUT /book',
  'POST /publish',
] as const;

export type AdminRoute = (typeof ADMIN_ROUTES)[number];

/** The Cognito group whose members may use the admin API. */
export const ADMIN_GROUP = 'admins';

/** How long a deleted song can be restored. */
export const RESTORE_DAYS = 30;

/** One row of the admin song list. `number` is the song's current position in the book. */
export interface SongSummary {
  id: string;
  number: number;
  title: string;
  slug: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/** A song as the editor loads and saves it. */
export interface AdminSong extends SongFields {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface BookStatus {
  title: string;
  /** The latest edit to the book (any song, or the book's title). */
  updatedAt: string;
  seededFrom?: string;
  /** When songbook.json was last written. */
  publishedAt?: string;
  /** The `updatedAt` of the book that was published; behind `updatedAt` while a publish is pending or stuck. */
  publishedBookUpdatedAt?: string;
  publishedSongCount?: number;
}

export interface SongListResponse {
  songs: SongSummary[];
  book: BookStatus;
}

export interface SongResponse {
  song: AdminSong;
}

export interface DeletedSong {
  id: string;
  title: string;
  slug: string;
  deletedAt: string;
  deletedBy: string;
  /** ISO time after which it can no longer be restored. */
  restorableUntil: string;
}

export type HistoryAction = 'import' | 'create' | 'update' | 'revert' | 'restore';

export interface HistorySummary {
  version: number;
  action: HistoryAction;
  changedAt: string;
  changedBy: string;
  title: string;
  /** For a revert: the version whose content was copied. */
  revertedFrom?: number;
}

export interface HistoryEntry extends HistorySummary, SongFields {}

/** Body of PUT /songs/{id}. POST /songs takes SongFields with an optional slug. */
export type SongUpdate = SongFields & { expectedVersion: number };

export interface RevertRequest {
  version: number;
  expectedVersion: number;
}

export interface PublishResponse {
  published: boolean;
  reason?: string;
  songs?: number;
  publishedAt?: string;
}

export type ApiErrorCode =
  | 'bad-request'
  | 'invalid'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'slug-taken'
  | 'not-seeded'
  | 'too-large'
  | 'internal';

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  /** For "invalid": what to fix. */
  errors?: FieldError[];
  /** For "conflict": the version that is current now, and who saved it. */
  currentVersion?: number;
  updatedBy?: string;
  updatedAt?: string;
}
