'use agent';
import { defineTool, useModel, useTool } from '@flue/runtime';
import { getConfig } from '../config.ts';
import { NOTES_TOOLS } from '../notes-tools.ts';
import { notesPrompt } from '../prompts/notes.ts';

export function NotesAssistant() {
  const cfg = getConfig();
  useModel(`anthropic/${cfg.chatModel}`, { thinkingLevel: cfg.thinkingLevel });

  for (const t of NOTES_TOOLS) {
    if (!t.enabled(cfg)) continue;
    useTool(
      defineTool({
        name: t.name,
        description: t.description,
        input: t.input,
        async run({ data }) {
          return { output: await t.run(data, getConfig()) };
        },
      }),
    );
  }

  return notesPrompt(cfg);
}
NotesAssistant.agentName = 'notes-assistant';
