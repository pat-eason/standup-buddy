import * as v from 'valibot';
import { apiGet, type AgentConfig } from './config.ts';

/**
 * The notes assistant's read-only tools, defined once. The Flue agent (API key)
 * and the Claude Code runner (subscription) both wrap these.
 */
type Obj = v.ObjectSchema<v.ObjectEntries, undefined>;

export interface NotesTool<S extends Obj = Obj> {
  name: string;
  description: string;
  input: S;
  enabled: (cfg: AgentConfig) => boolean;
  run: (data: v.InferOutput<S>, cfg: AgentConfig) => Promise<string>;
}

/** Keeps each tool's `run` typed from its own schema while the list stays uniform. */
function notesTool<S extends Obj>(t: NotesTool<S>): NotesTool {
  return t as unknown as NotesTool;
}

function limitFor(cfg: AgentConfig): number {
  return Math.max(3, Math.min(40, cfg.searchResultLimit));
}

const searchNotes = notesTool({
  name: 'search_notes',
  description:
    "Keyword search across the user's stream-of-consciousness entries, standup points, discussion notes, meeting notes and finalized summaries. Use short keywords (ticket ids, names, topics). Returns the best matches with their day. Optional date range (YYYY-MM-DD) and project filter.",
  input: v.object({
    query: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    project: v.optional(v.string()),
    limit: v.optional(v.number()),
  }),
  enabled: (cfg) => cfg.toolSearchNotes,
  async run(data, cfg) {
    const qs = new URLSearchParams({ q: data.query, limit: String(Math.min(data.limit ?? limitFor(cfg), 40)) });
    if (data.from) qs.set('from', data.from);
    if (data.to) qs.set('to', data.to);
    if (data.project) qs.set('project', data.project);
    const hits = await apiGet<unknown[]>(`/api/search?${qs}`);
    return JSON.stringify({ count: hits.length, hits });
  },
});

const getDay = notesTool({
  name: 'get_day',
  description:
    'Fetch one day in full: its stream entries, collated points (with discussion notes), meeting notes and finalized summary. Date format YYYY-MM-DD.',
  input: v.object({ date: v.string() }),
  enabled: (cfg) => cfg.toolGetDay,
  async run(data) {
    const [day, projects] = await Promise.all([
      apiGet<any>(`/api/days/${encodeURIComponent(data.date)}`),
      apiGet<{ id: number; name: string }[]>('/api/projects'),
    ]);
    const names = new Map(projects.map((p) => [p.id, p.name]));
    const nm = (ids: number[]) => ids.map((i) => names.get(i)).filter(Boolean);
    return JSON.stringify({
      date: day.date,
      status: day.status,
      stream: day.entries.map((e: any) => ({ time: e.createdAt, text: e.text, projects: nm(e.projectIds) })),
      points: day.points.map((p: any) => ({
        kind: p.kind,
        text: p.text,
        group: p.group,
        why: p.rationale,
        discussed: p.discussed,
        projects: nm(p.projectIds),
        notes: p.notes.map((n: any) => n.text),
      })),
      meetingNotes: day.generalNotes,
      finalSummary: day.finalization,
    });
  },
});

const listDays = notesTool({
  name: 'list_days',
  description:
    'List recorded standup days, newest first, with status, counts and headline. Use to find which days exist before fetching one.',
  input: v.object({ limit: v.optional(v.number()) }),
  enabled: (cfg) => cfg.toolListDays,
  async run(data) {
    const days = await apiGet<unknown[]>('/api/days');
    return JSON.stringify(days.slice(0, Math.min(data.limit ?? 30, 120)));
  },
});

const listProjects = notesTool({
  name: 'list_projects',
  description: "List the user's projects (names usable as a search filter).",
  input: v.object({}),
  enabled: (cfg) => cfg.toolListProjects,
  async run() {
    const projects = await apiGet<{ name: string; archived: boolean }[]>('/api/projects');
    return JSON.stringify(projects.map((p) => ({ name: p.name, archived: p.archived })));
  },
});

export const NOTES_TOOLS: NotesTool[] = [searchNotes, getDay, listDays, listProjects];
