import { useRef, useState } from 'react';
import { KIND_LABEL, KIND_SINGULAR, POINT_KINDS, type DayRecord, type Point, type PointKind, type Project } from '../types';
import { Icon } from '../components/Icon';
import { ProjectPicker, ProjectTags, errMsg, fmtTime, useToast } from '../components/ui';
import { api } from '../api';

interface StandupTabProps {
  day: DayRecord;
  projects: Project[];
  onChanged: () => Promise<void>;
  onFinalize: () => void;
  finalizing: boolean;
}

function NoteThread({ point, onChanged }: { point: Point; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const busy = useRef(false);

  const add = async () => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    try {
      await api.addNote(point.id, text);
      setText('');
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      busy.current = false;
    }
  };
  const remove = async (id: number) => {
    try {
      await api.deleteNote(id);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  return (
    <div className="notes">
      {point.notes.map((n) => (
        <div key={n.id} className="note">
          <div>
            <div className="when">{fmtTime(n.createdAt)}</div>
            <div className="ntext">{n.text}</div>
          </div>
          <div className="actions">
            <button className="icon-btn danger" aria-label="Delete note" onClick={() => void remove(n.id)}><Icon name="x" size={14} /></button>
          </div>
        </div>
      ))}
      <input
        autoFocus
        className="input"
        value={text}
        placeholder="Add a note from the discussion…  ↵ to save"
        aria-label="Add note"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add();
        }}
      />
    </div>
  );
}

function PointRow({ point, projects, onChanged }: { point: Point; projects: Project[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(point.text);
  const [tagging, setTagging] = useState(false);

  const patch = async (p: Parameters<typeof api.updatePoint>[1]) => {
    try {
      await api.updatePoint(point.id, p);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  const commitText = async () => {
    setEditing(false);
    if (text.trim() && text.trim() !== point.text) await patch({ text });
    else setText(point.text);
  };
  const remove = async () => {
    try {
      await api.deletePoint(point.id);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  return (
    <div className={`point ${point.discussed ? 'done' : ''} ${open ? 'open' : ''}`}>
      <div className="point-main">
        <button
          role="checkbox"
          aria-checked={point.discussed}
          aria-label="Mark as discussed"
          className={`check ${point.discussed ? 'on' : ''}`}
          onClick={() => void patch({ discussed: !point.discussed })}
        >
          <Icon name="check" size={14} strokeWidth={2.4} />
        </button>
        <div style={{ minWidth: 0 }}>
          {editing ? (
            <textarea
              autoFocus
              className="textarea ptext-edit"
              rows={2}
              value={text}
              aria-label="Edit point"
              onChange={(e) => setText(e.target.value)}
              onBlur={() => void commitText()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void commitText();
                }
                if (e.key === 'Escape') {
                  setText(point.text);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <div className="ptext" role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
              {point.text}
            </div>
          )}
          <div className="point-meta">
            <ProjectTags ids={point.projectIds} projects={projects} />
            {tagging && (
              <ProjectPicker projects={projects} value={point.projectIds} onChange={(ids) => void patch({ projectIds: ids })} />
            )}
            <button className={`note-btn ${point.notes.length ? 'has' : ''}`} onClick={() => setOpen((o) => !o)}>
              <Icon name="note" size={14} />
              {point.notes.length ? `${point.notes.length} note${point.notes.length > 1 ? 's' : ''}` : 'Add note'}
            </button>
          </div>
        </div>
        <div className="point-actions">
          <select
            className="select kind-select"
            aria-label="Change type"
            value={point.kind}
            onChange={(e) => void patch({ kind: e.target.value as PointKind })}
          >
            {POINT_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_SINGULAR[k]}</option>
            ))}
          </select>
          <button className="icon-btn" aria-label="Edit projects" onClick={() => setTagging((t) => !t)}><Icon name="folder" size={16} /></button>
          <button className="icon-btn danger" aria-label="Delete point" onClick={() => void remove()}><Icon name="trash" size={16} /></button>
        </div>
      </div>
      {open && <NoteThread point={point} onChanged={onChanged} />}
    </div>
  );
}

function Section({
  kind,
  points,
  day,
  projects,
  onChanged,
}: {
  kind: PointKind;
  points: Point[];
  day: DayRecord;
  projects: Project[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const busy = useRef(false);

  const add = async () => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    try {
      await api.addPoint(day.date, kind, text, []);
      setText('');
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      busy.current = false;
    }
  };

  return (
    <section className="card section">
      <div className="section-head">
        <div className={`section-ico ${kind}`}><Icon name={kind} size={18} /></div>
        <h3>{KIND_LABEL[kind]}</h3>
        <span className="n">{points.length}</span>
      </div>
      {points.length === 0 && <div className="muted small" style={{ padding: '2px 20px 10px' }}>Nothing here.</div>}
      {points.map((p) => (
        <PointRow key={p.id} point={p} projects={projects} onChanged={onChanged} />
      ))}
      <div className="add-line">
        <input
          className="input"
          value={text}
          placeholder={`Add ${KIND_SINGULAR[kind].toLowerCase()} point…`}
          aria-label={`Add ${KIND_SINGULAR[kind]} point`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
      </div>
    </section>
  );
}

function MeetingNotes({ day, onChanged }: { day: DayRecord; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState(day.generalNotes);
  const save = async () => {
    if (text === day.generalNotes) return;
    try {
      await api.setGeneralNotes(day.date, text);
      await onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 className="card-title">Meeting notes</h3>
      <div className="muted small">Free-form scratchpad for the standup. Saved when you click away.</div>
      <textarea
        className="textarea"
        rows={9}
        value={text}
        aria-label="Meeting notes"
        placeholder="Anything that doesn't belong to a single point…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save()}
      />
    </div>
  );
}

export function StandupTab({ day, projects, onChanged, onFinalize, finalizing }: StandupTabProps) {
  const total = day.points.length;
  const discussed = day.points.filter((p) => p.discussed).length;
  const fresh = day.entries.filter((e) => day.collatedAt && e.createdAt > day.collatedAt).length;

  return (
    <div className="two-col">
      <div className="board">
        {fresh > 0 && (
          <div className="banner">
            <Icon name="sparkle" size={18} />
            <span><b>{fresh} new stream {fresh === 1 ? 'entry' : 'entries'}</b> since the last collation. Collate again to fold them in; your edits and notes are kept.</span>
          </div>
        )}
        {POINT_KINDS.map((k) => (
          <Section key={k} kind={k} points={day.points.filter((p) => p.kind === k)} day={day} projects={projects} onChanged={onChanged} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, position: 'sticky', top: 0 }}>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="eyebrow">Progress</div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 34, lineHeight: 1 }}>
            {discussed}<span className="muted" style={{ fontSize: 20 }}> / {total} discussed</span>
          </div>
          <div style={{ height: 8, background: 'var(--secondary-08)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: `${total ? (discussed / total) * 100 : 0}%`, height: '100%', background: 'var(--secondary)', transition: 'width .3s' }} />
          </div>
          <button className="btn btn-accent" disabled={finalizing || total === 0} onClick={onFinalize}>
            <Icon name={finalizing ? 'loader' : 'flag'} size={16} className={finalizing ? 'spin' : ''} />
            {finalizing ? 'Summarizing…' : day.status === 'finalized' ? 'Finalize again' : 'Finalize standup'}
          </button>
        </div>
        <MeetingNotes key={day.date} day={day} onChanged={onChanged} />
      </div>
    </div>
  );
}
