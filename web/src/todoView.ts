import type { Project, Todo } from './types';
import { localDate } from './components/ui';

export type TodoSortKey = 'urgency' | 'due' | 'created' | 'project';
export type SortDir = 'asc' | 'desc';
export type DateField = 'due' | 'created';
/** null is every project; 'none' is todos without one. */
export type ProjectFilter = number | 'none' | null;

export interface TodoView {
  query: string;
  projectFilter: ProjectFilter;
  dateField: DateField;
  /** Inclusive YYYY-MM-DD bounds; '' is open-ended. */
  dateFrom: string;
  dateTo: string;
  sortKey: TodoSortKey;
  sortDir: SortDir;
}

export const DEFAULT_VIEW: TodoView = {
  query: '',
  projectFilter: null,
  dateField: 'due',
  dateFrom: '',
  dateTo: '',
  sortKey: 'due',
  sortDir: 'asc',
};

export const SORT_LABEL: Record<TodoSortKey, string> = {
  urgency: 'Urgency',
  due: 'Due date',
  created: 'Date added',
  project: 'Project',
};

/** The direction a sort starts in when picked: most urgent and newest first, A to Z, soonest due. */
export const NATURAL_DIR: Record<TodoSortKey, SortDir> = {
  urgency: 'desc',
  due: 'asc',
  created: 'desc',
  project: 'asc',
};

/** Filters that narrow the list (sorting does not count). */
export function activeFilterCount(v: TodoView): number {
  return (v.query.trim() ? 1 : 0) + (v.projectFilter !== null ? 1 : 0) + (v.dateFrom || v.dateTo ? 1 : 0);
}

function dateOf(t: Todo, field: DateField): string | null {
  return field === 'due' ? t.dueDate : localDate(new Date(t.createdAt));
}

export function filterTodos(todos: Todo[], v: TodoView, projects: Project[]): Todo[] {
  const names = new Map(projects.map((p) => [p.id, p.name.toLowerCase()]));
  const terms = v.query.toLowerCase().split(/\s+/).filter(Boolean);
  return todos.filter((t) => {
    if (v.projectFilter === 'none' && t.projectId !== null) return false;
    if (typeof v.projectFilter === 'number' && t.projectId !== v.projectFilter) return false;
    if (v.dateFrom || v.dateTo) {
      const d = dateOf(t, v.dateField);
      // A range can only match todos that have the date being filtered on.
      if (d === null || (v.dateFrom && d < v.dateFrom) || (v.dateTo && d > v.dateTo)) return false;
    }
    if (terms.length > 0) {
      const haystack = `${t.title} ${t.description} ${t.projectId === null ? '' : (names.get(t.projectId) ?? '')}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** Todos missing the sort value (no due date, no project) stay last in either direction. */
export function sortTodos(todos: Todo[], v: TodoView, projects: Project[]): Todo[] {
  const names = new Map(projects.map((p) => [p.id, p.name.toLowerCase()]));
  const sign = v.sortDir === 'asc' ? 1 : -1;
  const primary = (a: Todo, b: Todo): number => {
    switch (v.sortKey) {
      case 'urgency':
        return sign * (a.urgency - b.urgency);
      case 'created':
        return sign * cmp(a.createdAt, b.createdAt);
      case 'due':
        if (a.dueDate === b.dueDate) return 0;
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return sign * cmp(a.dueDate, b.dueDate);
      case 'project': {
        const an = a.projectId === null ? null : (names.get(a.projectId) ?? '');
        const bn = b.projectId === null ? null : (names.get(b.projectId) ?? '');
        if (an === bn) return 0;
        if (an === null) return 1;
        if (bn === null) return -1;
        return sign * cmp(an, bn);
      }
      default: {
        const unreachable: never = v.sortKey;
        return unreachable;
      }
    }
  };
  // Ties fall back to the order the list had before (due date, then oldest first).
  return [...todos].sort(
    (a, b) =>
      primary(a, b) ||
      (a.dueDate === b.dueDate ? 0 : a.dueDate === null ? 1 : b.dueDate === null ? -1 : cmp(a.dueDate, b.dueDate)) ||
      cmp(a.createdAt, b.createdAt) ||
      a.id - b.id,
  );
}
