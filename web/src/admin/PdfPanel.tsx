import { PDF_KEY, type BookStatus, type PdfResponse } from '@songbook/core';
import { useState } from 'react';
import { api } from './api.ts';
import { madeBy, pdfState } from './pdf-status.ts';
import { Alert, ago, button, fullTime, messageOf } from './ui.tsx';

/**
 * The book's PDF: its permanent address, when it was last made and whether
 * it has caught up with the latest edit, and a button that remakes it now
 * (for when an automatic update is stuck).
 */
export function PdfPanel({ book, onGenerated }: { book: BookStatus; onGenerated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string }>();
  const { pdf } = book;
  const state = pdfState(book);
  const url = `${window.location.origin}/${PDF_KEY}`;

  const regenerate = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const { result } = await api<{ result: PdfResponse }>('POST', '/pdf');
      const pages = result.pdf ? ` (${result.pdf.pages} pages)` : '';
      setNotice({ kind: 'success', text: `The PDF${pages} has been remade, and its address serves it now.` });
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
        The book to print, in the style of the old LaTeX book. It is remade from the songs within seconds of every edit, and this address always
        serves the latest:
      </p>
      <p className="mt-1 text-sm break-all">
        <a href={`/${PDF_KEY}`} target="_blank" rel="noopener" className={button.link}>
          {url}
        </a>
      </p>
      <div aria-live="polite" className="mt-2 text-sm">
        {pdf && (
          <p>
            Last made {ago(pdf.generatedAt)} {madeBy(pdf.generatedBy)} <span className="text-stone-500">({fullTime(pdf.generatedAt)})</span>:{' '}
            {pdf.songCount} songs, {pdf.pages} pages, {Math.max(1, Math.round(pdf.bytes / 1024))} KB.
          </p>
        )}
        <p
          className={`mt-1 ${state === 'stuck' ? 'font-medium text-red-700 dark:text-red-300' : 'text-stone-600 dark:text-stone-400'}`}
        >
          {state === 'none' && 'No PDF yet. One is made after the next edit, or regenerate it now.'}
          {state === 'current' && 'It includes every change.'}
          {state === 'updating' && 'Updating it with the latest changes… (usually under a minute)'}
          {state === 'stuck' && `It has not caught up with the latest changes (${ago(book.updatedAt)}). Regenerate it now.`}
        </p>
      </div>
      <button type="button" className={`${button.secondary} mt-3`} onClick={regenerate} disabled={busy}>
        {busy ? 'Regenerating…' : 'Regenerate PDF'}
      </button>
      {notice && (
        <div className="mt-3">
          <Alert kind={notice.kind}>{notice.text}</Alert>
        </div>
      )}
    </section>
  );
}
