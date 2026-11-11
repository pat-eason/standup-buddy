import { createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { setProvider } from '@flue/runtime';

/**
 * Optional ANTHROPIC_BASE_URL (gateway / proxy). The built-in catalog pins
 * https://api.anthropic.com per model, so re-register the provider with the
 * override applied. Without the variable the built-in provider is used as is.
 */
const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim().replace(/\/$/, '');

if (baseUrl) {
  const builtin = anthropicProvider();
  setProvider(
    createProvider({
      id: builtin.id,
      name: builtin.name,
      baseUrl,
      auth: builtin.auth,
      models: builtin.getModels().map((m) => ({ ...m, baseUrl })),
      api: anthropicMessagesApi(),
    }),
  );
  console.log(`[standup-buddy] anthropic provider routed through ${baseUrl}`);
}
