import { useRef } from 'react';
import type { DayRecord, Project, SuggestedTodo, TodoSource } from '../types';
import { useTodos } from './useTodos';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 200;

export interface QuickAddOptions {
  source?: TodoSource;
  showInDrawer?: boolean;
}

const keyOf = (title: string) => title.trim().slice(0, MAX_TITLE).toLowerCase();

/**
 * Quick-add todos from a finalized day. A todo counts as added once one with the same
 * title exists with this day as its source, so the state survives reloads.
 */
export function useQuickAddTodo(day: DayRecord, projects: Project[]) {
  const { todos, add, reveal } = useTodos();
  const inFlight = useRef(new Set<string>());

  const isAdded = (title: string) => todos.some((t) => t.sourceDay === day.date && t.title.toLowerCase() === keyOf(title));

  /** `showInDrawer` opens the drawer and pulses the new todo; bulk adds turn it off. */
  const quickAdd = async (s: SuggestedTodo, { source = 'suggested', showInDrawer = true }: QuickAddOptions = {}) => {
    const key = keyOf(s.title);
    // Synchronous guard: a fast double-click must not create two todos.
    if (inFlight.current.has(key) || isAdded(s.title)) return;
    inFlight.current.add(key);
    try {
      const project = projects.find((p) => p.name.toLowerCase() === s.project?.trim().toLowerCase());
      const created = await add({
        title: s.title,
        description: s.description ?? '',
        projectId: project?.id ?? null,
        dueDate: s.dueDate && ISO_DATE.test(s.dueDate) ? s.dueDate : null,
        source,
        sourceDay: day.date,
      });
      if (created && showInDrawer) reveal(created.id);
    } finally {
      inFlight.current.delete(key);
    }
  };

  return { isAdded, quickAdd };
}
