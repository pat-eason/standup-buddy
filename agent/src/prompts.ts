import { getConfig } from './config.ts';

export function userContext(): string {
  const { userContext } = getConfig();
  return userContext.trim() ? `\n\nAbout the user:\n${userContext.trim()}` : '';
}

export function extra(label: string, text: string): string {
  return text.trim() ? `\n\n${label}:\n${text.trim()}` : '';
}
