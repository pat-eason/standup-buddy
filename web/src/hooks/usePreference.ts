import { useCallback, useSyncExternalStore } from 'react';

export const PREF_TODOS_PINNED = 'standup-buddy.todos-pinned';
export const PREF_PAGE_TRANSITIONS = 'standup-buddy.page-transitions';
export const PREF_FRIENDLY_DATES = 'standup-buddy.friendly-dates';

const listeners = new Set<() => void>();
// Fallback for when localStorage is unavailable: the choice then lasts until reload.
const memory = new Map<string, boolean>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function read(key: string, fallback: boolean): boolean {
  const mem = memory.get(key);
  if (mem !== undefined) return mem;
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/** A persisted boolean UI preference, shared by every component that reads the same key. */
export function usePreference(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key, fallback));
  const set = useCallback(
    (next: boolean) => {
      memory.set(key, next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* storage unavailable: kept in memory only */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}

/** Tracks a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const sub = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(sub, () => window.matchMedia(query).matches);
}
