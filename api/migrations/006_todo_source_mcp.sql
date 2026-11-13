-- Todos created by an AI client over MCP get their own source.
ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_source_check;
ALTER TABLE todos ADD CONSTRAINT todos_source_check
  CHECK (source IN ('manual', 'action_item', 'suggested', 'mcp'));
