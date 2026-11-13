/**
 * Claude Code runner: a small HTTP service the Go API calls when the LLM provider is
 * "Claude Code subscription". It runs as the `claude-runner` compose service; the login lives in its volume
 * and is linked from Settings (see auth.ts).
 * It is stateless: the Go API sends the settings and (for chat) the history with every request.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentConfig } from '../config.ts';
import * as auth from './auth.ts';
import { ping, RunnerError, runStructured, streamChat, type ChatTurn } from './sdk.ts';

const PORT = Number(process.env.SUBSCRIPTION_PORT ?? 3100);
const HOST = process.env.SUBSCRIPTION_HOST ?? '127.0.0.1';
const TOKEN = process.env.INTERNAL_TOKEN ?? 'dev-internal-token';

const DEFAULT_CONFIG: AgentConfig = {
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

function withDefaults(raw: unknown): AgentConfig {
  return { ...DEFAULT_CONFIG, ...(raw && typeof raw === 'object' ? (raw as Partial<AgentConfig>) : {}), apiKey: '' };
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4 << 20) throw new RunnerError('request body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new RunnerError('invalid JSON body');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { status: 'ok', provider: 'claude-code' });
  if (req.headers['x-internal-token'] !== TOKEN) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });

  try {
    const body = await readJson(req);

    if (url.pathname === '/auth/status') return send(res, 200, await auth.status());
    if (url.pathname === '/auth/login') return send(res, 200, await auth.start());
    if (url.pathname === '/auth/code') return send(res, 200, await auth.submit(String(body.code ?? '')));
    if (url.pathname === '/auth/logout') {
      await auth.logout();
      return send(res, 200, await auth.status());
    }

    const cfg = withDefaults(body.config);

    if (url.pathname === '/test') return send(res, 200, { reply: await ping(cfg) });

    const run = url.pathname.match(/^\/run\/(collate|finalize|recap)$/);
    if (run) {
      if (typeof body.message !== 'string' || !body.message) return send(res, 400, { error: 'message is required' });
      const started = Date.now();
      const result = await runStructured(run[1] as 'collate' | 'finalize' | 'recap', cfg, body.message);
      console.log(JSON.stringify({ msg: 'run', kind: run[1], id: body.id, durationMs: Date.now() - started }));
      return send(res, 200, { result });
    }

    if (url.pathname === '/chat') {
      if (typeof body.message !== 'string' || !body.message.trim()) return send(res, 400, { error: 'message is required' });
      const history: ChatTurn[] = Array.isArray(body.history) ? body.history : [];
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      await streamChat(cfg, history, body.message, (e) => res.write(JSON.stringify(e) + '\n'), ac.signal);
      return res.end();
    }
    return send(res, 404, { error: 'not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('request failed:', message);
    if (!res.headersSent) send(res, err instanceof RunnerError || err instanceof auth.AuthError ? 502 : 500, { error: message });
    else res.end();
  }
}

if (process.argv.includes('--check')) {
  ping(DEFAULT_CONFIG).then(
    (reply) => {
      console.log(`OK: Claude Code replied "${reply}" on your subscription.`);
    },
    (err) => {
      console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    },
  );
} else {
  createServer((req, res) => void handle(req, res)).listen(PORT, HOST, () => {
    console.log(`[standup-buddy] Claude Code runner listening on http://${HOST}:${PORT}`);
  });
}
