'use agent';
import { defineTool, useModel, useTool, type AgentProps } from '@flue/runtime';
import * as v from 'valibot';
import { getConfig } from '../config.ts';
import { extra, userContext } from '../prompts.ts';
import { captures } from '../results.ts';

const CollationInput = v.object({
  points: v.array(
    v.object({
      kind: v.picklist(['update', 'question', 'decision', 'parking']),
      text: v.string(),
      projects: v.optional(v.array(v.string())),
      sources: v.optional(v.array(v.number())),
    }),
  ),
});

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

  return `You are the collation agent inside Standup Buddy, a personal standup helper.
You receive the user's raw stream-of-consciousness log for one day and turn it into a crisp standup board in bullet points.

Output four kinds of point:
- update: something done, shipped, unblocked or learned. Written in the past tense, starting with a verb, no leading "I".
- question: an outstanding question or blocker that needs an answer from someone. End with a question mark.
- decision: a decision point that needs the team to choose or confirm. Frame the choice ("Decide whether to X or Y", "Confirm Z").
- parking: a topic worth remembering but not for this standup (later, out of scope, "park this", nice-to-have).

Rules:
- One idea per point, one sentence, 25 words or fewer. Split compound entries, merge duplicates.
- Keep concrete details exactly as written: ticket keys, PR numbers, service names, people, numbers.
- Never invent facts, owners or outcomes. If an entry is ambiguous, keep it faithful to the wording.
- An entry may produce zero, one or several points. Trivia with no standup value can be dropped.
- Order updates by importance, then questions, decisions and parking.
- "projects": use only names from the provided project list (exact spelling); leave empty when none apply.
- "sources": the numeric ids of the stream entries each point came from.
- Points already on the board ("kept points") stay as they are: do not output them again or restate them.
- Call submit_collation exactly once with the complete list, then stop. Do not write any other text.${userContext()}${extra('Extra instructions from the user', cfg.collateInstructions)}`;
}
Collator.agentName = 'standup-collator';
