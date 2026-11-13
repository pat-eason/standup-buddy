/**
 * Runs the agents on the user's Claude Code subscription through the Claude Agent SDK.
 * This process must run on the host (not in Docker): the login lives in the macOS Keychain.
 *
 * Every option below was chosen from a spike, see the README "Claude Code subscription" notes:
 * - strictMcpConfig: without it the user's own MCP servers connect mid-run and inject ~100k tokens.
 * - a scrubbed env: ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / CLAUDE_CODE_* in the shell would silently
 *   switch which account (or gateway) the call is billed to.
 * - never CLAUDE_CODE_SIMPLE (bare mode): it skips the stored login.
 */
import { createSdkMcpServer, query, tool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { toJsonSchema } from '@valibot/to-json-schema';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';
import { z } from 'zod';
import type { AgentConfig } from '../config.ts';
import { CLEAN_ENV } from './env.ts';
import { NOTES_TOOLS } from '../notes-tools.ts';
import { collatePrompt, CollationInput } from '../prompts/collate.ts';
import { finalizePrompt, FinalizeInput } from '../prompts/finalize.ts';
import { notesPrompt } from '../prompts/notes.ts';
import { recapPrompt, RecapInput } from '../prompts/recap.ts';

export class RunnerError extends Error {}

// An empty directory so no project files, CLAUDE.md or memory are ever picked up.
const WORKDIR = mkdtempSync(join(tmpdir(), 'standup-buddy-claude-'));

type Kind = 'collate' | 'finalize' | 'recap';

const SPECS: Record<
  Kind,
  { schema: v.GenericSchema; prompt: (cfg: AgentConfig) => string; model: (cfg: AgentConfig) => string }
> = {
  collate: { schema: CollationInput, prompt: collatePrompt, model: (c) => c.collateModel },
  finalize: { schema: FinalizeInput, prompt: finalizePrompt, model: (c) => c.finalizeModel },
  recap: { schema: RecapInput, prompt: recapPrompt, model: (c) => c.finalizeModel },
};

// The shared prompts tell a Flue agent to call a named submit tool; here the result is the SDK's
// built-in structured output, so point the model at it.
const STRUCTURED_NOTE =
  '\n\nDeliver the final result with the StructuredOutput tool. Wherever these instructions say to call submit_collation, submit_summary or submit_recap, call StructuredOutput instead.';

const EFFORT = { minimal: 'low', low: 'low', medium: 'medium', high: 'high' } as const;

function baseOptions(cfg: AgentConfig, model: string): Options {
  const opts: Options = {
    model,
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    cwd: WORKDIR,
    env: CLEAN_ENV,
  };
  if (cfg.thinkingLevel === 'off') opts.thinking = { type: 'disabled' };
  else opts.effort = EFFORT[cfg.thinkingLevel] ?? 'low';
  return opts;
}

/** Turns SDK/CLI failures into something the user can act on. */
function friendly(text: string): string {
  if (/not logged in|\/login|authentication|oauth|credentials/i.test(text)) {
    return 'Claude Code is not signed in. Open Settings → Model provider and click “Set up Claude Code subscription”.';
  }
  if (/rate.?limit|usage limit|limit reached|overloaded/i.test(text)) {
    return `Your Claude subscription hit a usage limit: ${text.slice(0, 200)}`;
  }
  return text.slice(0, 500);
}

function fail(err: unknown): never {
  if (err instanceof RunnerError) throw err;
  throw new RunnerError(friendly(err instanceof Error ? err.message : String(err)));
}

/** One-shot structured run (collate, finalize, recap). Returns the validated result. */
export async function runStructured(kind: Kind, cfg: AgentConfig, message: string): Promise<unknown> {
  const spec = SPECS[kind];
  const { $schema: _ignored, ...schema } = toJsonSchema(spec.schema as never, { errorMode: 'ignore' }) as Record<string, unknown>;
  try {
    for await (const m of query({
      prompt: message,
      options: {
        ...baseOptions(cfg, spec.model(cfg)),
        systemPrompt: spec.prompt(cfg) + STRUCTURED_NOTE,
        outputFormat: { type: 'json_schema', schema },
        maxTurns: 4,
      },
    })) {
      if (m.type !== 'result') continue;
      if (m.subtype !== 'success' || m.is_error) {
        throw new RunnerError(friendly(('result' in m && typeof m.result === 'string' && m.result) || `run ended: ${m.subtype}`));
      }
      const parsed = v.safeParse(spec.schema, m.structured_output);
      if (!parsed.success) throw new RunnerError('The model returned a result that did not match the expected shape.');
      return parsed.output;
    }
  } catch (err) {
    fail(err);
  }
  throw new RunnerError('The model finished without returning a result.');
}

/** Tiny request used by Settings → Test connection and `--check`. */
export async function ping(cfg: AgentConfig): Promise<string> {
  try {
    for await (const m of query({
      prompt: 'Reply with the single word: ready',
      options: { ...baseOptions({ ...cfg, thinkingLevel: 'off' }, cfg.chatModel), maxTurns: 1 },
    })) {
      if (m.type !== 'result') continue;
      if (m.subtype !== 'success' || m.is_error) throw new RunnerError(friendly(('result' in m && m.result) || m.subtype));
      return m.result.trim();
    }
  } catch (err) {
    fail(err);
  }
  throw new RunnerError('No reply from Claude Code.');
}

// ------------------------------------------------------------------ chat

const ZOD_SHAPES: Record<string, z.ZodRawShape> = {
  search_notes: {
    query: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    project: z.string().optional(),
    limit: z.number().optional(),
  },
  get_day: { date: z.string() },
  list_days: { limit: z.number().optional() },
  list_projects: {},
};

const TOOL_PREFIX = 'mcp__notes__';

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name?: string; input?: unknown; state: 'running' | 'done' | 'error' }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

function transcript(history: ChatTurn[], message: string): string {
  if (history.length === 0) return message;
  const lines = history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n\n');
  return `Conversation so far:\n\n${lines}\n\nThe user's new message:\n${message}`;
}

/** Streams one assistant reply. Aborting the signal stops the run. */
export async function streamChat(
  cfg: AgentConfig,
  history: ChatTurn[],
  message: string,
  emit: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const enabled = NOTES_TOOLS.filter((t) => t.enabled(cfg));
  const server = createSdkMcpServer({
    name: 'notes',
    tools: enabled.map((t) =>
      tool(t.name, t.description, ZOD_SHAPES[t.name] ?? {}, async (args) => {
        try {
          return { content: [{ type: 'text' as const, text: await t.run(args, cfg) }] };
        } catch (err) {
          return { isError: true, content: [{ type: 'text' as const, text: `Tool failed: ${err instanceof Error ? err.message : String(err)}` }] };
        }
      }),
    ),
  });
  const abortController = new AbortController();
  signal.addEventListener('abort', () => abortController.abort(), { once: true });
  try {
    for await (const m of query({
      prompt: transcript(history, message),
      options: {
        ...baseOptions(cfg, cfg.chatModel),
        systemPrompt: notesPrompt(cfg),
        mcpServers: { notes: server },
        allowedTools: enabled.map((t) => `${TOOL_PREFIX}${t.name}`),
        includePartialMessages: true,
        maxTurns: 12,
        abortController,
      },
    })) {
      if (m.type === 'stream_event' && m.parent_tool_use_id === null) {
        const e = m.event;
        if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') emit({ type: 'text', delta: e.delta.text });
      } else if (m.type === 'assistant') {
        for (const b of m.message.content) {
          if (b.type === 'tool_use') {
            emit({ type: 'tool', id: b.id, name: b.name.replace(TOOL_PREFIX, ''), input: b.input, state: 'running' });
          }
        }
      } else if (m.type === 'user' && Array.isArray(m.message.content)) {
        for (const b of m.message.content) {
          if (b.type === 'tool_result') emit({ type: 'tool', id: b.tool_use_id, state: b.is_error ? 'error' : 'done' });
        }
      } else if (m.type === 'result' && (m.subtype !== 'success' || m.is_error)) {
        throw new RunnerError(friendly(('result' in m && m.result) || `run ended: ${m.subtype}`));
      }
    }
    emit({ type: 'done' });
  } catch (err) {
    if (signal.aborted) return;
    emit({ type: 'error', message: err instanceof RunnerError ? err.message : friendly(err instanceof Error ? err.message : String(err)) });
  }
}
