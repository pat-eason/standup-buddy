-- How urgent a todo is, 1 (not urgent) to 5 (incredibly urgent).
ALTER TABLE todos ADD COLUMN urgency SMALLINT NOT NULL DEFAULT 1
  CHECK (urgency BETWEEN 1 AND 5);
