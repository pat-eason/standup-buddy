CREATE TABLE projects (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  archived   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX projects_name_key ON projects (lower(name));

CREATE TABLE days (
  date         DATE PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'collated', 'finalized')),
  general_notes TEXT NOT NULL DEFAULT '',
  collated_at  TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  finalized    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stream_entries (
  id         BIGSERIAL PRIMARY KEY,
  day        DATE NOT NULL REFERENCES days (date) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stream_entries_day_idx ON stream_entries (day, created_at);

CREATE TABLE entry_projects (
  entry_id   BIGINT NOT NULL REFERENCES stream_entries (id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, project_id)
);

CREATE TABLE points (
  id               BIGSERIAL PRIMARY KEY,
  day              DATE NOT NULL REFERENCES days (date) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('update', 'question', 'decision', 'parking')),
  text             TEXT NOT NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  origin           TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'manual')),
  edited           BOOLEAN NOT NULL DEFAULT false,
  discussed        BOOLEAN NOT NULL DEFAULT false,
  source_entry_ids BIGINT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX points_day_idx ON points (day, position);

CREATE TABLE point_projects (
  point_id   BIGINT NOT NULL REFERENCES points (id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  PRIMARY KEY (point_id, project_id)
);

CREATE TABLE point_notes (
  id         BIGSERIAL PRIMARY KEY,
  point_id   BIGINT NOT NULL REFERENCES points (id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX point_notes_point_idx ON point_notes (point_id, created_at);

-- Chat conversations live in Flue's own tables; this only indexes them for the UI.
CREATE TABLE chat_threads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
