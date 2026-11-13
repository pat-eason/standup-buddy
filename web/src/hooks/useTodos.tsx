import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Todo, TodoInput, TodoPatch } from '../types';
import { errMsg, useToast } from '../components/ui';

const OPEN_TODOS_EVENT = 'standup-buddy:open-todos';
// Three pulses of PULSE_MS after the drawer's slide-in, plus a little slack.
const PULSE_START_MS = 200;
const PULSE_MS = 600;
const PULSE_COUNT = 3;
const HIGHLIGHT_MS = PULSE_START_MS + PULSE_MS * PULSE_COUNT + 200;

/** Subscribes to requests to show the todo drawer (sent when a todo is revealed). */
export function onOpenTodosRequest(handler: () => void): () => void {
  window.addEventListener(OPEN_TODOS_EVENT, handler);
  return () => window.removeEventListener(OPEN_TODOS_EVENT, handler);
}

interface Highlight {
  id: number;
  /** Changes on every reveal so revealing the same todo again restarts the pulse. */
  key: number;
}

interface TodosValue {
  todos: Todo[];
  /** The todo currently pulsing in the drawer, if any. */
  highlight: Highlight | null;
  /** Opens the drawer (if closed) and pulses the todo. */
  reveal: (id: number) => void;
  /** Adds a todo; resolves to the saved todo, or null when the request failed (a toast is shown). */
  add: (input: TodoInput) => Promise<Todo | null>;
  update: (id: number, patch: TodoPatch) => Promise<void>;
  /** Deletes a todo; resolves to false when the request failed (a toast is shown). */
  remove: (id: number) => Promise<boolean>;
}

const TodosCtx = createContext<TodosValue | null>(null);

/** Owns the todo list so the drawer and the wrap-up quick-add buttons share one copy. */
export function TodosProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const reveal = useCallback((id: number) => {
    clearTimeout(highlightTimer.current);
    setHighlight({ id, key: Date.now() });
    highlightTimer.current = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    window.dispatchEvent(new Event(OPEN_TODOS_EVENT));
  }, []);

  useEffect(() => {
    let ignore = false;
    api
      .listTodos()
      .then((list) => !ignore && setTodos(list))
      .catch((e) => toast(errMsg(e), true));
    return () => {
      ignore = true;
    };
  }, [toast]);

  const add = useCallback(
    async (input: TodoInput) => {
      try {
        const t = await api.createTodo(input);
        setTodos((prev) => [...prev, t]);
        return t;
      } catch (e) {
        toast(errMsg(e), true);
        return null;
      }
    },
    [toast],
  );

  const update = useCallback(
    async (id: number, patch: TodoPatch) => {
      try {
        const t = await api.updateTodo(id, patch);
        setTodos((prev) => prev.map((x) => (x.id === id ? t : x)));
      } catch (e) {
        toast(errMsg(e), true);
      }
    },
    [toast],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await api.deleteTodo(id);
        setTodos((prev) => prev.filter((x) => x.id !== id));
        return true;
      } catch (e) {
        toast(errMsg(e), true);
        return false;
      }
    },
    [toast],
  );

  const value = useMemo(() => ({ todos, highlight, reveal, add, update, remove }), [todos, highlight, reveal, add, update, remove]);
  return <TodosCtx.Provider value={value}>{children}</TodosCtx.Provider>;
}

export function useTodos(): TodosValue {
  const v = useContext(TodosCtx);
  if (!v) throw new Error('useTodos must be used inside TodosProvider');
  return v;
}
