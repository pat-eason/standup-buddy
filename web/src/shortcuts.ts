export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

export type DayTab = 'stream' | 'standup' | 'wrap';
export type DayAction = { type: 'tab'; tab: DayTab } | { type: 'collate' } | { type: 'finalize' };

const DAY_ACTION_EVENT = 'standup-buddy:day-action';

/** Day-level shortcuts are delivered as events so the shortcut layer needn't own the day's state. */
export function emitDayAction(action: DayAction): void {
  window.dispatchEvent(new CustomEvent<DayAction>(DAY_ACTION_EVENT, { detail: action }));
}

export function onDayAction(handler: (action: DayAction) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<DayAction>).detail);
  window.addEventListener(DAY_ACTION_EVENT, listener);
  return () => window.removeEventListener(DAY_ACTION_EVENT, listener);
}

export interface ShortcutGroup {
  title: string;
  items: { keys: string[]; label: string }[];
}

/**
 * Single keys (no modifier) so nothing collides with browser shortcuts such as
 * Cmd+N / Cmd+T / Cmd+S / Cmd+J. They are ignored while typing in a field.
 * Cmd/Ctrl+K is the one modifier shortcut: browsers let pages claim it.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Go to',
    items: [
      { keys: ['T'], label: 'Today' },
      { keys: ['H'], label: 'History' },
      { keys: ['I'], label: 'Insights' },
      { keys: ['P'], label: 'Projects' },
      { keys: ['S'], label: 'Settings' },
      { keys: ['['], label: 'Previous day' },
      { keys: [']'], label: 'Next day' },
    ],
  },
  {
    title: 'Capture',
    items: [
      { keys: ['N'], label: 'New stream note' },
      { keys: ['/'], label: 'New stream note (alias)' },
      { keys: ['Enter'], label: 'Add note / point' },
      { keys: ['Shift', 'Enter'], label: 'New line in a note' },
    ],
  },
  {
    title: 'Standup',
    items: [
      { keys: ['1'], label: 'Stream tab' },
      { keys: ['2'], label: 'Standup tab' },
      { keys: ['3'], label: 'Wrap-up tab' },
      { keys: ['Shift', 'C'], label: 'Collate day' },
      { keys: ['Shift', 'F'], label: 'Finalize standup' },
    ],
  },
  {
    title: 'Assistant & help',
    items: [
      { keys: [MOD_KEY, 'K'], label: 'Toggle chat' },
      { keys: ['C'], label: 'Toggle chat' },
      { keys: ['?'], label: 'Show shortcuts' },
      { keys: ['Esc'], label: 'Close chat or dialog' },
    ],
  },
];
