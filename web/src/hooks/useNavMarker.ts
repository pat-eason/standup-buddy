import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface NavMarkerRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the box moved because the layout changed (resize, collapse), so it should not glide. */
  snap: boolean;
  /** False until the first measurement, so the marker doesn't fly in from the corner on load. */
  ready: boolean;
}

const HIDDEN: NavMarkerRect = { x: 0, y: 0, w: 0, h: 0, snap: true, ready: false };

/**
 * Tracks the box of the active nav item (`aria-current="page"`) relative to the sidebar,
 * so one floating marker can glide between items. Changing `activeKey` glides; layout
 * changes (window resize, sidebar collapse) snap, so the marker never lags behind the grid.
 */
export function useNavMarker(sidebarRef: RefObject<HTMLElement | null>, activeKey: string): NavMarkerRect {
  const [rect, setRect] = useState<NavMarkerRect>(HIDDEN);
  const keyRef = useRef(activeKey);

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const keyChanged = keyRef.current !== activeKey;
    keyRef.current = activeKey;

    const measure = (snap: boolean) => {
      const item = sidebar.querySelector<HTMLElement>('[aria-current="page"]');
      if (!item) {
        setRect((r) => (r.ready ? { ...r, ready: false } : r));
        return;
      }
      const s = sidebar.getBoundingClientRect();
      const i = item.getBoundingClientRect();
      const next = { x: i.left - s.left, y: i.top - s.top, w: i.width, h: i.height };
      setRect((r) =>
        r.ready && r.x === next.x && r.y === next.y && r.w === next.w && r.h === next.h && r.snap === snap
          ? r
          : { ...next, snap: snap || !r.ready, ready: true },
      );
    };

    measure(!keyChanged);
    // A new observer reports once on observe(); that isn't a layout change, so don't snap on it.
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      measure(true);
    });
    observer.observe(sidebar);
    const item = sidebar.querySelector<HTMLElement>('[aria-current="page"]');
    if (item) observer.observe(item);
    return () => observer.disconnect();
  }, [sidebarRef, activeKey]);

  return rect;
}
