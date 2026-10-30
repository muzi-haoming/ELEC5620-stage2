CREATE TABLE IF NOT EXISTS agent_audit_jobs (
    id TEXT PRIMARY KEY,
    source JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_audit_jobs_pending ON agent_audit_jobs(status, created_at);
