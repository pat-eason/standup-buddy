'use agent';
import { defineTool, useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { apiGet, getConfig } from '../config.ts';
import { userContext } from '../prompts.ts';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function NotesAssistant() {
  const cfg = getConfig();
  useModel(`anthropic/${cfg.chatModel}`, { thinkingLevel: cfg.thinkingLevel });
  const limit = Math.max(3, Math.min(40, cfg.searchResultLimit));

  if (cfg.toolSearchNotes) {
    useTool(
      defineTool({
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
        async run({ data }) {
          const qs = new URLSearchParams({ q: data.query, limit: String(Math.min(data.limit ?? limit, 40)) });
          if (data.from) qs.set('from', data.from);
          if (data.to) qs.set('to', data.to);
          if (data.project) qs.set('project', data.project);
          const hits = await apiGet<unknown[]>(`/api/search?${qs}`);
          return { output: JSON.stringify({ count: hits.length, hits }) };
        },
      }),
    );
  }

  if (cfg.toolGetDay) {
    useTool(
      defineTool({
        name: 'get_day',
        description:
          'Fetch one day in full: its stream entries, collated points (with discussion notes), meeting notes and finalized summary. Date format YYYY-MM-DD.',
        input: v.object({ date: v.string() }),
        async run({ data }) {
          const [day, projects] = await Promise.all([
            apiGet<any>(`/api/days/${encodeURIComponent(data.date)}`),
            apiGet<{ id: number; name: string }[]>('/api/projects'),
          ]);
          const names = new Map(projects.map((p) => [p.id, p.name]));
          const nm = (ids: number[]) => ids.map((i) => names.get(i)).filter(Boolean);
          return {
            output: JSON.stringify({
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
            }),
          };
        },
      }),
    );
  }

  if (cfg.toolListDays) {
    useTool(
      defineTool({
        name: 'list_days',
        description:
          'List recorded standup days, newest first, with status, counts and headline. Use to find which days exist before fetching one.',
        input: v.object({ limit: v.optional(v.number()) }),
        async run({ data }) {
          const days = await apiGet<unknown[]>('/api/days');
          return { output: JSON.stringify(days.slice(0, Math.min(data.limit ?? 30, 120))) };
        },
      }),
    );
  }

  if (cfg.toolListProjects) {
    useTool(
      defineTool({
        name: 'list_projects',
        description: "List the user's projects (names usable as a search filter).",
        input: v.object({}),
        async run() {
          const projects = await apiGet<{ name: string; archived: boolean }[]>('/api/projects');
          return { output: JSON.stringify(projects.map((p) => ({ name: p.name, archived: p.archived }))) };
        },
      }),
    );
  }

  return `You are the notes assistant inside Standup Buddy. You help the user search and reason over their own standup records: daily stream-of-consciousness entries, collated standup points, notes taken during standups and finalized summaries.
Today is ${today()}.

How to work:
- Ground every answer in the records. Use the tools to look things up; do not guess from memory.
- Search with short keywords, try synonyms if the first search is thin, then fetch a full day when you need context.
- Cite the day (YYYY-MM-DD) for each fact so the user can find it.
- If the records do not contain the answer, say so plainly and suggest what to search for.
- Be concise: short paragraphs or bullets. Use the user's own terms.${userContext()}`;
}
NotesAssistant.agentName = 'notes-assistant';
