import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { Project } from '../types';
import { Icon } from './Icon';

// ---------- toasts ----------
interface Toast {
  id: number;
  text: string;
  err: boolean;
}
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, err = false) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 7000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- project picker ----------
export function ProjectPicker({
  projects,
  value,
  onChange,
  onCreate,
}: {
  projects: Project[];
  value: number[];
  onChange: (ids: number[]) => void;
  onCreate?: (name: string) => Promise<Project>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const active = projects.filter((p) => !p.archived || value.includes(p.id));
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const create = async () => {
    const n = name.trim();
    setAdding(false);
    setName('');
    if (!n || !onCreate) return;
    const p = await onCreate(n);
    onChange([...new Set([...value, p.id])]);
  };

  return (
    <div className="chips">
      {active.map((p) => (
        <button key={p.id} type="button" className={`chip ${value.includes(p.id) ? 'on' : ''}`} onClick={() => toggle(p.id)}>
          <span className="pdot" style={{ background: p.color }} />
          {p.name}
        </button>
      ))}
      {onCreate &&
        (adding ? (
          <input
            autoFocus
            className="input"
            style={{ width: 140, padding: '3px 10px', borderRadius: 999, fontSize: 12 }}
            placeholder="New project…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={create}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
              if (e.key === 'Escape') {
                setName('');
                setAdding(false);
              }
            }}
          />
        ) : (
          <button type="button" className="chip chip-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} /> project
          </button>
        ))}
    </div>
  );
}

export function ProjectTags({ ids, projects }: { ids: number[]; projects: Project[] }) {
  const map = new Map(projects.map((p) => [p.id, p]));
  return (
    <>
      {ids.map((id) => {
        const p = map.get(id);
        if (!p) return null;
        return (
          <span key={id} className="chip">
            <span className="pdot" style={{ background: p.color }} />
            {p.name}
          </span>
        );
      })}
    </>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

// ---------- date helpers ----------
export function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const fmtLong = (date: string) =>
  parseDate(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtShort = (date: string) =>
  parseDate(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
