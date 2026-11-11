import type { DayRecord } from '../types';
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

export function WrapTab({
  day,
  finalizing,
  onFinalize,
  onReopen,
}: {
  day: DayRecord;
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
    </div>
  );
}
