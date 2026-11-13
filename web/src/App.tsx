import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DayRecord, DaySummary, Project } from './types';
import { ChatPopup } from './components/ChatPopup';
import { Icon } from './components/Icon';
import { TopbarTitleProvider, type TopbarTitle } from './components/PageTitle';
import { TodoDrawer } from './components/TodoDrawer';
import { ShortcutHelp } from './components/ShortcutHelp';
import { PREF_TODOS_PINNED, useMediaQuery, usePreference } from './hooks/usePreference';
import { onOpenTodosRequest, useTodos } from './hooks/useTodos';
import { useShortcuts, type ShortcutActions } from './hooks/useShortcuts';
import { MOD_KEY, emitDayAction, type DayTab } from './shortcuts';
import { errMsg, fmtLong, fmtShort, localDate, shiftDate, useToast } from './components/ui';
import { DayView } from './views/DayView';
import { HistoryView } from './views/HistoryView';
import { InsightsView } from './views/InsightsView';
import { ProjectsView } from './views/ProjectsView';
import { SettingsView } from './views/SettingsView';
import { api } from './api';

type View = 'day' | 'history' | 'insights' | 'projects' | 'settings';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'day', label: 'Today', icon: 'today' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'insights', label: 'Insights', icon: 'insights' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
];
const SETTINGS_NAV = { id: 'settings' as const, label: 'Settings', icon: 'settings' };
// Pinning needs room for the nav, the page and a 400px column.
const TABLET_LANDSCAPE = '(min-width: 1024px)';
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
  const [todosOpen, setTodosOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState<TopbarTitle | null>(null);
  const [focusRequested, setFocusRequested] = useState(false);
  const { day, days, projects, reload, updateDay } = useAppData(date);
  const { todos } = useTodos();
  const [pendingTab, setPendingTab] = useState<{ date: string; tab: DayTab } | null>(null);
  const [pinPref, setPinPref] = usePreference(PREF_TODOS_PINNED, false);
  const canPin = useMediaQuery(TABLET_LANDSCAPE);
  const pinActive = canPin && pinPref;
  const dockedTodos = todosOpen && pinActive;
  useEffect(
    () =>
      onOpenTodosRequest(() => {
        setTodosOpen(true);
        if (!pinActive) setChatOpen(false);
      }),
    [pinActive],
  );
  const openTodoCount = todos.filter((t) => !t.done).length;

  useEffect(() => {
    const t = localDate();
    setToday(t);
    setDate(t);
  }, []);



  const createProject = useCallback(async (name: string) => {
    const p = await api.createProject(name);
    await reload();
    return p;
  }, [reload]);

  const shortcuts = useMemo<ShortcutActions>(
    () => ({
      toggleChat: () => {
        setChatOpen((o) => !o);
        if (!pinActive) setTodosOpen(false);
      },
      toggleTodos: () => {
        setTodosOpen((o) => !o);
        if (!pinActive) setChatOpen(false);
      },
      closeOverlays: () => {
        if (helpOpen) setHelpOpen(false);
        else if (todosOpen) setTodosOpen(false);
        else setChatOpen(false);
      },
      newNote: () => {
        setView('day');
        if (today) setDate(today);
        setFocusRequested(true);
      },
      goToday: () => {
        setView('day');
        if (today) setDate(today);
      },
      goHistory: () => setView('history'),
      goInsights: () => setView('insights'),
      goProjects: () => setView('projects'),
      goSettings: () => setView('settings'),
      prevDay: () => {
        setView('day');
        setDate((d) => (d ? shiftDate(d, -1) : d));
      },
      nextDay: () => {
        setView('day');
        setDate((d) => (d ? shiftDate(d, 1) : d));
      },
      showHelp: () => setHelpOpen(true),
    }),
    [today, helpOpen, todosOpen, pinActive],
  );
  useShortcuts(shortcuts);

  const openTodos = () => {
    setTodosOpen(true);
    if (!pinActive) setChatOpen(false);
  };
  const openChat = () => {
    setChatOpen(true);
    if (!pinActive) setTodosOpen(false);
  };

  // Source links from the todo list: show that day's wrap-up, and get out of the way unless pinned.
  const openWrapUp = (d: string) => {
    if (view === 'day' && date === d) emitDayAction({ type: 'tab', tab: 'wrap' });
    else {
      setPendingTab({ date: d, tab: 'wrap' });
      setDate(d);
      setView('day');
    }
    if (!pinActive) setTodosOpen(false);
  };
  const clearPendingTab = useCallback(() => setPendingTab(null), []);

  const handleFocusHandled = useCallback(() => setFocusRequested(false), []);

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
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${dockedTodos ? 'todos-pinned' : ''}`}>
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
          ) : (
            <span className={`topbar-title ${pageTitle?.hidden ? 'visible' : ''}`} aria-hidden={!pageTitle?.hidden}>
              {pageTitle?.text}
            </span>
          )}
          <button className="hint-btn" onClick={() => setHelpOpen(true)}>Press <kbd>?</kbd> for shortcuts</button>
        </div>
        <TopbarTitleProvider report={setPageTitle}>
        <div className="scroll">
          {view === 'day' && day && (
            <DayView key={day.date} day={day} initialTab={pendingTab?.date === day.date ? pendingTab.tab : undefined} onInitialTabHandled={clearPendingTab} projects={projects} focusRequested={focusRequested} onFocusHandled={handleFocusHandled} reload={reload} setDay={updateDay} onCreateProject={createProject} />
          )}
          {view === 'history' && <HistoryView days={days} onOpen={openDay} />}
          {view === 'insights' && today && <InsightsView today={today} onOpenDay={openDay} />}
          {view === 'projects' && <ProjectsView projects={projects} onChanged={reload} />}
          {view === 'settings' && <SettingsView />}
        </div>
        </TopbarTitleProvider>
      </main>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      <TodoDrawer
        open={todosOpen}
        projects={projects}
        pinned={pinActive}
        canPin={canPin}
        onTogglePin={() => setPinPref(!pinPref)}
        onClose={() => setTodosOpen(false)}
        onOpenDay={openWrapUp}
      />
      {chatOpen && <ChatPopup onClose={() => setChatOpen(false)} />}
      {!chatOpen && !todosOpen && (
        <button
          className="chat-fab todo-fab"
          aria-label={openTodoCount > 0 ? `Todos, ${openTodoCount} open (D)` : 'Todos (D)'}
          data-tip="Todos  D"
          onClick={() => openTodos()}
        >
          <Icon name="todo" size={16} />
          {openTodoCount > 0 && <span className="fab-badge" aria-hidden>{openTodoCount > 99 ? '99+' : openTodoCount}</span>}
        </button>
      )}
      {!chatOpen && (!todosOpen || pinActive) && (
        <button className="chat-fab" aria-label={`Ask your notes (${MOD_KEY}+K)`} data-tip={`Ask your notes  ${MOD_KEY}K`} onClick={() => openChat()}>
          <Icon name="sparkle" size={16} />
        </button>
      )}
    </div>
  );
}
