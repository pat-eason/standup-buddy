-- Personal todo list. Completed todos stay (with completed_at) so the daily collation and
-- standup summary can see what was created or finished on a given day.
CREATE TABLE todos (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  project_id   BIGINT REFERENCES projects (id) ON DELETE SET NULL,
  due_date     DATE,
  done         BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  source_day   DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX todos_open_idx ON todos (done, due_date);
CREATE INDEX todos_created_idx ON todos (created_at);
CREATE INDEX todos_completed_idx ON todos (completed_at) WHERE completed_at IS NOT NULL;
