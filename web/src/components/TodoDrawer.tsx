import { useId, useRef, useState, type FormEvent } from 'react';
import type { Project, Todo, TodoInput } from '../types';
import { useTodos } from '../hooks/useTodos';
import { Icon } from './Icon';
import { fmtShort, localDate } from './ui';

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
  const overdue = !done && due < localDate();
  return <span className={`todo-due ${overdue ? 'overdue' : ''}`}>{overdue ? 'Overdue · ' : 'Due '}{fmtShort(due)}</span>;
}

function TodoRow({ todo, projects }: { todo: Todo; projects: Project[] }) {
  const { update, remove } = useTodos();
  const [editing, setEditing] = useState(false);
  const project = projects.find((p) => p.id === todo.projectId);

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
    <li className={`todo ${todo.done ? 'done' : ''}`}>
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
        {todo.description && <div className="todo-desc">{todo.description}</div>}
        {(project || todo.dueDate) && (
          <div className="todo-meta">
            {project && (
              <span className="chip"><span className="pdot" style={{ background: project.color }} />{project.name}</span>
            )}
            {todo.dueDate && <DueBadge due={todo.dueDate} done={todo.done} />}
          </div>
        )}
      </div>
      <div className="todo-actions">
        <button type="button" className="icon-btn" aria-label={`Edit "${todo.title}"`} onClick={() => setEditing(true)}><Icon name="edit" size={15} /></button>
        <button type="button" className="icon-btn danger" aria-label={`Delete "${todo.title}"`} onClick={() => void remove(todo.id)}><Icon name="trash" size={15} /></button>
      </div>
    </li>
  );
}

interface TodoDrawerProps {
  projects: Project[];
  onClose: () => void;
}

/** Right-hand drawer for managing the todo list. Open/closed state lives in the app shell. */
export function TodoDrawer({ projects, onClose }: TodoDrawerProps) {
  const { todos, add } = useTodos();
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

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
    <aside className="todo-drawer" role="dialog" aria-label="Todos">
      <div className="todo-head">
        <h4>Todos</h4>
        <span className="badge open">{open.length} open</span>
        <span className="spacer" />
        <button className="icon-btn" aria-label="Close todos" onClick={onClose}><Icon name="x" size={17} /></button>
      </div>
      <div className="todo-add">
        <TodoForm initial={EMPTY_FORM} projects={projects} submitLabel="Add" autoFocus onSubmit={create} />
      </div>
      <div className="todo-body">
        {open.length === 0 ? (
          <div className="todo-empty muted small">Nothing to do. Add a todo above, or quick-add one from a standup summary.</div>
        ) : (
          <ul className="todo-list">
            {open.map((t) => <TodoRow key={t.id} todo={t} projects={projects} />)}
          </ul>
        )}
        {done.length > 0 && (
          <details className="todo-done">
            <summary>Completed recently ({done.length})</summary>
            <ul className="todo-list">
              {done.map((t) => <TodoRow key={t.id} todo={t} projects={projects} />)}
            </ul>
          </details>
        )}
      </div>
    </aside>
  );
}
