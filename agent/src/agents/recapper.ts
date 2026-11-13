'use agent';
import { defineTool, useModel, useTool, type AgentProps } from '@flue/runtime';
import { recapPrompt, RecapInput } from '../prompts/recap.ts';
import { getConfig } from '../config.ts';
import { captures } from '../results.ts';

export function Recapper({ id }: AgentProps) {
  const cfg = getConfig();
  useModel(`anthropic/${cfg.finalizeModel}`, { thinkingLevel: cfg.thinkingLevel });
  useTool(
    defineTool({
      name: 'submit_recap',
      description: 'Submit the weekly recap. Call exactly once, then stop.',
      input: RecapInput,
      async run({ data }) {
        captures.set(id, data);
        return { output: 'Recap saved.', terminate: true };
      },
    }),
  );

  return recapPrompt(cfg);
}
Recapper.agentName = 'standup-recapper';
