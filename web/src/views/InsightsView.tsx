import { useCallback, useEffect, useRef, useState } from 'react';
import type { WeekReport } from '../types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Markdown } from '../components/Markdown';
import { PageTitle } from '../components/PageTitle';
import { DailyChart, ProjectActivityList, StatCards, SwotMatrix, TodoStats, TrendBadge } from '../components/insights';
import { errMsg, fmtShort, shiftDate, useToast } from '../components/ui';

const DAYS_PER_WEEK = 7;

/** Monday of the week containing `date` (weeks run Monday to Sunday, matching the API). */
function weekStartOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const offset = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return shiftDate(date, -offset);
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; report: WeekReport };

/** Loads the week report for `weekStart`; ignores responses that arrive after the week changed. */
function useWeekReport(weekStart: string) {
  const [state, setState] = useState<{ week: string; load: Load }>({ week: weekStart, load: { status: 'loading' } });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let ignore = false;
    api
      .getWeek(weekStart)
      .then((report) => !ignore && setState({ week: weekStart, load: { status: 'ready', report } }))
      .catch((e) => !ignore && setState({ week: weekStart, load: { status: 'error', message: errMsg(e) } }));
    return () => {
      ignore = true;
    };
  }, [weekStart, attempt]);

  const load: Load = state.week === weekStart ? state.load : { status: 'loading' };
  const replace = useCallback((report: WeekReport) => setState({ week: report.weekStart, load: { status: 'ready', report } }), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, replace, retry };
}

interface InsightsViewProps {
  today: string;
  onOpenDay: (date: string) => void;
}

/** Week-by-week metrics (day-to-day trend, per-project activity) and the LLM weekly recap as a SWOT matrix. */
export function InsightsView({ today, onOpenDay }: InsightsViewProps) {
  const toast = useToast();
  const currentWeek = weekStartOf(today);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const { load, replace, retry } = useWeekReport(weekStart);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);

  const generate = async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    try {
      replace(await api.recapWeek(weekStart));
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const weekEnd = shiftDate(weekStart, DAYS_PER_WEEK - 1);
  const isCurrent = weekStart === currentWeek;

  return (
    <div className="page">
      <div>
        <PageTitle title="Insights" />
        <div className="muted">What got done, where the work went, and how the week is trending.</div>
      </div>

      <div className="row week-nav">
        <button className="icon-btn" aria-label="Previous week" onClick={() => setWeekStart(shiftDate(weekStart, -DAYS_PER_WEEK))}>
          <Icon name="left" size={16} />
        </button>
        <b className="week-label">
          {isCurrent ? 'This week · ' : ''}
          {fmtShort(weekStart)} – {fmtShort(weekEnd)}
        </b>
        <button className="icon-btn" aria-label="Next week" disabled={isCurrent} onClick={() => setWeekStart(shiftDate(weekStart, DAYS_PER_WEEK))}>
          <Icon name="right" size={16} />
        </button>
        {!isCurrent && (
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(currentWeek)}>
            This week
          </button>
        )}
      </div>

      {load.status === 'loading' && (
        <div className="card empty">
          <Icon name="loader" size={22} className="spin" />
        </div>
      )}
      {load.status === 'error' && (
        <div className="card empty">
          <h3>Could not load insights</h3>
          <p style={{ margin: '0 0 16px' }}>{load.message}</p>
          <button className="btn btn-ghost" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {load.status === 'ready' && (
        <WeekContent report={load.report} generating={generating} onGenerate={generate} onOpenDay={onOpenDay} />
      )}
    </div>
  );
}

interface WeekContentProps {
  report: WeekReport;
  generating: boolean;
  onGenerate: () => void;
  onOpenDay: (date: string) => void;
}

function WeekContent({ report, generating, onGenerate, onOpenDay }: WeekContentProps) {
  const { metrics, recap } = report;
  const hasActivity = metrics.totals.activeDays > 0 || metrics.totals.todosCreated + metrics.totals.todosCompleted > 0;

  if (!hasActivity) {
    return (
      <div className="card empty">
        <h3>No standups this week</h3>
        Add notes on the Today page and they will show up here.
      </div>
    );
  }

  return (
    <>
      <StatCards metrics={metrics} />
      <TodoStats metrics={metrics} />

      <section className="card card-pad stack">
        <div className="row between">
          <h3 className="card-title">Day by day</h3>
          <TrendBadge trend={metrics.trend} />
        </div>
        <DailyChart days={metrics.days} onOpenDay={onOpenDay} />
        <div className="small muted">
          Bars are updates accomplished each day; the figure underneath is the change from the day before. The trend compares the second half of the
          active days with the first half.
        </div>
      </section>

      <section className="card card-pad stack">
        <h3 className="card-title">Activity per project</h3>
        <ProjectActivityList projects={metrics.projects} />
      </section>

      <section className="card card-pad stack">
        <div className="row between">
          <h3 className="card-title">
            <Icon name="sparkle" size={18} /> Weekly recap
          </h3>
          <button className="btn btn-accent btn-sm" disabled={generating} onClick={onGenerate}>
            <Icon name={generating ? 'loader' : 'refresh'} size={14} className={generating ? 'spin' : ''} />
            {generating ? 'Writing…' : recap ? 'Regenerate' : 'Generate recap'}
          </button>
        </div>
        {recap ? (
          <>
            <div className="recap-headline">{recap.headline}</div>
            <Markdown text={recap.summary} />
            <SwotMatrix recap={recap} />
            <div className="small muted">Generated {new Date(recap.generatedAt).toLocaleString()}</div>
          </>
        ) : (
          <div className="muted">
            The LLM reads the week's standups and sorts them into successes, misses, opportunities and risks, laid out as a SWOT matrix.
          </div>
        )}
      </section>
    </>
  );
}
