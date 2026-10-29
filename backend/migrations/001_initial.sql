CREATE TABLE IF NOT EXISTS app_meta (
 id integer PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS quotes (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
 id text PRIMARY KEY,
 payload jsonb NOT NULL,
 CHECK (payload->>'status' IN ('pending','transit','received','settled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS order_quote_unique ON orders ((payload->>'quoteId'));
CREATE UNIQUE INDEX IF NOT EXISTS order_item_unique ON orders ((payload->'item'->>'id'));
CREATE TABLE IF NOT EXISTS policies (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS cases (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
 id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES orders(id),
 amount_cents bigint NOT NULL CHECK(amount_cents>=0), method text NOT NULL
);
CREATE TABLE IF NOT EXISTS settlements (
 id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES orders(id),
 seller_cents bigint NOT NULL, carrier_cents bigint NOT NULL,
 platform_cents bigint NOT NULL, settled_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
 id text PRIMARY KEY, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS command_receipts (
 id text PRIMARY KEY, request_hash text NOT NULL, result jsonb NOT NULL
);
