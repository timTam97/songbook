import { PDF_AFTER_EDIT, PDF_ON_DEPLOY, type BookStatus } from '@songbook/core';

/** After this long, a PDF still behind the latest edit is worth flagging. */
export const PDF_STUCK_MS = 2 * 60 * 1000;

/**
 * none: never generated. current: holds the latest edit. updating: an edit is
 * newer, and the PDF it triggers is still being made. stuck: an edit is newer,
 * and has been for over PDF_STUCK_MS.
 */
export type PdfState = 'none' | 'current' | 'updating' | 'stuck';

export function pdfState(book: BookStatus, now = Date.now()): PdfState {
  if (!book.pdf) return 'none';
  if (book.pdf.bookUpdatedAt >= book.updatedAt) return 'current';
  return now - Date.parse(book.updatedAt) > PDF_STUCK_MS ? 'stuck' : 'updating';
}

/** How the PDF came to be made: "automatically after an edit", "by a deploy" or "by <editor>". */
export function madeBy(generatedBy: string): string {
  if (generatedBy === PDF_AFTER_EDIT) return 'automatically after an edit';
  if (generatedBy === PDF_ON_DEPLOY) return 'by a deploy';
  return `by ${generatedBy}`;
}
