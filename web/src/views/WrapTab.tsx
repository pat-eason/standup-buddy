import type { DayRecord, Project, SuggestedTodo } from '../types';
import { useQuickAddTodo, type QuickAddOptions } from '../hooks/useQuickAddTodo';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { errMsg, fmtShort, fmtTime, useToast } from '../components/ui';
import { api } from '../api';

function AddTodoButton({ text, isAdded, quickAdd }: QuickAdd & { text: string }) {
  const added = isAdded(text);
  return (
    <button
      type="button"
      className={`icon-btn li-add ${added ? 'added' : ''}`}
      disabled={added}
      aria-label={added ? 'Added to todos' : `Add "${text}" as a todo`}
      data-tip={added ? 'Added' : 'Add todo'}
      onClick={() => void quickAdd({ title: text }, { source: 'action_item' })}
    >
      <Icon name={added ? 'check' : 'plus'} size={13} />
    </button>
  );
}

function ListBox({ title, items, todos }: { title: string; items: { text: string; owner?: string }[]; todos?: QuickAdd }) {
  if (items.length === 0) return null;
  return (
    <div className="wrap-box">
      <h4>{title}</h4>
      <ul>
        {items.map((it) => (
          <li key={`${it.text}-${it.owner ?? ''}`}>
            <div className="li-row">
              <span className="li-text">
                {it.text}
                {it.owner && <span className="owner">{it.owner}</span>}
              </span>
              {todos && <AddTodoButton text={it.text} {...todos} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface QuickAdd {
  isAdded: (title: string) => boolean;
  quickAdd: (todo: SuggestedTodo, options?: QuickAddOptions) => Promise<void>;
}

function SuggestedTodos({ suggestions, isAdded, quickAdd }: QuickAdd & { suggestions: SuggestedTodo[] }) {
  if (suggestions.length === 0) return null;
  const pending = suggestions.filter((t) => !isAdded(t.title));
  return (
    <div className="wrap-box suggested-todos">
      <div className="row">
        <h4>Suggested todos</h4>
        <span className="spacer" />
        {pending.length > 1 && (
          <button className="btn btn-ghost btn-sm" onClick={() => void Promise.all(pending.map((t) => quickAdd(t, { showInDrawer: false })))}>
            <Icon name="plus" size={14} /> Add all
          </button>
        )}
      </div>
      <ul className="suggested-list">
        {suggestions.map((t) => {
          const added = isAdded(t.title);
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
  const quick = useQuickAddTodo(day, projects);
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
        <ListBox title="Action items" items={f.actionItems} todos={quick} />
        <ListBox title="Follow-ups" items={f.followUps.map((text) => ({ text }))} />
        <ListBox title="Carry over" items={f.carryOver.map((text) => ({ text }))} />
      </div>
      <SuggestedTodos suggestions={f.suggestedTodos ?? []} {...quick} />
    </div>
  );
}
