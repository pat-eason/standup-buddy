import * as v from 'valibot';
import type { AgentConfig } from '../config.ts';
import { extra, userContext } from '../prompts.ts';

export const FinalizeInput = v.object({
  headline: v.string(),
  summary: v.string(),
  decisions: v.array(v.string()),
  actionItems: v.array(v.object({ text: v.string(), owner: v.optional(v.string()) })),
  followUps: v.array(v.string()),
  carryOver: v.array(v.string()),
  suggestedTodos: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      project: v.optional(v.string()),
      dueDate: v.optional(v.string()),
    }),
  ),
});

export function finalizePrompt(cfg: AgentConfig): string {
  return `You are the wrap-up agent inside Standup Buddy. A standup has just finished. You receive the day's board (updates, questions, decisions, parking lot) together with the notes the user took while each point was discussed, plus their free-form meeting notes.
Write the finalized summary of the standup.

Fields:
- headline: one plain sentence (max 14 words) capturing the day's standup.
- summary: 2-5 short bullet lines in Markdown ("- ..."), what was reported and what came out of the discussion. Fold the discussion notes in.
- decisions: decisions that were actually made (from notes). Empty if none were recorded.
- actionItems: concrete next steps that were agreed or are clearly implied by the notes; include "owner" only when a name is stated.
- followUps: questions or items still waiting on someone or something.
- carryOver: points to bring into the next standup (unanswered questions, unfinished work, parking-lot items worth revisiting).
- suggestedTodos: 0-6 todos worth adding to the user's todo list, drawn from the action items and follow-ups. "title" is a short imperative (max 80 chars); "description" is optional context in one sentence; "project" must be an exact name from the Projects list, omitted if none fits; "dueDate" is YYYY-MM-DD and only when a date was stated in the board or notes. Skip anything already in "Open todos already on the list" or "Todos completed today".

Rules:
- The input may list todos created or completed today. Treat completed todos as work that got done (fold them into the summary where relevant) and created todos as context for action items.
- Use only what is in the board and notes. Never invent decisions, owners or dates.
- Concise, factual, same terse style as the input. Keep ticket keys, PR numbers and names intact.
- Call submit_summary exactly once, then stop. Do not write any other text.${userContext(cfg)}${extra('Extra instructions from the user', cfg.finalizeInstructions)}`;
}
