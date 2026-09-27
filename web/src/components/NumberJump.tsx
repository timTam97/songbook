import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { index } from '../lib/data.ts';
import { songPath } from '../lib/songbook.ts';

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * "Go to #" box. Typing digits anywhere on the page (outside a text field)
 * starts filling it, so `4` `2` `Enter` opens hymn 42 from any screen.
 */
export function NumberJump() {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setInvalid(false);
        setValue(e.key);
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    const song = index.byNumber.get(n);
    if (!song) {
      setInvalid(value !== '');
      return;
    }
    setValue('');
    setInvalid(false);
    input.current?.blur(); // dismiss the mobile keyboard
    navigate(songPath(song));
  };

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
          onChange={(e) => {
            setInvalid(false);
            setValue(e.target.value.replace(/\D/g, ''));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue('');
              e.currentTarget.blur();
            }
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'hymn-number-error' : undefined}
          title={`Type a hymn number (${index.first}–${index.last}) and press Enter`}
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
