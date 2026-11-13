import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { MODEL_OPTIONS, type AppInfo, type AppSettings, type SettingsPatch, type ThinkingLevel } from '../types';
import { Icon } from '../components/Icon';
import { Toggle, errMsg, useToast } from '../components/ui';
import { api } from '../api';
import { PREF_FRIENDLY_DATES, usePreference } from '../hooks/usePreference';
import { PageTitle } from '../components/PageTitle';

const THINKING: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];

function Field({ name, hint, children }: { name: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div>
        <span className="name" style={{ fontWeight: 600 }}>{name}</span>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ModelSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const known = MODEL_OPTIONS.some((m) => m.id === value);
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      {!known && <option value={value}>{value}</option>}
    </select>
  );
}

function KeyCard({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; text: string }>({ state: 'idle', text: '' });

  const save = async () => {
    try {
      onSettings(await api.setApiKey(key));
      setKey('');
      toast('API key saved');
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  const remove = async () => {
    try {
      onSettings(await api.setApiKey(null));
      setTest({ state: 'idle', text: '' });
    } catch (e) {
      toast(errMsg(e), true);
    }
  };
  const runTest = async () => {
    setTest({ state: 'running', text: 'Contacting the model…' });
    try {
      const reply = await api.testConnection();
      setTest({ state: 'ok', text: `Connected. Model replied: “${reply.slice(0, 40)}”` });
    } catch (e) {
      setTest({ state: 'fail', text: errMsg(e) });
    }
  };

  const sourceText =
    settings.apiKeySource === 'stored'
      ? `Saved encrypted in Postgres (AES-256-GCM): ${settings.apiKeyHint}`
      : settings.apiKeySource === 'env'
        ? `Using ANTHROPIC_API_KEY from the server environment: ${settings.apiKeyHint}`
        : 'No key configured.';

  return (
    <div className="card card-pad">
      <h3 className="card-title"><Icon name="lock" size={20} /> Anthropic API key</h3>
      <Field name="Key" hint={sourceText}>
        <div className="row">
          <input className="input" type="password" autoComplete="off" value={key} placeholder="sk-ant-…" aria-label="Anthropic API key" onChange={(e) => setKey(e.target.value)} />
          <button className="btn btn-dark" disabled={!key.trim()} onClick={() => void save()}>Save</button>
          {settings.apiKeySource === 'stored' && <button className="btn btn-ghost" onClick={() => void remove()}>Remove</button>}
        </div>
      </Field>
      <Field name="Connection" hint="Sends a tiny request to the Anthropic API with this key.">
        <div className="row">
          <button className="btn btn-ghost" disabled={test.state === 'running'} onClick={() => void runTest()}>
            <Icon name={test.state === 'running' ? 'loader' : 'refresh'} size={15} className={test.state === 'running' ? 'spin' : ''} /> Test connection
          </button>
          <span className={test.state === 'ok' ? 'status-ok' : test.state === 'fail' ? 'status-bad' : 'muted small'}>{test.text}</span>
        </div>
      </Field>
    </div>
  );
}

function PromptField({ value, onSave, label, placeholder }: { value: string; onSave: (v: string) => void; label: string; placeholder: string }) {
  const [text, setText] = useState(value);
  return (
    <textarea
      className="textarea"
      rows={3}
      value={text}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)}
    />
  );
}

function CodeBlock({ code }: { code: string }) {
  const toast = useToast();
  return (
    <div className="md" style={{ position: 'relative' }}>
      <pre style={{ margin: '6px 0 0' }}><code>{code}</code></pre>
      <button
        className="btn btn-ghost"
        style={{ position: 'absolute', top: 12, right: 6, padding: '2px 8px' }}
        aria-label="Copy"
        onClick={() => void navigator.clipboard.writeText(code).then(() => toast('Copied')).catch(() => toast('Copy failed', true))}
      >
        <Icon name="copy" size={14} />
      </button>
    </div>
  );
}

const MCP_TOOLS: [string, string][] = [
  ['get_day_status', 'Status and counts for a day (default today)'],
  ['add_stream_entry', 'Add a stream entry'],
  ['add_standup_item', 'Add an update, question, decision or parking-lot item'],
  ['collate_day', 'Trigger a collation'],
  ['add_item_note', 'Add a note to a standup item'],
  ['finalize_standup', 'Finalize a standup'],
  ['add_todo / list_todos / delete_todo', 'Manage todos'],
  ['get_stream_items / get_standup_items / get_standup_summaries', 'Read by day or date range'],
  ['list_projects', 'Project ids for tagging'],
];

const MCP_PROMPTS = [
  "What's the status of my standup today?",
  "Add to my stream: finished the migration review, waiting on Sam for sign-off. Tag it to the Platform project.",
  "Add a decision item to today's standup: we ship the API change behind a flag first.",
  "Collate today's stream into standup points, then show me the questions and decisions.",
  "Add a note to the standup item about the migration: Sam will review by Thursday.",
  "Finalize today's standup and list the action items.",
  "Show my open todos and delete the one about the old dashboard.",
  "What did I work on last week? Read my stream items for Monday to Friday.",
];

function McpCard() {
  const url = `${window.location.origin}/mcp`;
  const claudeCode = `claude mcp add --transport http standup-buddy ${url}`;
  const json = JSON.stringify({ mcpServers: { 'standup-buddy': { type: 'http', url } } }, null, 2);
  const desktop = JSON.stringify({ mcpServers: { 'standup-buddy': { command: 'npx', args: ['-y', 'mcp-remote', url] } } }, null, 2);
  return (
    <div className="card card-pad">
      <h3 className="card-title"><Icon name="tool" size={20} /> MCP server</h3>
      <div className="hint" style={{ margin: '6px 0 10px' }}>
        Lets an AI client read and update your standups. It is built into the <code>api</code> service, so it starts with Docker Compose, and is served at:
      </div>
      <CodeBlock code={url} />
      <Field name="Claude Code" hint="Run once in a terminal.">
        <CodeBlock code={claudeCode} />
      </Field>
      <Field name="Cursor, VS Code and other HTTP clients" hint="Add to the client's MCP config (for example .cursor/mcp.json or .mcp.json).">
        <CodeBlock code={json} />
      </Field>
      <Field name="Claude Desktop" hint="Add to claude_desktop_config.json (needs Node.js for the mcp-remote bridge), then restart.">
        <CodeBlock code={desktop} />
      </Field>
      <Field name="Optional token" hint="Set MCP_TOKEN in .env and restart to require a bearer token. Claude Code: add --header &quot;Authorization: Bearer <token>&quot;; JSON: add a headers object.">
        <span className="muted small">Unset by default; the app only listens on localhost.</span>
      </Field>
      <Field name="Time zone" hint='"Today" is computed by the server. Set TZ in .env (for example America/New_York) to match your browser, then run docker compose up -d.'>
        <span className="muted small">Defaults to UTC.</span>
      </Field>
      <Field name="Sample prompts" hint="Ask in plain language; the client picks the tools.">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          {MCP_PROMPTS.map((q) => <li key={q}>{q}</li>)}
        </ul>
      </Field>
      <Field name="Tools" hint="What the server exposes.">
        <dl className="kv">
          {MCP_TOOLS.map(([n, d]) => (
            <Fragment key={n}><dt><code>{n}</code></dt><dd>{d}</dd></Fragment>
          ))}
        </dl>
      </Field>
    </div>
  );
}

export function SettingsView() {
  const toast = useToast();
  const [friendlyDates, setFriendlyDates] = usePreference(PREF_FRIENDLY_DATES, true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let ignore = false;
    Promise.all([api.getSettings(), api.getAppInfo()])
      .then(([s, i]) => {
        if (ignore) return;
        setSettings(s);
        setInfo(i);
      })
      .catch((e) => toast(errMsg(e), true));
    return () => {
      ignore = true;
    };
  }, [toast]);

  if (!settings) return <div className="page muted">Loading…</div>;

  const patch = async (p: SettingsPatch) => {
    try {
      setSettings(await api.saveSettings(p));
    } catch (e) {
      toast(errMsg(e), true);
    }
  };

  const tools: { key: 'toolSearchNotes' | 'toolGetDay' | 'toolListDays' | 'toolListProjects'; name: string; hint: string }[] = [
    { key: 'toolSearchNotes', name: 'search_notes', hint: 'Keyword search over stream entries, points, notes and summaries' },
    { key: 'toolGetDay', name: 'get_day', hint: 'Read one full day, including notes and the final summary' },
    { key: 'toolListDays', name: 'list_days', hint: 'Browse which days are recorded' },
    { key: 'toolListProjects', name: 'list_projects', hint: 'Look up project names for filtering' },
  ];

  return (
    <div className="page">
      <div>
        <PageTitle title="Settings" />
        <div className="muted">Keys, models and the notes agent's tools.</div>
      </div>
      <div className="settings-grid">
        <KeyCard settings={settings} onSettings={setSettings} />

        <div className="card card-pad">
          <h3 className="card-title"><Icon name="sparkle" size={20} /> Models</h3>
          <Field name="Collation" hint="Turns the stream into standup points">
            <ModelSelect label="Collation model" value={settings.collateModel} onChange={(v) => void patch({ collateModel: v })} />
          </Field>
          <Field name="Finalize" hint="Summarizes the standup and your notes">
            <ModelSelect label="Finalize model" value={settings.finalizeModel} onChange={(v) => void patch({ finalizeModel: v })} />
          </Field>
          <Field name="Notes agent" hint="The chat popup">
            <ModelSelect label="Notes agent model" value={settings.chatModel} onChange={(v) => void patch({ chatModel: v })} />
          </Field>
          <Field name="Thinking level" hint="Higher is slower and costs more tokens">
            <select className="select" aria-label="Thinking level" value={settings.thinkingLevel} onChange={(e) => void patch({ thinkingLevel: e.target.value as ThinkingLevel })}>
              {THINKING.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        <div className="card card-pad">
          <h3 className="card-title"><Icon name="todo" size={20} /> Todos</h3>
          <Field name="Friendly due dates" hint='Show "tomorrow" or "Friday" instead of a date. Hover a friendly date to see the full one.'>
            <Toggle on={friendlyDates} onChange={setFriendlyDates} />
          </Field>
        </div>

        <div className="card card-pad">
          <h3 className="card-title"><Icon name="tool" size={20} /> Agent tools</h3>
          {tools.map((t) => (
            <Field key={t.key} name={t.name} hint={t.hint}>
              <Toggle on={settings[t.key]} onChange={(v) => void patch({ [t.key]: v })} />
            </Field>
          ))}
          <Field name="Search results" hint="Default number of matches per search_notes call">
            <input
              className="input"
              style={{ width: 100 }}
              type="number"
              min={3}
              max={40}
              aria-label="Search results limit"
              defaultValue={settings.searchResultLimit}
              onBlur={(e) => void patch({ searchResultLimit: Math.max(3, Math.min(40, Number(e.target.value) || 12)) })}
            />
          </Field>
        </div>

        <McpCard />

        <div className="card card-pad">
          <h3 className="card-title"><Icon name="edit" size={20} /> Prompts</h3>
          <Field name="About you" hint="Role, team, vocabulary. Added to every agent.">
            <PromptField label="About you" value={settings.userContext} onSave={(v) => void patch({ userContext: v })} placeholder="e.g. Backend engineer on the payments team. Tickets look like ABC-123." />
          </Field>
          <Field name="Collation style" hint="Extra rules for how points are written">
            <PromptField label="Collation instructions" value={settings.collateInstructions} onSave={(v) => void patch({ collateInstructions: v })} placeholder="e.g. Always lead updates with the ticket key." />
          </Field>
          <Field name="Finalize style" hint="Extra rules for the summary">
            <PromptField label="Finalize instructions" value={settings.finalizeInstructions} onSave={(v) => void patch({ finalizeInstructions: v })} placeholder="e.g. Keep the summary to three bullets." />
          </Field>
        </div>

        <div className="card card-pad">
          <h3 className="card-title"><Icon name="folder" size={20} /> Data</h3>
          {info && (
            <dl className="kv" style={{ margin: '14px 0' }}>
              <dt>Database</dt><dd>{info.postgres}</dd>
              <dt>Size</dt><dd>{(info.dbSizeBytes / 1024 / 1024).toFixed(1)} MB · schema v{info.schemaVersion}</dd>
              <dt>Agent runtime</dt><dd>Flue {info.flue}</dd>
            </dl>
          )}
          <div className="row">
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (window.confirm('Delete all chat conversations with the notes agent? Standups are not affected.'))
                  void api.clearThreads().then(() => toast('Chats cleared')).catch((e) => toast(errMsg(e), true));
              }}
            >
              <Icon name="trash" size={15} /> Clear chats
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
