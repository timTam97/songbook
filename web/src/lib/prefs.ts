import { useCallback, useEffect, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener('storage', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', fn);
  };
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: preference just won't persist */
  }
  listeners.forEach((fn) => fn());
}

function usePref(key: string): [string | null, (v: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key), () => null);
  return [value, useCallback((v: string | null) => write(key, v), [key])];
}

export const LYRIC_SCALES: readonly number[] = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

export function useLyricScale(): [number, (step: -1 | 1) => void, () => void] {
  const [raw, set] = usePref('lyricScale');
  const parsed = Number(raw);
  const current = raw !== null && LYRIC_SCALES.includes(parsed) ? parsed : 1;
  const step = (d: -1 | 1) => {
    const i = LYRIC_SCALES.indexOf(current);
    const next = LYRIC_SCALES[Math.min(LYRIC_SCALES.length - 1, Math.max(0, i + d))];
    set(next === 1 ? null : String(next));
  };
  return [current, step, () => set(null)];
}

/** Light/dark toggle; unset means "follow the system" (see /theme.js). */
export function useTheme(): [boolean, () => void] {
  const [saved, set] = usePref('theme');
  const systemDark = useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
  const dark = saved ? saved === 'dark' : systemDark;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  const toggle = () => {
    const next = !dark;
    // Picking the system's own choice returns to "follow the system".
    set(next === systemDark ? null : next ? 'dark' : 'light');
  };
  return [dark, toggle];
}
