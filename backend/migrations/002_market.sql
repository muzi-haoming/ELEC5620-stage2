CREATE TABLE IF NOT EXISTS market_reference (
 id text PRIMARY KEY,
 category text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS market_reference_category ON market_reference(category, observed_at DESC);
