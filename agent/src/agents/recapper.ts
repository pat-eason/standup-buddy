'use agent';
import { defineTool, useModel, useTool, type AgentProps } from '@flue/runtime';
import * as v from 'valibot';
import { getConfig } from '../config.ts';
import { userContext } from '../prompts.ts';
import { captures } from '../results.ts';

const RecapInput = v.object({
  headline: v.string(),
  summary: v.string(),
  successes: v.array(v.string()),
  misses: v.array(v.string()),
  opportunities: v.array(v.string()),
  threats: v.array(v.string()),
});

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

  return `You are the weekly recap agent inside Standup Buddy. You receive one week of standups (finalized summaries, or the raw board for days never finalized) plus metrics and per-project activity, with the previous week's numbers in brackets.
Write a weekly recap that the user will review as a SWOT matrix.

Fields:
- headline: one plain sentence (max 14 words) capturing the week.
- summary: 3-6 short bullet lines in Markdown ("- ..."): what the week was about, the arc from start to end, and how it compared with the previous week's numbers.
- successes (Strengths): things that went well or shipped. Concrete, 2-6 items.
- misses (Weaknesses): things that slipped, stalled, stayed blocked, were carried over repeatedly, or went unanswered. 0-6 items.
- opportunities: openings to act on next week: unblocked work, follow-ups worth pushing, patterns worth repeating, parking-lot items that deserve a slot. 2-6 items.
- threats: external or upcoming risks to the plan: dependencies on others, open decisions that could stall work, deadlines, unresolved questions. 0-6 items.

Rules:
- Use only what is in the input. Never invent facts, owners, dates or outcomes. Do not claim causes the notes do not state.
- Each item is one sentence, 25 words or fewer, naming the project when relevant. Keep ticket keys, PR numbers and names intact.
- Do not repeat an item across lists. If a list has nothing real to say, leave it empty rather than padding it.
- Concise, factual, same terse style as the input.
- Call submit_recap exactly once, then stop. Do not write any other text.${userContext()}`;
}
Recapper.agentName = 'standup-recapper';
