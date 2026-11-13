import { useFlueAgent, type FlueConversationMessage, type FlueConversationPart } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamChat } from '../api';
import type { ChatMessage, ChatPart, ChatThread, LlmProvider } from '../types';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { errMsg, useToast } from './ui';

const SUGGESTIONS = [
  'What did I work on last week?',
  'Which questions are still unanswered?',
  'What decisions did we make recently?',
];

const TOOL_LABEL: Record<string, string> = {
  search_notes: 'Searching notes',
  get_day: 'Reading a day',
  list_days: 'Browsing days',
  list_projects: 'Checking projects',
};

/** The shape both chat transports (Flue and the Claude Code stream) are normalised to. */
interface ToolPart {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  state: 'running' | 'done' | 'error';
}
interface BubbleData {
  role: 'user' | 'assistant';
  text: string;
  tools: ToolPart[];
}

function toolText(part: ToolPart): string {
  const input = part.input as { query?: string; date?: string } | undefined;
  const base = TOOL_LABEL[part.toolName] ?? part.toolName;
  const detail = input?.query ?? input?.date;
  return detail ? `${base}: ${detail}` : base;
}

function ToolChip({ part }: { part: ToolPart }) {
  const running = part.state === 'running';
  return (
    <span className={`tool-line ${running ? 'running' : ''}`}>
      <Icon name={running ? 'loader' : part.state === 'error' ? 'x' : 'search'} size={12} />
      {toolText(part)}
    </span>
  );
}

function fromFlue(message: FlueConversationMessage): BubbleData {
  const tools = message.parts
    .filter((p): p is Extract<FlueConversationPart, { type: 'dynamic-tool' }> => p.type === 'dynamic-tool')
    .map((p): ToolPart => ({
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      input: p.input,
      state: p.state === 'input-available' ? 'running' : p.state === 'output-error' ? 'error' : 'done',
    }));
  const text = message.parts
    .filter((p): p is Extract<FlueConversationPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
  return { role: message.role === 'user' ? 'user' : 'assistant', text, tools };
}

function fromParts(role: 'user' | 'assistant', parts: ChatPart[]): BubbleData {
  const tools: ToolPart[] = [];
  const texts: string[] = [];
  for (const p of parts) {
    if (p.type === 'text') texts.push(p.text);
    else tools.push({ toolCallId: p.id, toolName: p.name ?? 'tool', input: p.input, state: p.state ?? 'done' });
  }
  return { role, text: texts.join('\n\n'), tools };
}

function Bubble({ data }: { data: BubbleData }) {
  const { tools, text } = data;
  if (data.role === 'user') return <div className="bubble user">{text}</div>;
  if (tools.length === 0 && !text) return null;
  return (
    <div className="bubble assistant">
      {tools.length > 0 && (
        <div>
          {tools.map((t) => (
            <ToolChip key={t.toolCallId} part={t} />
          ))}
        </div>
      )}
      {text && <Markdown text={text} />}
    </div>
  );
}

function Conversation({ threadId, onFirstMessage }: { threadId: string; onFirstMessage: (id: string, text: string) => void }) {
  const toast = useToast();
  const client = useMemo(() => createFlueClient({ url: `${window.location.origin}/agents/notes-assistant/${threadId}` }), [threadId]);
  const agent = useFlueAgent({ client });
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  const visible = agent.messages.filter((m) => m.display === 'visible' && (m.role === 'user' || m.role === 'assistant'));
  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const lastIsUser = visible.length > 0 && visible[visible.length - 1].role === 'user';

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [agent.messages]);

  const send = async (override?: string) => {
    const content = (override ?? text).trim();
    if (!content || sendingRef.current || busy) return;
    sendingRef.current = true;
    setText('');
    try {
      if (visible.length === 0) onFirstMessage(threadId, content);
      await agent.sendMessage(content);
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <>
      <div className="chat-body" ref={bodyRef}>
        {visible.length === 0 && !busy && (
          <div className="suggest">
            <div className="muted small" style={{ marginBottom: 2 }}>Search and ask questions across every standup you've recorded.</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => void send(s)}>{s}</button>
            ))}
          </div>
        )}
        {visible.map((m) => (
          <Bubble key={m.id} data={fromFlue(m)} />
        ))}
        {busy && lastIsUser && (
          <div className="bubble assistant"><span className="typing"><i /><i /><i /></span></div>
        )}
        {agent.status === 'error' && agent.error && (
          <div className="bubble assistant" style={{ color: 'var(--accent-strong)' }}>Something went wrong: {agent.error.message}</div>
        )}
      </div>
      <div className="chat-foot">
        <textarea
          className="textarea"
          rows={1}
          value={text}
          aria-label="Message"
          placeholder="Ask about your notes…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button className="send" aria-label="Stop" onClick={() => void client.abort().catch(() => undefined)}><Icon name="x" size={18} /></button>
        ) : (
          <button className="send" aria-label="Send" disabled={!text.trim()} onClick={() => void send()}><Icon name="send" size={18} /></button>
        )}
      </div>
    </>
  );
}

/** Chat on the Claude Code subscription: history lives in the API, replies stream as NDJSON. */
function SubscriptionConversation({ threadId, onFirstMessage }: { threadId: string; onFirstMessage: (id: string, text: string) => void }) {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [reply, setReply] = useState<BubbleData | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

  useEffect(() => {
    let ignore = false;
    api.listChatMessages(threadId).then((m) => !ignore && setMessages(m)).catch((e) => toast(errMsg(e), true));
    return () => {
      ignore = true;
      abortRef.current?.abort();
    };
  }, [threadId, toast]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, reply, pending]);

  const send = async (override?: string) => {
    const content = (override ?? text).trim();
    if (!content || busy || messages === null) return;
    setText('');
    setError('');
    setPending(content);
    setReply({ role: 'assistant', text: '', tools: [] });
    if (messages.length === 0) onFirstMessage(threadId, content);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamChat(
        threadId,
        content,
        (e) => {
          if (e.type === 'error') setError(e.message);
          else if (e.type === 'text') setReply((r) => (r ? { ...r, text: r.text + e.delta } : r));
          else if (e.type === 'tool') {
            setReply((r) => {
              if (!r) return r;
              const known = r.tools.some((t) => t.toolCallId === e.id);
              const tools = known
                ? r.tools.map((t) => (t.toolCallId === e.id ? { ...t, state: e.state } : t))
                : [...r.tools, { toolCallId: e.id, toolName: e.name ?? 'tool', input: e.input, state: e.state }];
              return { ...r, tools };
            });
          }
        },
        ac.signal,
      );
    } catch (e) {
      if (!ac.signal.aborted) setError(errMsg(e));
    } finally {
      abortRef.current = null;
      // The API stored both sides; reload so the stored copy replaces the streamed one.
      try {
        setMessages(await api.listChatMessages(threadId));
      } catch {
        /* keep what is on screen */
      }
      setPending(null);
      setReply(null);
    }
  };

  const shown = messages ?? [];
  return (
    <>
      <div className="chat-body" ref={bodyRef}>
        {shown.length === 0 && !busy && messages !== null && (
          <div className="suggest">
            <div className="muted small" style={{ marginBottom: 2 }}>Search and ask questions across every standup you've recorded.</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => void send(s)}>{s}</button>
            ))}
          </div>
        )}
        {shown.map((m) => (
          <Bubble key={m.id} data={fromParts(m.role, m.parts)} />
        ))}
        {pending !== null && <div className="bubble user">{pending}</div>}
        {reply && (reply.text || reply.tools.length > 0 ? (
          <Bubble data={reply} />
        ) : !error ? (
          <div className="bubble assistant"><span className="typing"><i /><i /><i /></span></div>
        ) : null)}
        {error && <div className="bubble assistant" style={{ color: 'var(--accent-strong)' }}>Something went wrong: {error}</div>}
      </div>
      <div className="chat-foot">
        <textarea
          className="textarea"
          rows={1}
          value={text}
          aria-label="Message"
          placeholder="Ask about your notes…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button className="send" aria-label="Stop" onClick={() => abortRef.current?.abort()}><Icon name="x" size={18} /></button>
        ) : (
          <button className="send" aria-label="Send" disabled={!text.trim()} onClick={() => void send()}><Icon name="send" size={18} /></button>
        )}
      </div>
    </>
  );
}

export function ChatPopup({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [provider, setProvider] = useState<LlmProvider>('api_key');

  const loadThreads = useCallback(async () => {
    const list = await api.listThreads();
    setThreads(list);
    return list;
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.all([api.listThreads(), api.getSettings()])
      .then(([list, settings]) => {
        if (ignore) return;
        setProvider(settings.llmProvider);
        setHasKey(settings.llmProvider === 'claude_code' || settings.apiKeySource !== 'none');
        setThreads(list);
        setThreadId(list[0]?.id ?? null);
        setReady(true);
      })
      .catch((e) => toast(errMsg(e), true));
    return () => {
      ignore = true;
    };
  }, [toast]);

  const newThread = async () => {
    try {
      const t = await api.createThread();
      setThreads((prev) => [t, ...prev]);
      setThreadId(t.id);
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  const removeThread = async () => {
    if (!threadId) return;
    try {
      await api.deleteThread(threadId);
      const list = await loadThreads();
      setThreadId(list[0]?.id ?? null);
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  const nameThread = useCallback(
    (id: string, text: string) => {
      const title = text.length > 46 ? `${text.slice(0, 45)}…` : text;
      api.renameThread(id, title).then(loadThreads).catch(() => undefined);
    },
    [loadThreads],
  );

  // A thread is created lazily so opening the popup never leaves empty conversations behind.
  const ensureThread = useCallback(async () => {
    const t = await api.createThread();
    setThreads((prev) => [t, ...prev]);
    setThreadId(t.id);
  }, []);

  useEffect(() => {
    if (ready && threadId === null) void ensureThread().catch((e) => toast(errMsg(e), true));
  }, [ready, threadId, ensureThread, toast]);

  return (
    <div className="chat" role="dialog" aria-label="Ask your notes">
      <div className="chat-head">
        <h4>Ask your notes</h4>
        <span className="spacer" />
        {threads.length > 1 && (
          <select className="select" aria-label="Conversation" value={threadId ?? ''} onChange={(e) => setThreadId(e.target.value)}>
            {threads.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        )}
        <button className="icon-btn" aria-label="New conversation" title="New conversation" onClick={() => void newThread()}><Icon name="plus" size={17} /></button>
        {threadId && <button className="icon-btn" aria-label="Delete conversation" title="Delete conversation" onClick={() => void removeThread()}><Icon name="trash" size={16} /></button>}
        <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={17} /></button>
      </div>
      {!hasKey ? (
        <div className="chat-body">
          <div className="bubble assistant">
            <Markdown text={'**No API key yet.** Add your Anthropic API key under **Settings** (or switch to the Claude Code subscription), then reopen this chat.'} />
          </div>
        </div>
      ) : threadId ? (
        provider === 'claude_code' ? (
          <SubscriptionConversation key={threadId} threadId={threadId} onFirstMessage={nameThread} />
        ) : (
          <Conversation key={threadId} threadId={threadId} onFirstMessage={nameThread} />
        )
      ) : (
        <div className="chat-body" />
      )}
    </div>
  );
}
