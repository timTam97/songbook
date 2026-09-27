/**
 * Decides what the "Go to #" box should do after each keystroke, so a hymn
 * opens without pressing Enter.
 *
 *  - go:      the number exists and no longer number starts with it (e.g. "25"
 *             in a 96-song book): open it now.
 *  - wait:    a longer number is still possible (e.g. "2" could become "25").
 *             If `number` exists, open it after a short pause.
 *  - invalid: no hymn has, or could have, this number.
 */
export type JumpDecision =
  | { kind: 'empty' }
  | { kind: 'go'; number: number }
  | { kind: 'wait'; number?: number }
  | { kind: 'invalid' };

/** How long to wait on an ambiguous number ("2" of "25") before opening it. */
export const JUMP_PAUSE_MS = 1000;

export function decideJump(value: string, numbers: readonly number[]): JumpDecision {
  if (value === '') return { kind: 'empty' };
  if (!/^[1-9]\d*$/.test(value)) return { kind: 'invalid' };
  const n = Number(value);
  const exists = numbers.includes(n);
  const canGrow = numbers.some((m) => {
    const s = String(m);
    return s.length > value.length && s.startsWith(value);
  });
  if (exists) return canGrow ? { kind: 'wait', number: n } : { kind: 'go', number: n };
  return canGrow ? { kind: 'wait' } : { kind: 'invalid' };
}
