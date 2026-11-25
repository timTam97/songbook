import { PDF_KEY, type BookStatus, type PdfResponse } from '@songbook/core';
import { useState } from 'react';
import { api } from './api.ts';
import { Alert, ago, button, fullTime, messageOf } from './ui.tsx';

/**
 * The book's PDF: when it was last generated and whether edits have been made
 * since, with a button that generates it from the current songs.
 */
export function PdfPanel({ book, onGenerated }: { book: BookStatus; onGenerated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string }>();
  const { pdf } = book;
  const behind = pdf !== undefined && pdf.bookUpdatedAt < book.updatedAt;

  const generate = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const { result } = await api<{ result: PdfResponse }>('POST', '/pdf');
      const pages = result.pdf ? ` (${result.pdf.pages} pages)` : '';
      setNotice({ kind: 'success', text: `The new PDF${pages} is ready, and the public site serves it now.` });
      onGenerated();
    } catch (err) {
      setNotice({ kind: 'error', text: messageOf(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="pdf-heading" className="mt-10 max-w-lg">
      <h2 id="pdf-heading" className="font-serif text-xl font-semibold tracking-tight">
        PDF
      </h2>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
        The book to print, made from the current songs in the style of the old LaTeX book. The public site links to it.
      </p>
      <div aria-live="polite" className="mt-3 text-sm">
        {pdf ? (
          <>
            <p>
              Generated {ago(pdf.generatedAt)} by {pdf.generatedBy} <span className="text-stone-500">({fullTime(pdf.generatedAt)})</span>:{' '}
              {pdf.songCount} songs, {pdf.pages} pages, {Math.max(1, Math.round(pdf.bytes / 1024))} KB.
            </p>
            <p className={`mt-1 ${behind ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-stone-600 dark:text-stone-400'}`}>
              {behind ? `The book has changed since (latest edit ${ago(book.updatedAt)}). Generate it again to include the changes.` : 'It includes every change.'}
            </p>
          </>
        ) : (
          <p className="text-stone-600 dark:text-stone-400">No PDF has been generated yet. The public site shows a link to it once there is one.</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={button.primary} onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : pdf ? 'Generate again' : 'Generate PDF'}
        </button>
        {pdf && (
          <a href={`/${PDF_KEY}`} target="_blank" rel="noopener" className={button.link}>
            Open the PDF
          </a>
        )}
      </div>
      {notice && (
        <div className="mt-3">
          <Alert kind={notice.kind}>{notice.text}</Alert>
        </div>
      )}
    </section>
  );
}
