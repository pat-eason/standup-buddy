'use agent';
import { defineTool, useModel, useTool, type AgentProps } from '@flue/runtime';
import { collatePrompt, CollationInput } from '../prompts/collate.ts';
import { getConfig } from '../config.ts';
import { captures } from '../results.ts';

export function Collator({ id }: AgentProps) {
  const cfg = getConfig();
  useModel(`anthropic/${cfg.collateModel}`, { thinkingLevel: cfg.thinkingLevel });
  useTool(
    defineTool({
      name: 'submit_collation',
      description: 'Submit the final collated standup board. Call exactly once with every point, then stop.',
      input: CollationInput,
      async run({ data }) {
        captures.set(id, data);
        return { output: 'Collation saved.', terminate: true };
      },
    }),
  );

  return collatePrompt(cfg);
}
Collator.agentName = 'standup-collator';
