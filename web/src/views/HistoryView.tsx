import { useEffect, useState } from 'react';
import type { DaySummary, SearchHit } from '../types';
import { Icon } from '../components/Icon';
import { errMsg, fmtShort, useToast } from '../components/ui';
import { api } from '../api';

const TYPE_LABEL: Record<SearchHit['type'], string> = {
  stream: 'Stream',
  point: 'Point',
  note: 'Note',
  general_notes: 'Meeting notes',
  summary: 'Summary',
};

function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0) return <>{text}</>;
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

export function HistoryView({ days, onOpen }: { days: DaySummary[]; onOpen: (date: string) => void }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let ignore = false;
    const t = setTimeout(() => {
      api
        .searchNotes(q)
        .then((h) => !ignore && setHits(h))
        .catch((e) => toast(errMsg(e), true));
    }, 220);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [query, toast]);

  return (
    <div className="page">
      <div>
        <h1 style={{ fontSize: 38 }}>History</h1>
        <div className="muted">Every standup, stored by day.</div>
      </div>
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          style={{ paddingLeft: 40, height: 46, borderRadius: 16 }}
          placeholder="Search stream entries, points and notes…"
          aria-label="Search notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span style={{ position: 'absolute', left: 14, top: 13, color: 'var(--secondary-60)' }}><Icon name="search" size={19} /></span>
      </div>

      {hits ? (
        <div className="card day-list">
          {hits.length === 0 && <div className="empty"><h3>No matches</h3>Try fewer or different keywords.</div>}
          {hits.map((h) => (
            <button key={`${h.day}-${h.type}-${h.at}-${h.text.slice(0, 24)}`} className="hit" onClick={() => onOpen(h.day)}>
              <div className="row small muted" style={{ marginBottom: 3 }}>
                <b style={{ color: 'var(--secondary)' }}>{fmtShort(h.day)}</b>
                <span className="badge open">{TYPE_LABEL[h.type]}{h.kind ? ` · ${h.kind}` : ''}</span>
                {h.projects.filter(Boolean).map((p) => <span key={p} className="chip">{p}</span>)}
              </div>
              <Highlight text={h.text} query={query} />
            </button>
          ))}
        </div>
      ) : days.length === 0 ? (
        <div className="card empty"><h3>No days recorded yet</h3>Your standups will appear here.</div>
      ) : (
        <div className="card day-list">
          {days.map((d) => (
            <button key={d.date} className="day-row" onClick={() => onOpen(d.date)}>
              <span className="d">{fmtShort(d.date)}</span>
              <span>
                <span className="hl">{d.headline ?? `${d.entryCount} stream ${d.entryCount === 1 ? 'entry' : 'entries'}`}</span>
                <span className="muted small"> · {d.pointCount} points · {d.noteCount} notes</span>
              </span>
              <span className={`badge ${d.status}`}>{d.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
