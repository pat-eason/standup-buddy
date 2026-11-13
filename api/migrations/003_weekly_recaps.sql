-- LLM-written weekly recap (summary + SWOT-style lists), keyed by the Monday of the week.
CREATE TABLE weekly_recaps (
  week_start   DATE PRIMARY KEY,
  content      JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
