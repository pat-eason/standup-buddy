-- Collation context: a short theme to group points under, and why the point is on the board.
ALTER TABLE points
  ADD COLUMN group_label TEXT NOT NULL DEFAULT '',
  ADD COLUMN rationale   TEXT NOT NULL DEFAULT '';
