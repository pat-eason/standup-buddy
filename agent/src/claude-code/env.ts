/**
 * The environment every Claude Code process gets. ANTHROPIC_* and CLAUDE_CODE_* are dropped on purpose:
 * a key or gateway in the container's environment must not change which account is billed.
 */
const KEEP_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM'];

export const CLEAN_ENV: Record<string, string> = Object.fromEntries(
  KEEP_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k] as string]] : [])),
);
