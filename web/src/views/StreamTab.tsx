import { useRef, useState } from 'react';
import type { DayRecord, Project, StreamEntry } from '../types';
import { Icon } from '../components/Icon';
import { ProjectPicker, ProjectTags, errMsg, fmtTime, useToast } from '../components/ui';
import { api } from '../api';

interface StreamTabProps {
  day: DayRecord;
  projects: Project[];
  onChanged: () => Promise<void>;
  onCreateProject: (name: string) => Promise<Project>;
}

const EMPTY_IDS: number[] = [];

function Composer({ day, projects, onChanged, onCreateProject }: StreamTabProps) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [ids, setIds] = useState<number[]>(EMPTY_IDS);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);

  const add = async () => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    try {
      await api.addEntry(day.date, text, ids);
      setText('');
      await onChanged();
      areaRef.current?.focus();
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="card composer">
      <textarea
        id="stream-composer"
        ref={areaRef}
        className="textarea"
        value={text}
        placeholder="What's on your mind? Shipped something, blocked on something, a question, a decision…"
        aria-label="New stream of consciousness entry"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          }
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
      <div className="composer-foot">
        <div style={{ flex: 1, minWidth: 0 }}>
          <ProjectPicker projects={projects} value={ids} onChange={setIds} onCreate={onCreateProject} />
        </div>
        <span className="muted small">↵ add · ⇧↵ new line</span>
        <button className="btn btn-dark" disabled={!text.trim()} onClick={() => void add()}>
          <Icon name="plus" size={16} /> Add
        </button>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  projects,
  fresh,
  onChanged,
}: {
  entry: StreamEntry;
  projects: Project[];
  fresh: boolean;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  const [ids, setIds] = useState(entry.projectIds);

  const save = async () => {
    try {
      await api.updateEntry(entry.id, text, ids);
      setEditing(false);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  const remove = async () => {
    try {
      await api.deleteEntry(entry.id);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  return (
    <div className={`entry ${fresh ? 'fresh' : ''}`}>
      <span className="time">{fmtTime(entry.createdAt)}</span>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            autoFocus
            className="textarea"
            value={text}
            aria-label="Edit entry"
            rows={3}
            onChange={(e) => setText(e.target.value)}
          />
          <ProjectPicker projects={projects} value={ids} onChange={setIds} />
          <div className="row">
            <button className="btn btn-dark btn-sm" onClick={() => void save()}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setText(entry.text); setIds(entry.projectIds); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="text">{entry.text}</div>
          {entry.projectIds.length > 0 && (
            <div className="tags"><ProjectTags ids={entry.projectIds} projects={projects} /></div>
          )}
        </div>
      )}
      {!editing && (
        <div className="actions">
          <button className="icon-btn" aria-label="Edit entry" onClick={() => setEditing(true)}><Icon name="edit" size={16} /></button>
          <button className="icon-btn danger" aria-label="Delete entry" onClick={() => void remove()}><Icon name="trash" size={16} /></button>
        </div>
      )}
    </div>
  );
}

const STEPS: { title: string; hint: string; icon: string }[] = [
  { title: 'Log your day', hint: 'Stream of consciousness, tagged to projects', icon: 'stream' },
  { title: 'Collate', hint: 'Haiku turns it into standup points', icon: 'sparkle' },
  { title: 'Run the standup', hint: 'Check points off and add notes', icon: 'note' },
  { title: 'Finalize', hint: 'Summary, decisions and action items', icon: 'flag' },
];

function FlowCard({ day }: { day: DayRecord }) {
  const stage = day.status === 'finalized' ? 4 : day.status === 'collated' ? (day.points.some((p) => p.discussed || p.notes.length) ? 3 : 2) : day.entries.length ? 1 : 0;
  return (
    <aside className="card card-pad">
      <div className="eyebrow" style={{ marginBottom: 14 }}>Today's flow</div>
      <div className="flow">
        {STEPS.map((s, i) => {
          const state = i < stage ? 'done' : i === stage ? 'current' : '';
          return (
            <div key={s.title} className={`flow-step ${state}`}>
              <div className="flow-ico"><Icon name={i < stage ? 'check' : s.icon} size={16} /></div>
              <div>
                <h4>{s.title}</h4>
                <p>{s.hint}</p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function StreamTab(props: StreamTabProps) {
  const { day, projects, onChanged } = props;
  const collatedAt = day.collatedAt;
  return (
    <div className="two-col">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        {day.status !== 'finalized' && <Composer {...props} />}
        <div className="card entries">
          {day.entries.length === 0 ? (
            <div className="empty">
              <h3>Nothing logged yet</h3>
              <div>Jot things down as they happen. Press <b>N</b> from anywhere to jump here.</div>
            </div>
          ) : (
            [...day.entries].reverse().map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                projects={projects}
                fresh={Boolean(collatedAt) && e.createdAt > (collatedAt ?? '')}
                onChanged={onChanged}
              />
            ))
          )}
        </div>
      </div>
      <FlowCard day={day} />
    </div>
  );
}
