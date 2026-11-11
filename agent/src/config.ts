/**
 * Settings (models, tool toggles, prompts, API key) live in the Go API's database.
 * Agent functions must render synchronously, so the latest config is cached here
 * and refreshed before every request that can start an agent run.
 */
export interface AgentConfig {
  apiKey: string;
  collateModel: string;
  finalizeModel: string;
  chatModel: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  userContext: string;
  collateInstructions: string;
  finalizeInstructions: string;
  toolSearchNotes: boolean;
  toolGetDay: boolean;
  toolListDays: boolean;
  toolListProjects: boolean;
  searchResultLimit: number;
}

const API_URL = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
export const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? 'dev-internal-token';
const TTL_MS = 2000;

let current: AgentConfig = {
  apiKey: '',
  collateModel: 'claude-haiku-5-5',
  finalizeModel: 'claude-haiku-5-5',
  chatModel: 'claude-haiku-5-5',
  thinkingLevel: 'low',
  userContext: '',
  collateInstructions: '',
  finalizeInstructions: '',
  toolSearchNotes: true,
  toolGetDay: true,
  toolListDays: true,
  toolListProjects: true,
  searchResultLimit: 12,
};
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

export function getConfig(): AgentConfig {
  return current;
}

export async function refreshConfig(force = false): Promise<void> {
  if (!force && Date.now() - fetchedAt < TTL_MS) return;
  inflight ??= (async () => {
    const res = await fetch(`${API_URL}/internal/config`, {
      headers: { 'x-internal-token': INTERNAL_TOKEN },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
    current = (await res.json()) as AgentConfig;
    fetchedAt = Date.now();
    // The provider resolves credentials from the environment on each model call.
    if (current.apiKey) process.env.ANTHROPIC_API_KEY = current.apiKey;
    else delete process.env.ANTHROPIC_API_KEY;
  })().finally(() => {
    inflight = null;
  });
  await inflight;
}

/** Read from the Go API (used by the notes assistant's tools). */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return (await res.json()) as T;
}
