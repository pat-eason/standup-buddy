import type {
  AppInfo,
  AppSettings,
  ChatEvent,
  ChatMessage,
  ChatThread,
  ClaudeStatus,
  DayRecord,
  DaySummary,
  PointKind,
  Project,
  SearchHit,
  SettingsPatch,
  Todo,
  TodoInput,
  TodoPatch,
  WeekReport,
} from './types';

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body (e.g. a proxy page) */
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(message);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  listDays: () => request<DaySummary[]>('GET', '/days'),
  getDay: (date: string) => request<DayRecord>('GET', `/days/${date}`),
  searchNotes: (query: string) => request<SearchHit[]>('GET', `/search?q=${enc(query)}&limit=40`),

  addEntry: (date: string, text: string, projectIds: number[]) =>
    request<DayRecord>('POST', `/days/${date}/entries`, { text, projectIds }),
  updateEntry: (id: number, text: string, projectIds: number[]) =>
    request<void>('PATCH', `/entries/${id}`, { text, projectIds }),
  deleteEntry: (id: number) => request<void>('DELETE', `/entries/${id}`),

  collate: (date: string) => request<DayRecord>('POST', `/days/${date}/collate`),
  finalize: (date: string) => request<DayRecord>('POST', `/days/${date}/finalize`),
  reopenDay: (date: string) => request<DayRecord>('POST', `/days/${date}/reopen`),

  addPoint: (date: string, kind: PointKind, text: string, projectIds: number[]) =>
    request<void>('POST', `/days/${date}/points`, { kind, text, projectIds }),
  updatePoint: (
    id: number,
    patch: { text?: string; kind?: PointKind; projectIds?: number[]; discussed?: boolean; group?: string; rationale?: string },
  ) => request<void>('PATCH', `/points/${id}`, patch),
  deletePoint: (id: number) => request<void>('DELETE', `/points/${id}`),
  addNote: (pointId: number, text: string) => request<void>('POST', `/points/${pointId}/notes`, { text }),
  deleteNote: (id: number) => request<void>('DELETE', `/notes/${id}`),
  setGeneralNotes: (date: string, text: string) => request<void>('PUT', `/days/${date}/notes`, { text }),
  async copyDayMarkdown(date: string) {
    const res = await fetch(`/api/days/${date}/markdown`);
    if (!res.ok) throw new ApiError('Could not export the day');
    await navigator.clipboard.writeText(await res.text());
  },

  getWeek: (date: string) => request<WeekReport>('GET', `/weeks/${date}`),
  recapWeek: (date: string) => request<WeekReport>('POST', `/weeks/${date}/recap`),

  listProjects: () => request<Project[]>('GET', '/projects'),
  createProject: (name: string, color?: string) => request<Project>('POST', '/projects', { name, color }),
  updateProject: (id: number, patch: { name?: string; color?: string; archived?: boolean }) =>
    request<Project>('PATCH', `/projects/${id}`, patch),
  deleteProject: (id: number) => request<void>('DELETE', `/projects/${id}`),

  listThreads: () => request<ChatThread[]>('GET', '/threads'),
  createThread: () => request<ChatThread>('POST', '/threads'),
  renameThread: (id: string, title: string) => request<void>('PATCH', `/threads/${id}`, { title }),
  deleteThread: (id: string) => request<void>('DELETE', `/threads/${id}`),
  listChatMessages: (id: string) => request<ChatMessage[]>('GET', `/threads/${id}/messages`),
  clearThreads: () => request<void>('DELETE', '/threads'),

  listTodos: () => request<Todo[]>('GET', '/todos'),
  createTodo: (input: TodoInput) => request<Todo>('POST', '/todos', input),
  updateTodo: (id: number, patch: TodoPatch) => request<Todo>('PATCH', `/todos/${id}`, patch),
  deleteTodo: (id: number) => request<void>('DELETE', `/todos/${id}`),

  getSettings: () => request<AppSettings>('GET', '/settings'),
  saveSettings: (patch: SettingsPatch) => request<AppSettings>('PATCH', '/settings', patch),
  setApiKey: (key: string | null) => request<AppSettings>('PUT', '/settings/api-key', { key: key ?? '' }),
  claudeStatus: () => request<ClaudeStatus>('GET', '/claude/status'),
  claudeLogin: () => request<{ url: string }>('POST', '/claude/login').then((r) => r.url),
  claudeCode: (code: string) => request<ClaudeStatus>('POST', '/claude/login/code', { code }),
  claudeLogout: () => request<ClaudeStatus>('POST', '/claude/logout'),
  testConnection: () => request<{ reply: string }>('POST', '/settings/test').then((r) => r.reply),
  getAppInfo: () => request<AppInfo>('GET', '/info'),
};

/** Sends a message on the Claude Code subscription and reads the reply as it streams in. */
export async function streamChat(threadId: string, content: string, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/threads/${enc(threadId)}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as ChatEvent);
    }
    if (done) break;
  }
}
