import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ProjectPicker, errMsg, localDate } from './components/ui';
import { Icon } from './components/Icon';
import type { Project } from './types';

/** Time the "saved" confirmation is shown before the window closes itself. */
const SAVED_MS = 550;
/** If the window refuses to close (opened as a normal tab), reset after this long. */
const CLOSE_GRACE_MS = 300;
/** Input height: starts at 2 lines, grows with content to 5, and can be dragged out to 10. */
const LINE_PX = 24;
const CHROME_PX = 30;
const MIN_LINES = 2;
const AUTO_MAX_LINES = 5;
const DRAG_MAX_LINES = 10;
const PROJECTS_KEY = 'standup-buddy.capture-projects';

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

function readProjectIds(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * Spotlight-style quick capture: a tiny page meant for a small app window.
 * Enter saves the note to today's stream and closes the window; Esc closes it.
 */
export function CaptureApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectIds, setProjectIds] = useState<number[]>(readProjectIds);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const manualH = useRef(0);
  const autoH = useRef(0);

  const fit = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    // A drag leaves the height different from what we last set: remember it as the user's floor.
    if (autoH.current && Math.abs(el.offsetHeight - autoH.current) > 1) manualH.current = el.offsetHeight;
    el.style.height = 'auto';
    const content = Math.min(el.scrollHeight, AUTO_MAX_LINES * LINE_PX + CHROME_PX);
    const h = Math.min(Math.max(content, manualH.current, MIN_LINES * LINE_PX + CHROME_PX), DRAG_MAX_LINES * LINE_PX + CHROME_PX);
    el.style.height = `${h}px`;
    autoH.current = h;
  }, []);

  useEffect(fit, [text, fit]);

  useEffect(() => {
    document.title = 'Quick note';
    let ignore = false;
    api
      .listProjects()
      .then((list) => !ignore && setProjects(list))
      .catch((e) => !ignore && setStatus({ kind: 'error', message: errMsg(e) }));
    return () => {
      ignore = true;
    };
  }, []);

  const updateProjects = useCallback((ids: number[]) => {
    setProjectIds(ids);
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(ids));
    } catch {
      /* storage unavailable: the selection just won't be remembered */
    }
  }, []);

  const createProject = useCallback(async (name: string) => {
    const project = await api.createProject(name);
    setProjects(await api.listProjects());
    return project;
  }, []);

  const save = async () => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    setStatus({ kind: 'saving' });
    try {
      await api.addEntry(localDate(), text, projectIds);
      setStatus({ kind: 'saved' });
      setText('');
      updateProjects([]);
      manualH.current = 0;
      setTimeout(() => {
        window.close();
        // Still here: this was opened as a normal tab, so get ready for the next note instead.
        setTimeout(() => {
          setStatus({ kind: 'idle' });
          areaRef.current?.focus();
        }, CLOSE_GRACE_MS);
      }, SAVED_MS);
    } catch (e) {
      setStatus({ kind: 'error', message: errMsg(e) });
    } finally {
      busy.current = false;
    }
  };

  const disabled = status.kind === 'saving' || status.kind === 'saved';

  return (
    <div className="capture" onKeyDown={(e) => e.key === 'Escape' && window.close()}>
      <div className="capture-head">
        <h1>Quick note</h1>
        <span className="chip">Today</span>
        <span className="spacer" />
        <span className="muted small">↵ save · ⇧↵ new line · esc close</span>
      </div>
      <textarea
        ref={areaRef}
        autoFocus
        className="textarea capture-input"
        value={text}
        disabled={disabled}
        placeholder="What's on your mind? Shipped something, blocked on something, a question…"
        aria-label="Stream note"
        rows={MIN_LINES}
        onMouseUp={fit}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <ProjectPicker projects={projects} value={projectIds} onChange={updateProjects} onCreate={createProject} />
      <div className="capture-foot" aria-live="polite">
        {status.kind === 'error' && <span className="status-bad">{status.message}</span>}
        {status.kind === 'saving' && <span className="muted small">Saving…</span>}
        {status.kind === 'saved' && (
          <span className="capture-saved"><Icon name="check" size={16} strokeWidth={2.4} /> Saved to today's stream</span>
        )}
      </div>
    </div>
  );
}
