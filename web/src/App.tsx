import { useCallback, useEffect, useState } from 'react';
import type { DayRecord, DaySummary, Project } from './types';
import { ChatPopup } from './components/ChatPopup';
import { Icon } from './components/Icon';
import { errMsg, fmtLong, fmtShort, localDate, shiftDate, useToast } from './components/ui';
import { DayView } from './views/DayView';
import { HistoryView } from './views/HistoryView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { api } from './api';

type View = 'day' | 'history' | 'projects' | 'settings';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'day', label: 'Today', icon: 'today' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
];
const SETTINGS_NAV = { id: 'settings' as const, label: 'Settings', icon: 'settings' };
const COLLAPSE_KEY = 'standup-buddy.nav-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function useAppData(date: string | null) {
  const toast = useToast();
  const [day, setDay] = useState<DayRecord | null>(null);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const reload = useCallback(async () => {
    if (!date) return;
    try {
      const [d, list, projs] = await Promise.all([api.getDay(date), api.listDays(), api.listProjects()]);
      setDay(d);
      setDays(list);
      setProjects(projs);
    } catch (e) {
      toast(errMsg(e), true);
    }
  }, [date, toast]);

  useEffect(() => {
    let ignore = false;
    if (!date) return;
    Promise.all([api.getDay(date), api.listDays(), api.listProjects()])
      .then(([d, list, projs]) => {
        if (ignore) return;
        setDay(d);
        setDays(list);
        setProjects(projs);
      })
      .catch((e) => toast(errMsg(e), true));
    return () => {
      ignore = true;
    };
  }, [date, toast]);

  const updateDay = useCallback(
    (d: DayRecord) => {
      setDay(d);
      void api.listDays().then(setDays).catch(() => undefined);
    },
    [],
  );

  return { day, days, projects, reload, updateDay };
}

export function App() {
  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [focusSignal, setFocusSignal] = useState(0);
  const { day, days, projects, reload, updateDay } = useAppData(date);

  useEffect(() => {
    const t = localDate();
    setToday(t);
    setDate(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setChatOpen((o) => !o);
        return;
      }
      // "/" jumps to the stream composer, like quick capture.
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setView('day');
        setDate((d) => (today && d !== today ? today : d));
        setFocusSignal((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today]);

  const createProject = useCallback(async (name: string) => {
    const p = await api.createProject(name);
    await reload();
    return p;
  }, [reload]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable: the choice just won't persist */
      }
      return !c;
    });
  };

  const goTo = (id: View) => (id === 'day' && today ? openDay(today) : setView(id));

  const openDay = (d: string) => {
    setDate(d);
    setView('day');
  };

  const navButton = (n: { id: View; label: string; icon: string }) => (
    <button
      key={n.id}
      className={`nav-item ${view === n.id ? 'active' : ''}`}
      data-tip={n.label}
      aria-label={n.label}
      aria-current={view === n.id ? 'page' : undefined}
      onClick={() => goTo(n.id)}
    >
      <Icon name={n.icon} size={19} />
      <span className="nav-text">{n.label}</span>
    </button>
  );

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="side-head">
          <div className="brand">
            <span className="brand-full">Standup Buddy<i>.</i></span>
            <span className="brand-mini">S<i>.</i></span>
          </div>
          <button
            className="icon-btn collapse-btn"
            data-tip={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <Icon name="sidebar" size={18} />
          </button>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map(navButton)}
        </nav>
        <div className="nav-label">Recent days</div>
        <div className="recent">
          {days.slice(0, 12).map((d) => (
            <button key={d.date} onClick={() => openDay(d.date)}>
              <span className={`dot ${d.status === 'finalized' ? 'final' : d.status === 'open' ? 'open' : ''}`} />
              {fmtShort(d.date)}
            </button>
          ))}
        </div>
        <div className="nav-foot">{navButton(SETTINGS_NAV)}</div>
      </aside>

      <main className="main">
        <div className="topbar">
          <span />
          {view === 'day' && date && today ? (
            <div className="datenav">
              <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}><Icon name="left" size={16} /></button>
              <span className="label">{date === today ? 'Today' : fmtLong(date)}</span>
              <button className="icon-btn" aria-label="Next day" onClick={() => setDate(shiftDate(date, 1))}><Icon name="right" size={16} /></button>
              {date !== today && <button className="btn btn-ghost btn-sm" onClick={() => setDate(today)}>Today</button>}
            </div>
          ) : <span />}
          <span className="muted small">Press / to capture</span>
        </div>
        <div className="scroll">
          {view === 'day' && day && (
            <DayView key={day.date} day={day} projects={projects} focusSignal={focusSignal} reload={reload} setDay={updateDay} onCreateProject={createProject} />
          )}
          {view === 'history' && <HistoryView days={days} onOpen={openDay} />}
          {view === 'projects' && <ProjectsView projects={projects} onChanged={reload} />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>
      {chatOpen ? (
        <ChatPopup onClose={() => setChatOpen(false)} />
      ) : (
        <button className="chat-fab" aria-label="Ask your notes (⌘K)" data-tip="Ask your notes  ⌘K" onClick={() => setChatOpen(true)}>
          <Icon name="sparkle" size={24} />
        </button>
      )}
    </div>
  );
}
