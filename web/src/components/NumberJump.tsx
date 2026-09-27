import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { index } from '../lib/data.ts';
import { JUMP_PAUSE_MS, decideJump } from '../lib/jump.ts';
import { songPath } from '../lib/songbook.ts';

const NUMBERS = index.songs.map((s) => s.number);

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * "Go to #" box. The hymn opens as soon as the number is unambiguous: in a
 * 96-song book "25" opens at once, while "2" waits a moment in case "25" is
 * coming. After that pause the box keeps the digit, so typing "5" still
 * refines 2 → 25. Typing digits anywhere on the page starts filling the box.
 */
export function NumberJump() {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  /** Number of a timed (pause) jump waiting to fire. */
  const pending = useRef<number | undefined>(undefined);
  /** The last jump came from a pause and may still be refined, so the next one replaces it in history. */
  const tentative = useRef(false);
  const navigate = useNavigate();
  const decision = decideJump(value, NUMBERS);

  const goTo = (n: number, final: boolean) => {
    const song = index.byNumber.get(n);
    if (!song) return;
    navigate(songPath(song), { replace: tentative.current });
    tentative.current = !final;
    if (final) {
      setValue('');
      input.current?.blur(); // dismiss the mobile keyboard
    }
  };

  useEffect(() => {
    if (decision.kind === 'go') goTo(decision.number, true);
    if (decision.kind === 'wait' && decision.number !== undefined) {
      const n = decision.number;
      pending.current = n;
      const timer = setTimeout(() => {
        pending.current = undefined;
        goTo(n, false);
      }, JUMP_PAUSE_MS);
      return () => {
        clearTimeout(timer);
        pending.current = undefined;
      };
    }
    return undefined;
    // Re-run only when the typed value changes; goTo is recreated every render.
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setValue(e.key);
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Enter / Go opens a valid number straight away, without the pause.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (decision.kind === 'go' || (decision.kind === 'wait' && decision.number !== undefined)) goTo(decision.number!, true);
  };

  const invalid = decision.kind === 'invalid';

  return (
    <form onSubmit={submit} role="search" aria-label="Go to hymn by number" className="flex items-center">
      <label htmlFor="hymn-number" className="sr-only">
        Hymn number ({index.first}–{index.last})
      </label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-stone-400">
          #
        </span>
        <input
          ref={input}
          id="hymn-number"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="go"
          autoComplete="off"
          maxLength={4}
          placeholder="No."
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          onBlur={() => {
            // Tapping "Done" on a phone keyboard: open the waiting hymn now, then reset.
            if (pending.current !== undefined) goTo(pending.current, true);
            setValue('');
            tentative.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              pending.current = undefined;
              setValue('');
              e.currentTarget.blur();
            }
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'hymn-number-error' : undefined}
          title={`Type a hymn number (${index.first}–${index.last})`}
          className="h-9 w-[5.5rem] rounded-md border border-stone-300 bg-white pr-2 pl-6 tabular-nums placeholder:text-stone-400 aria-invalid:border-red-500 dark:border-stone-700 dark:bg-stone-950"
        />
      </div>
      <button type="submit" className="sr-only">
        Go
      </button>
      {invalid && (
        <p id="hymn-number-error" role="alert" className="absolute top-full right-4 mt-1 rounded-md bg-red-600 px-2 py-1 text-sm text-white shadow">
          No hymn {value}. Try {index.first}–{index.last}.
        </p>
      )}
    </form>
  );
}
