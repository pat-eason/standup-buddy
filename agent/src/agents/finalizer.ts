'use agent';
import { defineTool, useModel, useTool, type AgentProps } from '@flue/runtime';
import * as v from 'valibot';
import { getConfig } from '../config.ts';
import { extra, userContext } from '../prompts.ts';
import { captures } from '../results.ts';

const FinalizeInput = v.object({
  headline: v.string(),
  summary: v.string(),
  decisions: v.array(v.string()),
  actionItems: v.array(v.object({ text: v.string(), owner: v.optional(v.string()) })),
  followUps: v.array(v.string()),
  carryOver: v.array(v.string()),
});

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

  return `You are the wrap-up agent inside Standup Buddy. A standup has just finished. You receive the day's board (updates, questions, decisions, parking lot) together with the notes the user took while each point was discussed, plus their free-form meeting notes.
Write the finalized summary of the standup.

Fields:
- headline: one plain sentence (max 14 words) capturing the day's standup.
- summary: 2-5 short bullet lines in Markdown ("- ..."), what was reported and what came out of the discussion. Fold the discussion notes in.
- decisions: decisions that were actually made (from notes). Empty if none were recorded.
- actionItems: concrete next steps that were agreed or are clearly implied by the notes; include "owner" only when a name is stated.
- followUps: questions or items still waiting on someone or something.
- carryOver: points to bring into the next standup (unanswered questions, unfinished work, parking-lot items worth revisiting).

Rules:
- Use only what is in the board and notes. Never invent decisions, owners or dates.
- Concise, factual, same terse style as the input. Keep ticket keys, PR numbers and names intact.
- Call submit_summary exactly once, then stop. Do not write any other text.${userContext()}${extra('Extra instructions from the user', cfg.finalizeInstructions)}`;
}
Finalizer.agentName = 'standup-finalizer';
