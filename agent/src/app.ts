import './provider.ts';
import { init, observe } from '@flue/runtime';
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Collator } from './agents/collator.ts';
import { Finalizer } from './agents/finalizer.ts';
import { NotesAssistant } from './agents/notes-assistant.ts';
import { Recapper } from './agents/recapper.ts';
import { INTERNAL_TOKEN, refreshConfig } from './config.ts';
import { captures } from './results.ts';

const app = new Hono();

// A failed run only rejects with a generic message; the real reason rides the
// settlement event, so keep the latest one per submission for the error response.
const failureReasons = new Map<string, string>();
observe((event: any) => {
  if (event.type !== 'submission_settled' || !event.error) return;
  failureReasons.set(event.submissionId, event.error.meta?.reason ?? event.error.message ?? 'unknown error');
  if (failureReasons.size > 200) failureReasons.delete(failureReasons.keys().next().value as string);
});

function describe(err: unknown): string {
  const submissionId = (err as { submissionId?: string } | null)?.submissionId;
  const reason = submissionId ? failureReasons.get(submissionId) : undefined;
  if (reason?.includes('not configured')) return 'No Anthropic API key configured. Add one in Settings.';
  if (reason) return reason;
  const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
  return (err instanceof Error ? err.message : String(err)) + cause;
}

app.get('/healthz', (c) => c.json({ status: 'ok' }));

// Browser-facing: the notes assistant chat (consumed by @flue/react). nginx only
// proxies /agents/*, so /run/* below is reachable by the API service alone.
app.use('/agents/*', async (c, next) => {
  try {
    await refreshConfig();
  } catch (err) {
    console.error('config refresh failed', err);
  }
  await next();
});
app.route('/agents/notes-assistant', createAgentRouter(NotesAssistant));

// Internal: one-shot structured runs called by the Go API.
const RUNNERS = { collate: Collator, finalize: Finalizer, recap: Recapper } as const;

app.post('/run/:kind', async (c) => {
  if (c.req.header('x-internal-token') !== INTERNAL_TOKEN) return c.json({ error: 'unauthorized' }, 401);
  const kind = c.req.param('kind') as keyof typeof RUNNERS;
  const agent = RUNNERS[kind];
  if (!agent) return c.json({ error: `unknown run kind: ${kind}` }, 404);

  const body = (await c.req.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!body?.id || !body.message) return c.json({ error: 'id and message are required' }, 400);

  try {
    await refreshConfig(true);
    const handle = init(agent, { id: body.id });
    const receipt = await handle.dispatch(body.message);
    const reply = await handle.read(receipt);
    const result = captures.get(body.id);
    if (!result) {
      return c.json({ error: `The model finished without returning a result. ${reply.text ?? ''}`.trim() }, 502);
    }
    return c.json({ result });
  } catch (err) {
    const message = describe(err);
    console.error(`run ${kind} failed:`, message);
    return c.json({ error: message }, 502);
  } finally {
    captures.delete(body.id);
  }
});

export default app;
