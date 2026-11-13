import { useRef } from 'react';
import type { DayRecord, Project, SuggestedTodo } from '../types';
import { useTodos } from '../hooks/useTodos';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { errMsg, fmtShort, fmtTime, useToast } from '../components/ui';
import { api } from '../api';

function ListBox({ title, items }: { title: string; items: { text: string; owner?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="wrap-box">
      <h4>{title}</h4>
      <ul>
        {items.map((it) => (
          <li key={`${it.text}-${it.owner ?? ''}`}>
            {it.text}
            {it.owner && <span className="owner">{it.owner}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function SuggestedTodos({ day, projects }: { day: DayRecord; projects: Project[] }) {
  const { todos, add } = useTodos();
  const inFlight = useRef(new Set<string>());
  const suggestions = day.finalization?.suggestedTodos ?? [];
  if (suggestions.length === 0) return null;

  const key = (t: SuggestedTodo) => t.title.trim().toLowerCase();
  const isAdded = (t: SuggestedTodo) => todos.some((x) => x.sourceDay === day.date && x.title.toLowerCase() === key(t));

  const quickAdd = async (t: SuggestedTodo) => {
    // Synchronous guard: a fast double-click must not create two todos.
    if (inFlight.current.has(key(t)) || isAdded(t)) return;
    inFlight.current.add(key(t));
    try {
      const project = projects.find((p) => p.name.toLowerCase() === t.project?.trim().toLowerCase());
      await add({
        title: t.title,
        description: t.description ?? '',
        projectId: project?.id ?? null,
        dueDate: t.dueDate && ISO_DATE.test(t.dueDate) ? t.dueDate : null,
        sourceDay: day.date,
      });
    } finally {
      inFlight.current.delete(key(t));
    }
  };

  const pending = suggestions.filter((t) => !isAdded(t));
  return (
    <div className="wrap-box suggested-todos">
      <div className="row">
        <h4>Suggested todos</h4>
        <span className="spacer" />
        {pending.length > 1 && (
          <button className="btn btn-ghost btn-sm" onClick={() => void Promise.all(pending.map(quickAdd))}>
            <Icon name="plus" size={14} /> Add all
          </button>
        )}
      </div>
      <ul className="suggested-list">
        {suggestions.map((t) => {
          const added = isAdded(t);
          return (
            <li key={t.title}>
              <div className="suggested-text">
                <div>{t.title}</div>
                {(t.project || t.dueDate) && (
                  <div className="small muted">{[t.project, t.dueDate && `due ${t.dueDate}`].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" disabled={added} onClick={() => void quickAdd(t)}>
                <Icon name={added ? 'check' : 'plus'} size={14} /> {added ? 'Added' : 'Quick add'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WrapTab({
  day,
  projects,
  finalizing,
  onFinalize,
  onReopen,
}: {
  day: DayRecord;
  projects: Project[];
  finalizing: boolean;
  onFinalize: () => void;
  onReopen: () => void;
}) {
  const toast = useToast();
  const f = day.finalization;

  if (!f) {
    return (
      <div className="card empty">
        <h3>Not finalized yet</h3>
        <p style={{ margin: '0 0 18px' }}>
          After your standup, finalize it. The LLM folds your notes into a summary with decisions, action items and carry-over.
        </p>
        <button className="btn btn-accent" disabled={finalizing || day.points.length === 0} onClick={onFinalize}>
          <Icon name={finalizing ? 'loader' : 'flag'} size={16} className={finalizing ? 'spin' : ''} />
          {finalizing ? 'Summarizing…' : 'Finalize standup'}
        </button>
        {day.points.length === 0 && <div className="small" style={{ marginTop: 10 }}>Collate the day first.</div>}
      </div>
    );
  }

  return (
    <div className="card card-pad wrap" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="row">
        <span className="eyebrow">
          Finalized {day.finalizedAt ? `${fmtShort(day.finalizedAt.slice(0, 10))} · ${fmtTime(day.finalizedAt)}` : ''}
        </span>
        <span className="spacer" />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void api.copyDayMarkdown(day.date).then(() => toast('Copied as Markdown')).catch((e) => toast(errMsg(e), true))}
        >
          <Icon name="copy" size={14} /> Copy Markdown
        </button>
        <button className="btn btn-ghost btn-sm" disabled={finalizing} onClick={onFinalize}>
          <Icon name={finalizing ? 'loader' : 'refresh'} size={14} className={finalizing ? 'spin' : ''} /> Regenerate
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onReopen}>
          <Icon name="lock" size={14} /> Reopen
        </button>
      </div>
      <h2>{f.headline}</h2>
      <Markdown text={f.summary} />
      <div className="wrap-grid">
        <ListBox title="Decisions made" items={f.decisions.map((text) => ({ text }))} />
        <ListBox title="Action items" items={f.actionItems} />
        <ListBox title="Follow-ups" items={f.followUps.map((text) => ({ text }))} />
        <ListBox title="Carry over" items={f.carryOver.map((text) => ({ text }))} />
      </div>
      <SuggestedTodos day={day} projects={projects} />
    </div>
  );
}
