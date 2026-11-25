/**
 * Generates the book's PDF from the table and puts it in the site bucket as
 * melbourne-songs.pdf (PDF_KEY), the URL the LaTeX book's PDF was served at.
 *
 * Invoked by the admin portal's Generate PDF button (POST /api/admin/pdf) and
 * `npm run pdf -- --stage <stage>`. It records what it wrote in BOOK/PDF,
 * which (through the stream) republishes songbook.json, so the public site
 * shows the new PDF's date.
 *
 * Reserved concurrency 1: a second request while one runs is refused, and
 * the admin API says so.
 */
import { createHash } from 'node:crypto';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildSongbook, PDF_KEY, type PdfResponse, type PdfStatus, type Songbook } from '@songbook/core';
import { loadFonts, renderPdf, type Fonts, type RenderedPdf } from './pdf-render.ts';
import { doc, env, keys, loadBook, log, tableName, type PdfItem } from './store.ts';

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
}

export async function handler(event: PdfEvent = {}): Promise<PdfResponse> {
  const loaded = await loadBook();
  if (!loaded) {
    log('not seeded yet; no PDF generated');
    return { generated: false, reason: 'not-seeded' };
  }
  const { meta, songs } = loaded;
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
    generatedBy: event.actor || 'unknown',
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
