import { useEffect } from 'react';
import { emitDayAction, type DayTab } from '../shortcuts';

export interface ShortcutActions {
  toggleChat: () => void;
  closeOverlays: () => void;
  newNote: () => void;
  goToday: () => void;
  goHistory: () => void;
  goProjects: () => void;
  goSettings: () => void;
  prevDay: () => void;
  nextDay: () => void;
  showHelp: () => void;
}

const TAB_KEYS: Record<string, DayTab> = { '1': 'stream', '2': 'standup', '3': 'wrap' };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Global keyboard shortcuts. Registered once per actions object and cleaned up on change. */
export function useShortcuts(actions: ShortcutActions): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        actions.toggleChat();
        return;
      }
      if (e.key === 'Escape') {
        actions.closeOverlays();
        return;
      }
      if (mod || e.altKey || e.repeat || isTyping(e.target)) return;

      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      // Some layouts/drivers report "?" as Shift+"/".
      if (e.key === '/' && e.shiftKey) return run(actions.showHelp);
      switch (e.key) {
        case 'n':
        case '/':
          return run(actions.newNote);
        case 't':
          return run(actions.goToday);
        case 'h':
          return run(actions.goHistory);
        case 'p':
          return run(actions.goProjects);
        case 's':
          return run(actions.goSettings);
        case '[':
          return run(actions.prevDay);
        case ']':
          return run(actions.nextDay);
        case 'c':
          return run(actions.toggleChat);
        case '?':
          return run(actions.showHelp);
        case 'C':
          return run(() => emitDayAction({ type: 'collate' }));
        case 'F':
          return run(() => emitDayAction({ type: 'finalize' }));
        case '1':
        case '2':
        case '3':
          return run(() => emitDayAction({ type: 'tab', tab: TAB_KEYS[e.key] }));
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}
