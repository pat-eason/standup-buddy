import { useEffect, useRef, useState } from 'react';

/** Time until the curtain fully covers the page; must fall inside the curtain's hold in styles.css. */
const COVER_MS = 450;
/** When the curtain starts leaving (72% of its 1.07s). Until then the page is hidden and the title is up. */
const EXIT_MS = 770;

export interface PageTransition<T> {
  /** The value whose page is on screen. Lags `target` while the curtain closes. */
  shown: T;
  /** Increments each time a new curtain starts (0 before the first); use as the curtain's key. */
  run: number;
}

/**
 * Delays swapping the page until a curtain covers it. Returns the value to render and a run
 * counter. Changing `target` while a curtain is still covering the page retargets it (the swap
 * happens as soon as the page is hidden) instead of starting another curtain; only once the
 * curtain is leaving does a change start a new one. With reduced motion, or when `enabled` is
 * false, the swap is immediate and `run` doesn't advance.
 */
export function usePageTransition<T>(target: T, enabled: boolean): PageTransition<T> {
  const [shown, setShown] = useState(target);
  const [run, setRun] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (shown === target) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !enabled) {
      setShown(target);
      return;
    }
    const now = performance.now();
    const covering = startedAt.current !== null && now - startedAt.current < EXIT_MS;
    let delay = COVER_MS;
    if (covering && startedAt.current !== null) {
      delay = Math.max(0, COVER_MS - (now - startedAt.current));
    } else {
      startedAt.current = now;
      setRun((r) => r + 1);
    }
    const timer = window.setTimeout(() => setShown(target), delay);
    return () => window.clearTimeout(timer);
    // `shown` is deliberately left out: it only changes when this effect's own timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, enabled]);

  return { shown, run };
}
