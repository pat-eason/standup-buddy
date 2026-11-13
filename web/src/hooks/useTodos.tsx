import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Todo, TodoInput, TodoPatch } from '../types';
import { errMsg, useToast } from '../components/ui';

interface TodosValue {
  todos: Todo[];
  /** Adds a todo; resolves to the saved todo, or null when the request failed (a toast is shown). */
  add: (input: TodoInput) => Promise<Todo | null>;
  update: (id: number, patch: TodoPatch) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

const TodosCtx = createContext<TodosValue | null>(null);

/** Owns the todo list so the drawer and the wrap-up quick-add buttons share one copy. */
export function TodosProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [todos, setTodos] = useState<Todo[]>([]);

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
      } catch (e) {
        toast(errMsg(e), true);
      }
    },
    [toast],
  );

  const value = useMemo(() => ({ todos, add, update, remove }), [todos, add, update, remove]);
  return <TodosCtx.Provider value={value}>{children}</TodosCtx.Provider>;
}

export function useTodos(): TodosValue {
  const v = useContext(TodosCtx);
  if (!v) throw new Error('useTodos must be used inside TodosProvider');
  return v;
}
