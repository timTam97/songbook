/**
 * Generates the book's PDF from the table and puts it in the site bucket as
 * melbourne-songs.pdf (PDF_KEY), the URL the LaTeX book's PDF was served at.
 * Each PDF replaces the last there, so the URL always serves the latest.
 *
 * Invoked by:
 *  - the table's stream (SONG items and BOOK/META only), batched like the
 *    publisher's, so the PDF follows every edit within seconds;
 *  - the deploy, after the seed and before the publish, whenever this code changes;
 *  - the admin portal's Regenerate button (POST /api/admin/pdf) and
 *    `npm run pdf -- --stage <stage>`, which name who asked.
 * It records what it wrote in BOOK/PDF, which (through the stream) republishes
 * songbook.json, so the public site knows the PDF's date.
 *
 * Reserved concurrency 1: a request while one runs is refused (the admin API
 * says so; the stream retries).
 */
import { createHash } from 'node:crypto';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildSongbook, PDF_AFTER_EDIT, PDF_KEY, PDF_ON_DEPLOY, type PdfResponse, type PdfStatus, type Songbook } from '@songbook/core';
import { loadFonts, renderPdf, type Fonts, type RenderedPdf } from './pdf-render.ts';
import { doc, env, getItem, keys, loadBook, log, tableName, type PdfItem } from './store.ts';

export const PDF_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({});

// fonts/ sits beside this file in the repo and beside the bundle in the Lambda (see infra/lib/song-data.ts).
let fonts: Fonts | undefined;

/** The book as a PDF, with the fonts shipped beside this module. */
export function renderBook(book: Songbook): Promise<RenderedPdf> {
  fonts ??= loadFonts(new URL('./fonts/', import.meta.url));
  return renderPdf(book, fonts);
}

export interface PdfEvent {
  /** Who asked for it, as the admin portal names editors. */
  actor?: string;
  /** Present when the table's stream invoked it. */
  Records?: unknown[];
}

const actorOf = (event: PdfEvent): string => event.actor || (Array.isArray(event.Records) ? PDF_AFTER_EDIT : PDF_ON_DEPLOY);

export async function handler(event: PdfEvent = {}): Promise<PdfResponse> {
  const loaded = await loadBook();
  if (!loaded) {
    log('not seeded yet; no PDF generated');
    return { generated: false, reason: 'not-seeded' };
  }
  const { meta, songs } = loaded;
  if (Array.isArray(event?.Records)) {
    // An edit's song and book records can arrive in separate batches: the first makes the PDF.
    const last = await getItem<PdfItem>(keys.pdf);
    if (last?.bookUpdatedAt === meta.updatedAt) {
      log('PDF already holds the latest edit; not remade', { bookUpdatedAt: meta.updatedAt });
      return { generated: false, reason: 'unchanged' };
    }
  }
  const book = buildSongbook({ title: meta.title, released: meta.released, updatedAt: meta.updatedAt }, songs);
  const { bytes, pages } = await renderBook(book);
  const hash = createHash('sha256').update(bytes).digest('hex');

  await s3.send(
    new PutObjectCommand({
      Bucket: env('BUCKET_NAME'),
      Key: PDF_KEY,
      Body: bytes,
      ContentType: 'application/pdf',
      CacheControl: PDF_CACHE_CONTROL,
    }),
  );
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: env('DISTRIBUTION_ID'),
      InvalidationBatch: { CallerReference: `pdf-${hash.slice(0, 16)}-${Date.now()}`, Paths: { Quantity: 1, Items: [`/${PDF_KEY}`] } },
    }),
  );

  const pdf: PdfStatus = {
    generatedAt: new Date().toISOString(),
    generatedBy: actorOf(event ?? {}),
    bookUpdatedAt: meta.updatedAt,
    songCount: book.songs.length,
    pages,
    bytes: bytes.length,
  };
  const item: PdfItem = { ...keys.pdf, ...pdf, hash };
  await doc.send(new PutCommand({ TableName: tableName(), Item: item }));
  log('generated the PDF', { songs: pdf.songCount, pages, bytes: pdf.bytes, hash, actor: pdf.generatedBy });
  return { generated: true, pdf };
}
