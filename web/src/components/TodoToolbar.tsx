import { useId, useState } from 'react';
import type { Project } from '../types';
import {
  SORT_LABEL,
  activeFilterCount,
  type DateField,
  type ProjectFilter,
  type TodoSortKey,
  type TodoView,
} from '../todoView';
import { Icon } from './Icon';

const SORT_KEYS = Object.keys(SORT_LABEL) as TodoSortKey[];

function toProjectFilter(value: string): ProjectFilter {
  if (value === '') return null;
  return value === 'none' ? 'none' : Number(value);
}

interface TodoToolbarProps {
  view: TodoView;
  projects: Project[];
  /** How many open todos match, and how many exist. */
  shown: number;
  total: number;
  onChange: (patch: Partial<TodoView>) => void;
  onSortKey: (key: TodoSortKey) => void;
  onToggleDir: () => void;
  onClear: () => void;
}

/** Search box, sort picker and a collapsible set of filters (project and date range) for the todo list. */
export function TodoToolbar({ view, projects, shown, total, onChange, onSortKey, onToggleDir, onClear }: TodoToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const filterCount = activeFilterCount(view);
  const asc = view.sortDir === 'asc';
  // Reads naturally for each key: "Most urgent first", "Soonest first", "Newest first", "A to Z".
  const dirLabel = SORT_DIR_LABEL[view.sortKey][view.sortDir];

  return (
    <div className="todo-toolbar">
      <div className="todo-search">
        <Icon name="search" size={15} />
        <input
          className="input"
          type="search"
          placeholder="Search todos…"
          aria-label="Search todos"
          value={view.query}
          onChange={(e) => onChange({ query: e.target.value })}
        />
      </div>
      <div className="todo-toolbar-row">
        <select className="select" aria-label="Sort by" value={view.sortKey} onChange={(e) => onSortKey(e.target.value as TodoSortKey)}>
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>{SORT_LABEL[k]}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost btn-sm todo-dir"
          title={`${dirLabel}. Click to reverse.`}
          aria-label={`Sort direction: ${dirLabel}. Reverse`}
          onClick={onToggleDir}
        >
          <Icon name={asc ? 'sort-asc' : 'sort-desc'} size={15} />
          {dirLabel}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className={`btn btn-ghost btn-sm ${filterCount > 0 ? 'has-filters' : ''}`}
          aria-expanded={filtersOpen}
          aria-controls={filtersId}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <Icon name="filter" size={15} />
          Filters{filterCount > 0 ? ` (${filterCount})` : ''}
        </button>
      </div>
      {filtersOpen && (
        <div id={filtersId} className="todo-filters">
          <select
            className="select"
            aria-label="Filter by project"
            value={view.projectFilter === null ? '' : String(view.projectFilter)}
            onChange={(e) => onChange({ projectFilter: toProjectFilter(e.target.value) })}
          >
            <option value="">All projects</option>
            <option value="none">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>
            ))}
          </select>
          <select className="select" aria-label="Date to filter on" value={view.dateField} onChange={(e) => onChange({ dateField: e.target.value as DateField })}>
            <option value="due">Due date</option>
            <option value="created">Date added</option>
          </select>
          <label className="todo-date">
            <span className="small muted">From</span>
            <input className="input" type="date" value={view.dateFrom} max={view.dateTo || undefined} onChange={(e) => onChange({ dateFrom: e.target.value })} />
          </label>
          <label className="todo-date">
            <span className="small muted">To</span>
            <input className="input" type="date" value={view.dateTo} min={view.dateFrom || undefined} onChange={(e) => onChange({ dateTo: e.target.value })} />
          </label>
        </div>
      )}
      {filterCount > 0 && (
        <div className="todo-toolbar-status small muted" role="status">
          Showing {shown} of {total} open
          <button type="button" className="todo-source-link" onClick={onClear}>Clear filters</button>
        </div>
      )}
    </div>
  );
}

const SORT_DIR_LABEL: Record<TodoSortKey, Record<TodoView['sortDir'], string>> = {
  urgency: { desc: 'Most urgent first', asc: 'Least urgent first' },
  due: { asc: 'Soonest first', desc: 'Latest first' },
  created: { desc: 'Newest first', asc: 'Oldest first' },
  project: { asc: 'A to Z', desc: 'Z to A' },
};
