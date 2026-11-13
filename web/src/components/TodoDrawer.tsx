import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { Project, Todo, TodoInput, TodoSource } from '../types';
import { PREF_FRIENDLY_DATES, usePreference } from '../hooks/usePreference';
import { useTodos } from '../hooks/useTodos';
import { Icon } from './Icon';
import { fmtFull, fmtShort, fmtTime, friendlyDate, localDate } from './ui';

interface TodoFormValues {
  title: string;
  description: string;
  projectId: number | null;
  dueDate: string;
}

const EMPTY_FORM: TodoFormValues = { title: '', description: '', projectId: null, dueDate: '' };

function fromTodo(t: Todo): TodoFormValues {
  return { title: t.title, description: t.description, projectId: t.projectId, dueDate: t.dueDate ?? '' };
}

interface TodoFormProps {
  initial: TodoFormValues;
  projects: Project[];
  submitLabel: string;
  /** Show description, project and due date up front instead of behind a toggle. */
  expanded?: boolean;
  autoFocus?: boolean;
  onSubmit: (values: TodoFormValues) => Promise<boolean>;
  onCancel?: () => void;
}

function TodoForm({ initial, projects, submitLabel, expanded = false, autoFocus = false, onSubmit, onCancel }: TodoFormProps) {
  const [values, setValues] = useState(initial);
  const [showDetails, setShowDetails] = useState(expanded);
  const busyRef = useRef(false);
  const titleId = useId();
  const patch = (p: Partial<TodoFormValues>) => setValues((v) => ({ ...v, ...p }));
  const activeProjects = projects.filter((p) => !p.archived || p.id === values.projectId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current || !values.title.trim()) return;
    busyRef.current = true;
    try {
      if (await onSubmit(values)) {
        setValues(EMPTY_FORM);
        if (!expanded) setShowDetails(false);
      }
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <form className="todo-form" onSubmit={(e) => void submit(e)}>
      <input
        id={titleId}
        className="input"
        placeholder="Add a todo…"
        aria-label="Title"
        autoFocus={autoFocus}
        value={values.title}
        onChange={(e) => patch({ title: e.target.value })}
      />
      {showDetails && (
        <>
          <textarea
            className="textarea"
            rows={2}
            placeholder="Description (optional)"
            aria-label="Description"
            value={values.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
          <div className="todo-form-row">
            <select
              className="select"
              aria-label="Project"
              value={values.projectId ?? ''}
              onChange={(e) => patch({ projectId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No project</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              className="input"
              type="date"
              aria-label="Due date"
              value={values.dueDate}
              onChange={(e) => patch({ dueDate: e.target.value })}
            />
          </div>
        </>
      )}
      <div className="todo-form-actions">
        {!expanded && (
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showDetails} onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? 'Less' : 'Details'}
          </button>
        )}
        <span className="spacer" />
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-dark btn-sm" disabled={!values.title.trim()}>{submitLabel}</button>
      </div>
    </form>
  );
}

function DueBadge({ due, done }: { due: string; done: boolean }) {
  const [friendly] = usePreference(PREF_FRIENDLY_DATES, true);
  const today = localDate();
  const overdue = !done && due < today;
  const text = friendly ? friendlyDate(due, today) : fmtShort(due);
  return (
    <span className={`todo-due ${overdue ? 'overdue' : ''}`} title={friendly ? fmtFull(due) : undefined}>
      {overdue ? 'Overdue · ' : 'Due '}
      {text}
    </span>
  );
}

const SLIDE_OUT_MS = 220;
const COLLAPSE_MS = 200;
const COLLAPSE_PROPS = ['height', 'paddingTop', 'paddingBottom', 'borderBottomWidth'] as const;

/**
 * Slides the row right while it fades, then collapses its height so the rows below close
 * the gap. Resolves with a function that undoes it (used if the delete request fails).
 */
async function animateRowOut(el: HTMLElement): Promise<() => void> {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => undefined;
  const style = getComputedStyle(el);
  const from = Object.fromEntries(COLLAPSE_PROPS.map((p) => [p, style[p]]));
  const to = Object.fromEntries(COLLAPSE_PROPS.map((p) => [p, '0px']));
  const slide = el.animate(
    [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(56px)', opacity: 0 }],
    { duration: SLIDE_OUT_MS, easing: 'ease-in', fill: 'forwards' },
  );
  await slide.finished;
  el.style.overflow = 'hidden';
  const collapse = el.animate([from, to], { duration: COLLAPSE_MS, easing: 'ease-in-out', fill: 'forwards' });
  await collapse.finished;
  return () => {
    slide.cancel();
    collapse.cancel();
    el.style.overflow = '';
  };
}

const SOURCE_LABEL: Record<TodoSource, string> = {
  manual: 'Added manually',
  action_item: 'From an action item',
  suggested: 'Suggested in the standup',
};

/** Where the todo came from; todos created from a standup link back to that day's wrap-up. */
function TodoSourceLine({ todo, onOpenDay }: { todo: Todo; onOpenDay: (date: string) => void }) {
  const label = SOURCE_LABEL[todo.source];
  const day = todo.sourceDay;
  return (
    <div className="todo-source">
      {label}
      {day && (
        <>
          {' · '}
          <button type="button" className="todo-source-link" title="Open this standup's wrap-up" onClick={() => onOpenDay(day)}>
            {fmtShort(day)}
          </button>
        </>
      )}
    </div>
  );
}

/** Two lines of the description; click to expand or collapse when it is longer than that. */
function TodoDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Measures the rendered text, so it can only run after layout.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  const body = <span ref={ref} className={`todo-desc-text ${expanded ? '' : 'clamped'}`}>{text}</span>;
  if (!overflows && !expanded) return <div className="todo-desc">{body}</div>;
  return (
    <button type="button" className="todo-desc expandable" aria-expanded={expanded} title={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded((e) => !e)}>
      {body}
    </button>
  );
}

function TodoRow({ todo, projects, onOpenDay }: { todo: Todo; projects: Project[]; onOpenDay: (date: string) => void }) {
  const { update, remove, highlight } = useTodos();
  const rowRef = useRef<HTMLLIElement>(null);
  const pulseKey = highlight?.id === todo.id ? highlight.key : null;
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const project = projects.find((p) => p.id === todo.projectId);

  const confirmDelete = async () => {
    const el = rowRef.current;
    if (leavingRef.current || !el) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      const undo = await animateRowOut(el);
      // On success the row unmounts; if the request failed, bring it back.
      if (!(await remove(todo.id))) {
        undo();
        setLeaving(false);
        setConfirmingDelete(false);
      }
    } finally {
      leavingRef.current = false;
    }
  };

  useEffect(() => {
    if (pulseKey !== null) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pulseKey]);

  if (editing) {
    return (
      <li className="todo editing">
        <TodoForm
          expanded
          autoFocus
          initial={fromTodo(todo)}
          projects={projects}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await update(todo.id, {
              title: v.title,
              description: v.description,
              ...(v.projectId === null ? { clearProject: true } : { projectId: v.projectId }),
              ...(v.dueDate === '' ? { clearDueDate: true } : { dueDate: v.dueDate }),
            });
            setEditing(false);
            return true;
          }}
        />
      </li>
    );
  }

  return (
    <li ref={rowRef} className={`todo ${todo.done ? 'done' : ''} ${pulseKey !== null ? 'pulse' : ''} ${leaving ? 'leaving' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `Mark "${todo.title}" not done` : `Mark "${todo.title}" done`}
        className="todo-check"
        onClick={() => void update(todo.id, { done: !todo.done })}
      >
        {todo.done && <Icon name="check" size={13} />}
      </button>
      <div className="todo-main">
        <div className="todo-title">{todo.title}</div>
        {todo.description && <TodoDescription text={todo.description} />}
        {(project || todo.dueDate) && (
          <div className="todo-meta">
            {project && (
              <span className="chip"><span className="pdot" style={{ background: project.color }} />{project.name}</span>
            )}
            {todo.dueDate && <DueBadge due={todo.dueDate} done={todo.done} />}
          </div>
        )}
        <TodoSourceLine todo={todo} onOpenDay={onOpenDay} />
        {todo.done && todo.completedAt && (
          <div className="todo-completed">Completed {fmtShort(todo.completedAt.slice(0, 10))} · {fmtTime(todo.completedAt)}</div>
        )}
        {confirmingDelete && (
          <div className="todo-confirm" role="alertdialog" aria-label={`Delete "${todo.title}"?`}>
            <span>Delete this todo?</span>
            <button type="button" className="btn btn-sm btn-danger" disabled={leaving} onClick={() => void confirmDelete()}>Delete</button>
            <button type="button" className="btn btn-ghost btn-sm" autoFocus onClick={() => setConfirmingDelete(false)}>Cancel</button>
          </div>
        )}
      </div>
      {!confirmingDelete && (
        <div className="todo-actions">
          <button type="button" className="icon-btn" aria-label={`Edit "${todo.title}"`} onClick={() => setEditing(true)}><Icon name="edit" size={15} /></button>
          <button type="button" className="icon-btn danger" aria-label={`Delete "${todo.title}"`} onClick={() => setConfirmingDelete(true)}><Icon name="trash" size={15} /></button>
        </div>
      )}
    </li>
  );
}

interface TodoDrawerProps {
  open: boolean;
  projects: Project[];
  /** The user wants the drawer docked beside the content (only offered when `canPin`). */
  pinned: boolean;
  canPin: boolean;
  onTogglePin: () => void;
  onClose: () => void;
  /** Opens the wrap-up of a standup day (the target of a todo's source link). */
  onOpenDay: (date: string) => void;
}

/**
 * Right-hand drawer for managing the todo list. Always mounted so it can slide out as
 * well as in; open state and layout (pushing content aside when pinned) live in the shell.
 */
export function TodoDrawer({ open, projects, pinned, canPin, onTogglePin, onClose, onOpenDay }: TodoDrawerProps) {
  const { todos, add } = useTodos();
  const rootRef = useRef<HTMLElement>(null);
  const openTodos = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const docked = open && pinned;

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLInputElement>('.todo-add input')?.focus();
  }, [open]);

  const create = async (v: TodoFormValues) => {
    const input: TodoInput = {
      title: v.title,
      description: v.description,
      projectId: v.projectId,
      dueDate: v.dueDate || null,
    };
    return (await add(input)) !== null;
  };

  return (
    <>
      {open && !pinned && <div className="todo-backdrop" aria-hidden onMouseDown={onClose} />}
      <aside ref={rootRef} className={`todo-drawer ${open ? 'open' : ''} ${docked ? 'docked' : ''}`} role="dialog" aria-label="Todos" inert={!open}>
        <div className="todo-head">
          <h4>Todos</h4>
          <span className="badge open">{openTodos.length} open</span>
          <span className="spacer" />
          {canPin && (
            <button
              className={`icon-btn pin-btn ${pinned ? 'on' : ''}`}
              aria-label={pinned ? 'Unpin todos' : 'Pin todos beside the page'}
              aria-pressed={pinned}
              title={pinned ? 'Unpin' : 'Pin beside the page'}
              onClick={onTogglePin}
            >
              <Icon name="pin" size={16} />
            </button>
          )}
          <button className="icon-btn" aria-label="Close todos" onClick={onClose}><Icon name="x" size={17} /></button>
        </div>
        <div className="todo-add">
          <TodoForm initial={EMPTY_FORM} projects={projects} submitLabel="Add" onSubmit={create} />
        </div>
        <div className="todo-body">
          {openTodos.length === 0 ? (
            <div className="todo-empty muted small">Nothing to do. Add a todo above, or quick-add one from a standup summary.</div>
          ) : (
            <ul className="todo-list">
              {openTodos.map((t) => <TodoRow key={t.id} todo={t} projects={projects} onOpenDay={onOpenDay} />)}
            </ul>
          )}
          {done.length > 0 && (
            <details className="todo-done">
              <summary>Completed recently ({done.length})</summary>
              <ul className="todo-list">
                {done.map((t) => <TodoRow key={t.id} todo={t} projects={projects} onOpenDay={onOpenDay} />)}
              </ul>
            </details>
          )}
        </div>
      </aside>
    </>
  );
}
