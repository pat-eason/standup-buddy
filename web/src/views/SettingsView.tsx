import { useEffect, useState, type ReactNode } from 'react';
import { MODEL_OPTIONS, type AppInfo, type AppSettings, type SettingsPatch, type ThinkingLevel } from '../types';
import { Icon } from '../components/Icon';
import { Toggle, errMsg, useToast } from '../components/ui';
import { api } from '../api';
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

export function SettingsView() {
  const toast = useToast();
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
