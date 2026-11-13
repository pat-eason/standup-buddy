export type PointKind = 'update' | 'question' | 'decision' | 'parking';
export const POINT_KINDS: PointKind[] = ['update', 'question', 'decision', 'parking'];

export const KIND_LABEL: Record<PointKind, string> = {
  update: 'Updates',
  question: 'Outstanding questions',
  decision: 'Decision points',
  parking: 'Parking lot',
};

export const KIND_SINGULAR: Record<PointKind, string> = {
  update: 'Update',
  question: 'Question',
  decision: 'Decision',
  parking: 'Parking lot',
};

export type DayStatus = 'open' | 'collated' | 'finalized';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface Project {
  id: number;
  name: string;
  color: string;
  archived: boolean;
}

export interface StreamEntry {
  id: number;
  day: string;
  text: string;
  createdAt: string;
  projectIds: number[];
}

export interface PointNote {
  id: number;
  pointId: number;
  text: string;
  createdAt: string;
}

export interface Point {
  id: number;
  day: string;
  kind: PointKind;
  text: string;
  position: number;
  origin: 'ai' | 'manual';
  edited: boolean;
  discussed: boolean;
  group: string;
  rationale: string;
  projectIds: number[];
  sourceEntryIds: number[];
  notes: PointNote[];
}

export interface ActionItem {
  text: string;
  owner?: string;
}

export interface SuggestedTodo {
  title: string;
  description?: string;
  project?: string;
  dueDate?: string;
}

export type TodoSource = 'manual' | 'action_item' | 'suggested' | 'mcp';

/** 1 is not urgent, 5 is incredibly urgent. */
export type Urgency = 1 | 2 | 3 | 4 | 5;

export interface Todo {
  id: number;
  title: string;
  description: string;
  projectId: number | null;
  dueDate: string | null;
  done: boolean;
  completedAt: string | null;
  urgency: Urgency;
  source: TodoSource;
  sourceDay: string | null;
  createdAt: string;
}

export interface TodoInput {
  title: string;
  description?: string;
  projectId?: number | null;
  dueDate?: string | null;
  urgency?: Urgency;
  sourceDay?: string | null;
  source?: TodoSource;
}

export interface TodoPatch {
  title?: string;
  description?: string;
  projectId?: number;
  clearProject?: boolean;
  dueDate?: string;
  clearDueDate?: boolean;
  urgency?: Urgency;
  done?: boolean;
}

export interface Finalization {
  headline: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  followUps: string[];
  carryOver: string[];
  suggestedTodos: SuggestedTodo[];
}

export interface DayRecord {
  date: string;
  status: DayStatus;
  generalNotes: string;
  collatedAt: string | null;
  finalizedAt: string | null;
  finalization: Finalization | null;
  entries: StreamEntry[];
  points: Point[];
}

export interface DaySummary {
  date: string;
  status: DayStatus;
  entryCount: number;
  pointCount: number;
  noteCount: number;
  headline: string | null;
}

export interface SearchHit {
  day: string;
  type: 'stream' | 'point' | 'note' | 'general_notes' | 'summary';
  kind?: PointKind;
  text: string;
  projects: string[];
  at: string;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type LlmProvider = 'api_key' | 'claude_code';

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name?: string; input?: unknown; state?: 'running' | 'done' | 'error' };

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  parts: ChatPart[];
  createdAt: string;
}

/** One NDJSON line streamed from POST /api/threads/{id}/chat. */
export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name?: string; input?: unknown; state: 'running' | 'done' | 'error' }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ClaudeStatus {
  /** False when the runner service itself is not reachable. */
  runner: boolean;
  loggedIn: boolean;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
  message?: string;
}

export interface AppSettings {
  llmProvider: LlmProvider;
  apiKeySource: 'stored' | 'env' | 'none';
  apiKeyHint: string | null;
  collateModel: string;
  finalizeModel: string;
  chatModel: string;
  thinkingLevel: ThinkingLevel;
  userContext: string;
  collateInstructions: string;
  finalizeInstructions: string;
  toolSearchNotes: boolean;
  toolGetDay: boolean;
  toolListDays: boolean;
  toolListProjects: boolean;
  searchResultLimit: number;
}

export type SettingsPatch = Partial<Omit<AppSettings, 'apiKeySource' | 'apiKeyHint'>>;

export interface AppInfo {
  postgres: string;
  dbSizeBytes: number;
  schemaVersion: number;
  flue: string;
}

export const MODEL_OPTIONS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (default, fast)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
];

export type TrendDirection = 'up' | 'down' | 'flat' | 'insufficient';

export interface Totals {
  entries: number;
  updates: number;
  questions: number;
  decisions: number;
  parking: number;
  discussed: number;
  notes: number;
  activeDays: number;
  todosCreated: number;
  todosCompleted: number;
}

export interface DayMetrics {
  date: string;
  entries: number;
  updates: number;
  questions: number;
  decisions: number;
  parking: number;
  discussed: number;
  notes: number;
  todosCreated: number;
  todosCompleted: number;
  deltaUpdates: number | null;
}

export interface ProjectActivity {
  projectId: number | null;
  name: string;
  color: string;
  entries: number;
  updates: number;
  questions: number;
  decisions: number;
  parking: number;
  total: number;
}

export interface MetricsReport {
  from: string;
  to: string;
  days: DayMetrics[];
  totals: Totals;
  previous: Totals;
  trend: { direction: TrendDirection; changePct: number | null };
  projects: ProjectActivity[];
}

export interface WeeklyRecap {
  headline: string;
  summary: string;
  successes: string[];
  misses: string[];
  opportunities: string[];
  threats: string[];
  generatedAt: string;
}

export interface WeekReport {
  weekStart: string;
  weekEnd: string;
  metrics: MetricsReport;
  recap: WeeklyRecap | null;
}
