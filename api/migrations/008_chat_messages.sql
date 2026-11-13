-- Messages for chats run on the Claude Code subscription. API-key chats keep their
-- history in Flue's own tables; these threads share the chat_threads index.
CREATE TABLE chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  thread_id  UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  parts      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_thread_idx ON chat_messages (thread_id, id);
