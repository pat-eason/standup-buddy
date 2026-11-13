-- How a todo got onto the list. source_day (already stored) is the standup it came from.
ALTER TABLE todos ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'action_item', 'suggested'));
UPDATE todos SET source = 'suggested' WHERE source_day IS NOT NULL;
