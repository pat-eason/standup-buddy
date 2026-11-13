import type { DayMetrics, MetricsReport, ProjectActivity, TrendDirection, WeeklyRecap } from '../types';
import { Icon } from './Icon';
import { fmtShort, parseDate } from './ui';

const TREND_LABEL: Record<TrendDirection, string> = {
  up: 'Trending up',
  down: 'Trending down',
  flat: 'Holding steady',
  insufficient: 'Not enough days to call a trend',
};
const TREND_ICON: Record<TrendDirection, string> = { up: 'trend-up', down: 'trend-down', flat: 'trend-flat', insufficient: 'trend-flat' };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

export function TrendBadge({ trend }: { trend: MetricsReport['trend'] }) {
  const pct = trend.changePct === null ? '' : ` (${signed(Math.round(trend.changePct))}%)`;
  return (
    <span className={`trend trend-${trend.direction}`}>
      <Icon name={TREND_ICON[trend.direction]} size={15} />
      {TREND_LABEL[trend.direction]}
      {pct}
    </span>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  const diff = now - before;
  const tone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  return <span className={`delta delta-${tone}`}>{signed(diff)} vs last week</span>;
}

interface StatProps {
  label: string;
  value: number;
  before: number;
  hint?: string;
}

function Stat({ label, value, before, hint }: StatProps) {
  return (
    <div className="stat card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <Delta now={value} before={before} />
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export function StatCards({ metrics }: { metrics: MetricsReport }) {
  const { totals: t, previous: p } = metrics;
  return (
    <div className="stats">
      <Stat label="Total updates" value={t.updates} before={p.updates} hint={`${t.entries} stream entries`} />
      <Stat label="Open questions" value={t.questions} before={p.questions} />
      <Stat label="Decisions needed" value={t.decisions} before={p.decisions} />
      <Stat label="Active days" value={t.activeDays} before={p.activeDays} hint={`${t.discussed} points discussed`} />
    </div>
  );
}

/** Todos created and completed in the range, with the per-day split in each card's hint. */
export function TodoStats({ metrics }: { metrics: MetricsReport }) {
  const { totals: t, previous: p } = metrics;
  const perDay = (pick: (d: DayMetrics) => number) =>
    metrics.days
      .filter((d) => pick(d) > 0)
      .map((d) => `${dayName(d.date)} ${pick(d)}`)
      .join(' · ');
  return (
    <div className="stats stats-half">
      <Stat label="Todos created" value={t.todosCreated} before={p.todosCreated} hint={perDay((d) => d.todosCreated) || undefined} />
      <Stat label="Todos completed" value={t.todosCompleted} before={p.todosCompleted} hint={perDay((d) => d.todosCompleted) || undefined} />
    </div>
  );
}

function dayName(date: string): string {
  return parseDate(date).toLocaleDateString(undefined, { weekday: 'short' });
}

export function DailyChart({ days, onOpenDay }: { days: DayMetrics[]; onOpenDay: (date: string) => void }) {
  const max = Math.max(1, ...days.map((d) => d.updates));
  return (
    <ol className="daily" aria-label="Updates accomplished per day">
      {days.map((d) => {
        const idle = d.entries + d.updates + d.questions + d.decisions + d.parking === 0;
        const label = `${fmtShort(d.date)}: ${d.updates} updates${d.deltaUpdates === null ? '' : `, ${signed(d.deltaUpdates)} vs previous day`}`;
        return (
          <li key={d.date}>
            <button type="button" className="daily-col" disabled={idle} aria-label={label} onClick={() => onOpenDay(d.date)}>
              <span className="daily-count">{idle ? '–' : d.updates}</span>
              <span className="daily-track">
                <span className="daily-bar" style={{ height: `${(d.updates / max) * 100}%` }} />
              </span>
              <span className="daily-day">{dayName(d.date)}</span>
              {d.deltaUpdates === null || idle ? (
                <span className="delta delta-flat">&nbsp;</span>
              ) : (
                <span className={`delta delta-${d.deltaUpdates > 0 ? 'up' : d.deltaUpdates < 0 ? 'down' : 'flat'}`}>{signed(d.deltaUpdates)}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function ProjectActivityList({ projects }: { projects: ProjectActivity[] }) {
  if (projects.length === 0) {
    return <div className="muted small">No activity recorded for this week.</div>;
  }
  const max = Math.max(...projects.map((p) => p.total));
  return (
    <ul className="proj-list">
      {projects.map((p) => (
        <li key={p.projectId ?? 'untagged'} className="proj-row">
          <div className="row">
            <span className="pdot" style={{ background: p.color }} />
            <b className="proj-name">{p.name}</b>
            <span className="muted small proj-total">{p.total} total</span>
          </div>
          <div className="proj-bar" aria-hidden>
            <span style={{ width: `${(p.total / max) * 100}%`, background: p.color }} />
          </div>
          <div className="small muted">
            {plural(p.updates, 'update', 'updates')} · {plural(p.questions, 'question', 'questions')} · {plural(p.decisions, 'decision', 'decisions')} ·{' '}
            {p.parking} parked · {plural(p.entries, 'entry', 'entries')}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface QuadrantProps {
  tone: 'strength' | 'weakness' | 'opportunity' | 'threat';
  title: string;
  source: string;
  items: string[];
}

function Quadrant({ tone, title, source, items }: QuadrantProps) {
  return (
    <section className={`swot-cell swot-${tone}`}>
      <header>
        <h4>{title}</h4>
        <span className="small muted">{source}</span>
      </header>
      {items.length === 0 ? (
        <p className="small muted">Nothing identified.</p>
      ) : (
        <ul>
          {items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SwotMatrix({ recap }: { recap: WeeklyRecap }) {
  return (
    <div className="swot" role="group" aria-label="SWOT analysis of the week">
      <span className="swot-axis swot-axis-x1">Helpful</span>
      <span className="swot-axis swot-axis-x2">Harmful</span>
      <span className="swot-axis swot-axis-y1">Internal</span>
      <span className="swot-axis swot-axis-y2">External</span>
      <Quadrant tone="strength" title="Strengths" source="Successes" items={recap.successes} />
      <Quadrant tone="weakness" title="Weaknesses" source="Misses" items={recap.misses} />
      <Quadrant tone="opportunity" title="Opportunities" source="Next week" items={recap.opportunities} />
      <Quadrant tone="threat" title="Threats" source="Risks" items={recap.threats} />
    </div>
  );
}
