import { useState } from 'react';
import type { Project, Todo } from '../types';
import { DEFAULT_VIEW, NATURAL_DIR, filterTodos, sortTodos, type TodoSortKey, type TodoView } from '../todoView';

/**
 * Search, filter and sort state for the todo list, plus the todos it leaves visible.
 * The view lives as long as the caller does, so it survives closing the drawer.
 */
export function useTodoView(todos: Todo[], projects: Project[]) {
  const [view, setView] = useState<TodoView>(DEFAULT_VIEW);

  return {
    view,
    patch: (p: Partial<TodoView>) => setView((v) => ({ ...v, ...p })),
    /** Picking a different sort starts it in its natural direction. */
    setSortKey: (sortKey: TodoSortKey) => setView((v) => ({ ...v, sortKey, sortDir: NATURAL_DIR[sortKey] })),
    toggleDir: () => setView((v) => ({ ...v, sortDir: v.sortDir === 'asc' ? 'desc' : 'asc' })),
    /** Clears search and filters; the sort stays. */
    clearFilters: () => setView((v) => ({ ...DEFAULT_VIEW, sortKey: v.sortKey, sortDir: v.sortDir })),
    openTodos: sortTodos(filterTodos(todos.filter((t) => !t.done), view, projects), view, projects),
    /** Filtered but not re-sorted: completed todos stay newest-finished first. */
    doneTodos: filterTodos(todos.filter((t) => t.done), view, projects),
  };
}
