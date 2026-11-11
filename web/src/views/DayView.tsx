import { useEffect, useRef, useState } from 'react';
import { KIND_LABEL, POINT_KINDS, type DayRecord, type PointKind, type Project } from '../types';
import { Icon } from '../components/Icon';
import { errMsg, fmtLong, parseDate, useToast } from '../components/ui';
import { onDayAction } from '../shortcuts';
import { StandupTab } from './StandupTab';
import { StreamTab } from './StreamTab';
import { WrapTab } from './WrapTab';
import { api } from '../api';

type Tab = 'stream' | 'standup' | 'wrap';
type Job = 'idle' | 'collating' | 'finalizing';

const TILE_CLASS: Record<PointKind, string> = {
  update: 't-update',
  question: 't-question',
  decision: 't-decision',
  parking: 't-parking',
};

function greeting(date: string, count: number, status: DayRecord['status']): { pre: string; head: React.ReactNode } {
  const d = parseDate(date);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  if (status === 'finalized') return { pre: fmtLong(date), head: <>Standup <em>wrapped</em> up.</> };
  if (count === 0) return { pre: fmtLong(date), head: <>Start your <em>{weekday}</em> log.</> };
  return { pre: fmtLong(date), head: <>You've logged <em>{count}</em> {count === 1 ? 'thought' : 'thoughts'} so far.</> };
}

interface DayViewProps {
  day: DayRecord;
  projects: Project[];
  focusRequested: boolean;
  onFocusHandled: () => void;
  reload: () => Promise<void>;
  setDay: (d: DayRecord) => void;
  onCreateProject: (name: string) => Promise<Project>;
}

export function DayView({ day, projects, focusRequested, onFocusHandled, reload, setDay, onCreateProject }: DayViewProps) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('stream');
  const [job, setJob] = useState<Job>('idle');
  const jobRef = useRef<Job>('idle');

  const run = async (kind: Exclude<Job, 'idle'>, next: Tab) => {
    if (jobRef.current !== 'idle') return;
    jobRef.current = kind;
    setJob(kind);
    try {
      const updated = kind === 'collating' ? await api.collate(day.date) : await api.finalize(day.date);
      setDay(updated);
      setTab(next);
      toast(kind === 'collating' ? 'Day collated' : 'Standup finalized');
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      jobRef.current = 'idle';
      setJob('idle');
    }
  };

  const reopen = async () => {
    try {
      setDay(await api.reopenDay(day.date));
      setTab('standup');
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  const canCollate = job === 'idle' && day.entries.length > 0 && day.status !== 'finalized';
  const canFinalize = job === 'idle' && day.points.length > 0;

  // Keyboard shortcuts (tabs, collate, finalize) arrive as events; re-subscribed each render so they see current state.
  useEffect(
    () =>
      onDayAction((action) => {
        if (action.type === 'tab') setTab(action.tab);
        else if (action.type === 'collate' && canCollate) void run('collating', 'standup');
        else if (action.type === 'finalize' && canFinalize) void run('finalizing', 'wrap');
      }),
  );

  // "New note" shortcut: show the Stream tab, then focus its composer once it is mounted.
  useEffect(() => {
    if (!focusRequested) return;
    setTab('stream');
    const timer = setTimeout(() => {
      document.getElementById('stream-composer')?.focus();
      onFocusHandled();
    }, 60);
    return () => clearTimeout(timer);
  }, [focusRequested, onFocusHandled]);

  const count = (k: PointKind) => day.points.filter((p) => p.kind === k).length;
  const g = greeting(day.date, day.entries.length, day.status);
  const collating = job === 'collating';
  const freshCount = day.entries.filter((e) => day.collatedAt && e.createdAt > day.collatedAt).length;

  return (
    <div className="page">
      <div className="hero">
        <svg className="hero-arc" viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden>
          <path d="M-20 260 C 160 40, 360 40, 560 -20" fill="none" stroke="#bfe6d3" strokeOpacity=".25" strokeWidth="1.5" />
          <path d="M-20 300 C 200 90, 400 80, 620 20" fill="none" stroke="#ff5a5f" strokeOpacity=".5" strokeWidth="1.5" />
        </svg>
        <div className="hero-left">
          <div>
            <div className="hello">{g.pre}</div>
            <h1>{g.head}</h1>
          </div>
          <div className="hero-actions">
            <button
              className="btn btn-accent"
              disabled={collating || day.entries.length === 0 || day.status === 'finalized'}
              onClick={() => void run('collating', 'standup')}
            >
              <Icon name={collating ? 'loader' : 'sparkle'} size={16} className={collating ? 'spin' : ''} />
              {collating ? 'Collating…' : day.collatedAt ? 'Collate again' : 'Collate day'}
            </button>
            {freshCount > 0 && <span className="badge new">{freshCount} new</span>}
            <span className={`badge ${day.status}`}>{day.status}</span>
          </div>
        </div>
        <div className="tiles">
          {POINT_KINDS.map((k, i) => (
            <div key={k} className={`tile ${TILE_CLASS[k]}`}>
              <span className="idx">0{i + 1}</span>
              <Icon name={k} className="big" size={86} />
              <div>
                <div className="num">{count(k)}</div>
                <div className="lbl">{KIND_LABEL[k]}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'stream'} className={`tab ${tab === 'stream' ? 'active' : ''}`} onClick={() => setTab('stream')}>
          Stream <span className="count">{day.entries.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'standup'} className={`tab ${tab === 'standup' ? 'active' : ''}`} onClick={() => setTab('standup')}>
          Standup <span className="count">{day.points.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'wrap'} className={`tab ${tab === 'wrap' ? 'active' : ''}`} onClick={() => setTab('wrap')}>
          Wrap-up
        </button>
      </div>

      {tab === 'stream' && (
        <StreamTab day={day} projects={projects} onChanged={reload} onCreateProject={onCreateProject} />
      )}
      {tab === 'standup' &&
        (day.points.length === 0 ? (
          <div className="card empty">
            <h3>No standup points yet</h3>
            <p style={{ margin: '0 0 18px' }}>Log a few entries, then collate the day to generate your updates, questions, decisions and parking lot.</p>
            <button className="btn btn-accent" disabled={collating || day.entries.length === 0} onClick={() => void run('collating', 'standup')}>
              <Icon name={collating ? 'loader' : 'sparkle'} size={16} className={collating ? 'spin' : ''} />
              {collating ? 'Collating…' : 'Collate day'}
            </button>
          </div>
        ) : (
          <StandupTab day={day} projects={projects} onChanged={reload} onFinalize={() => void run('finalizing', 'wrap')} finalizing={job === 'finalizing'} />
        ))}
      {tab === 'wrap' && (
        <WrapTab day={day} finalizing={job === 'finalizing'} onFinalize={() => void run('finalizing', 'wrap')} onReopen={() => void reopen()} />
      )}
    </div>
  );
}
