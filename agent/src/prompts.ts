import { getConfig, type AgentConfig } from './config.ts';

export function userContext(cfg: AgentConfig = getConfig()): string {
  const text = cfg.userContext;
  return text.trim() ? `\n\nAbout the user:\n${text.trim()}` : '';
}

export function extra(label: string, text: string): string {
  return text.trim() ? `\n\n${label}:\n${text.trim()}` : '';
}
