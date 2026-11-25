/**
 * Draws the book that pdf-layout.ts lays out into a PDF, with subsets of the
 * Latin Modern fonts in fonts/ embedded. The same book always gives the same
 * bytes: the PDF's dates are the book's latest edit, not the time it was made.
 */
import { readFileSync } from 'node:fs';
import type { Songbook } from '@songbook/core';
import PDFDocument from 'pdfkit';
import { layoutBook, PAGE, type FontName, type Metrics } from './pdf-layout.ts';

export const FONT_FILES: Record<FontName, string> = {
  roman: 'lmroman12-regular.otf',
  italic: 'lmroman12-italic.otf',
  bold: 'lmroman12-bold.otf',
  boldItalic: 'lmroman10-bolditalic.otf',
  display: 'lmroman17-regular.otf',
  small: 'lmroman8-regular.otf',
  sans: 'lmsans12-regular.otf',
  sansSmall: 'lmsans8-regular.otf',
  marker: 'lmsans10-regular.otf',
  mono: 'lmmono12-regular.otf',
};

export type Fonts = Record<FontName, Buffer>;

/** The fonts in `dir`: fonts/ beside this file in the repo, and beside the bundle in the Lambda. */
export function loadFonts(dir: URL): Fonts {
  return Object.fromEntries(Object.entries(FONT_FILES).map(([name, file]) => [name, readFileSync(new URL(file, dir))])) as Fonts;
}

export interface RenderedPdf {
  bytes: Buffer;
  pages: number;
}

export async function renderPdf(book: Songbook, fonts: Fonts): Promise<RenderedPdf> {
  const date = new Date(book.updatedAt ?? 0);
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: 0,
    autoFirstPage: false,
    // No built-in default font: every font is one of ours, embedded.
    font: null as unknown as string,
    pdfVersion: '1.7',
    lang: 'en-AU',
    displayTitle: true,
    info: {
      Title: book.title,
      Subject: `${book.songs.length} songs`,
      Creator: 'Songbook admin portal',
      CreationDate: date,
      ModDate: date,
    },
  });
  for (const [name, data] of Object.entries(fonts)) doc.registerFont(name, data);

  const widths = new Map<string, number>();
  const metrics: Metrics = {
    width(text, font, size) {
      if (!text) return 0;
      const key = `${font}\u0000${size}\u0000${text}`;
      let w = widths.get(key);
      if (w === undefined) {
        w = doc.font(font).fontSize(size).widthOfString(text);
        widths.set(key, w);
      }
      return w;
    },
  };
  const pages = layoutBook(book, metrics);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  for (const page of pages) {
    doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
    for (const { name, y } of page.destinations) doc.addNamedDestination(name, 'XYZ', 0, y, null);
    for (const title of page.bookmarks) doc.outline.addItem(title);
    for (const item of page.items) {
      if (item.type === 'rule') {
        doc.moveTo(item.x, item.y).lineTo(item.x + item.width, item.y).lineWidth(0.4).stroke();
      } else if (item.text) {
        doc
          .font(item.font)
          .fontSize(item.size)
          .text(item.text, item.x, item.y, { lineBreak: false, baseline: 'alphabetic', ...(item.goTo ? { goTo: item.goTo } : {}) });
      }
    }
  }
  doc.end();
  await ended;
  return { bytes: Buffer.concat(chunks), pages: pages.length };
}
