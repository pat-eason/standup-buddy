'use agent';
import { defineTool, useModel, useTool, type AgentProps } from '@flue/runtime';
import { finalizePrompt, FinalizeInput } from '../prompts/finalize.ts';
import { getConfig } from '../config.ts';
import { captures } from '../results.ts';

export function Finalizer({ id }: AgentProps) {
  const cfg = getConfig();
  useModel(`anthropic/${cfg.finalizeModel}`, { thinkingLevel: cfg.thinkingLevel });
  useTool(
    defineTool({
      name: 'submit_summary',
      description: 'Submit the finalized standup summary. Call exactly once, then stop.',
      input: FinalizeInput,
      async run({ data }) {
        captures.set(id, data);
        return { output: 'Summary saved.', terminate: true };
      },
    }),
  );

  return finalizePrompt(cfg);
}
Finalizer.agentName = 'standup-finalizer';
