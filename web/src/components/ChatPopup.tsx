import { useFlueAgent, type FlueConversationMessage, type FlueConversationPart } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { ChatThread } from '../types';
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

type ToolPart = Extract<FlueConversationPart, { type: 'dynamic-tool' }>;

function toolText(part: ToolPart): string {
  const input = part.input as { query?: string; date?: string } | undefined;
  const base = TOOL_LABEL[part.toolName] ?? part.toolName;
  const detail = input?.query ?? input?.date;
  return detail ? `${base}: ${detail}` : base;
}

function ToolChip({ part }: { part: ToolPart }) {
  const running = part.state === 'input-available';
  return (
    <span className={`tool-line ${running ? 'running' : ''}`}>
      <Icon name={running ? 'loader' : part.state === 'output-error' ? 'x' : 'search'} size={12} />
      {toolText(part)}
    </span>
  );
}

function MessageBubble({ message }: { message: FlueConversationMessage }) {
  const tools = message.parts.filter((p): p is ToolPart => p.type === 'dynamic-tool');
  const text = message.parts
    .filter((p): p is Extract<FlueConversationPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
  if (message.role === 'user') return <div className="bubble user">{text}</div>;
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
          <MessageBubble key={m.id} message={m} />
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

export function ChatPopup({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(true);

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
        setHasKey(settings.apiKeySource !== 'none');
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
            <Markdown text={'**No API key yet.** Add your Anthropic API key under **Settings**, then reopen this chat.'} />
          </div>
        </div>
      ) : threadId ? (
        <Conversation key={threadId} threadId={threadId} onFirstMessage={nameThread} />
      ) : (
        <div className="chat-body" />
      )}
    </div>
  );
}
