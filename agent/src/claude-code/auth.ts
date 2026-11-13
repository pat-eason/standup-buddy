/**
 * Links the Claude Code login from the UI. `claude auth login` prints a sign-in URL and then waits on
 * stdin for the code the sign-in page shows, so a web page can drive it with plain pipes (no terminal):
 *   start()  → spawn the CLI, return the URL
 *   submit() → write the pasted code to its stdin, wait for it to finish, confirm with `auth status`
 * Credentials end up in $HOME/.claude of this container, which is a Docker volume. Neither the URL nor
 * the code is ever logged.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEAN_ENV } from './env.ts';

export class AuthError extends Error {}

/** The native claude binary that ships with the SDK for this platform. */
function claudeBinary(): string {
  // The package's `exports` hides package.json, so resolve its entry file and take the directory.
  const sdkDir = dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')));
  const scope = dirname(sdkDir);
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = readdirSync(scope)
    .filter((d) => d.startsWith('claude-agent-sdk-') && d.includes(process.platform) && d.includes(process.arch))
    .sort((a, b) => a.length - b.length); // prefer the glibc build over -musl
  for (const dir of candidates) {
    const path = join(scope, dir, exe);
    if (existsSync(path)) return path;
  }
  throw new AuthError('The Claude Code binary for this platform was not found.');
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const tail = (text: string) => text.replace(ANSI, '').trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);

function execClaude(args: string[], timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(claudeBinary(), args, { env: { ...CLEAN_ENV, BROWSER: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    p.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, out });
    });
  });
}

export interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
  loginExpiresAt?: string | null;
}

export async function status(): Promise<AuthStatus> {
  const { out } = await execClaude(['auth', 'status', '--json']);
  try {
    const raw = JSON.parse(out) as Record<string, unknown>;
    const pick = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
    return {
      loggedIn: raw.loggedIn === true,
      authMethod: pick('authMethod'),
      email: pick('email'),
      orgName: pick('orgName'),
      subscriptionType: pick('subscriptionType'),
      loginExpiresAt: (raw.loginExpiresAt as string | null | undefined) ?? null,
    };
  } catch {
    return { loggedIn: false };
  }
}

let pending: { proc: ChildProcess; output: () => string; timer: NodeJS.Timeout } | null = null;

function clearPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.proc.kill();
  pending = null;
}

/** Starts a sign-in and returns the URL the user must open. */
export async function start(): Promise<{ url: string }> {
  clearPending();
  const proc = spawn(claudeBinary(), ['auth', 'login', '--claudeai'], {
    env: { ...CLEAN_ENV, BROWSER: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (d) => (output += d));
  proc.stderr.on('data', (d) => (output += d));
  proc.stdin.on('error', () => undefined);
  const timer = setTimeout(clearPending, 10 * 60_000); // an abandoned sign-in expires
  pending = { proc, output: () => output, timer };

  const url = await new Promise<string>((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const m = output.replace(ANSI, '').match(/https:\/\/\S+authorize\S*/);
      if (m) {
        clearInterval(tick);
        resolve(m[0]);
      } else if (proc.exitCode !== null || Date.now() - started > 20_000) {
        clearInterval(tick);
        reject(new AuthError(`Could not start the sign-in: ${tail(output) || 'no response from Claude Code'}`));
      }
    }, 100);
  }).catch((err) => {
    clearPending();
    throw err;
  });
  return { url };
}

/**
 * Finishes the sign-in with the code the user pasted. A wrong code is rejected within a second ("Invalid
 * code…") and the CLI keeps waiting, so the sign-in stays open and the user can paste again.
 */
export async function submit(rawCode: string): Promise<AuthStatus> {
  const code = rawCode.replace(/\s+/g, '');
  if (!code || code.length > 500) throw new AuthError('Paste the code shown on the sign-in page.');
  const current = pending;
  if (!current || current.proc.exitCode !== null) {
    pending = null;
    throw new AuthError('There is no sign-in in progress. Click “Set up Claude Code subscription” again.');
  }
  const before = current.output().length;
  current.proc.stdin?.write(code + '\n');

  const started = Date.now();
  let rejected = '';
  while (current.proc.exitCode === null && Date.now() - started < 30_000) {
    await new Promise((r) => setTimeout(r, 150));
    const fresh = current.output().slice(before).replace(ANSI, '');
    if (/invalid|incorrect|expired|failed|error/i.test(fresh)) {
      rejected = tail(fresh);
      break;
    }
  }
  if (rejected) throw new AuthError(rejected); // leave the sign-in open for another try

  const output = current.output().slice(before);
  clearPending();
  const s = await status();
  if (s.loggedIn) return s;
  throw new AuthError(`Claude Code did not confirm the sign-in: ${tail(output) || 'no response'}. Click Set up to try again.`);
}

export async function logout(): Promise<void> {
  clearPending();
  await execClaude(['auth', 'logout']);
}
