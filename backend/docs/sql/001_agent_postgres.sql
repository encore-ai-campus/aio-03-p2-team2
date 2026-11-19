-- FestaMate agent persistence migration; apply AFTER the team's v4.3 schema.
-- Generated from langgraph-checkpoint-postgres 3.2.1 (uv.lock).
-- Supabase SQL Editor: clear any selection and run this ENTIRE file as postgres.
-- All table names are schema-qualified; safe to re-run; no DROP/DML on public service tables.
-- No automatic application DDL. Private schema must NOT be added to exposed Data API schemas.
BEGIN;
CREATE SCHEMA IF NOT EXISTS agent_storage;
REVOKE ALL ON SCHEMA agent_storage FROM PUBLIC, anon, authenticated;
-- Application memory. These names intentionally differ from public.agent_runs/agent_steps.
CREATE TABLE IF NOT EXISTS agent_storage.sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    summary jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(summary) = 'object'),
    messages jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(messages) = 'array'),
    conditions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(conditions) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS agent_storage.preferences (
    user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    value jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(value) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_storage.executions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_id text NOT NULL,
    group_id text,
    proposal_id text UNIQUE,
    status text NOT NULL DEFAULT 'running' CHECK (status IN
        ('running','waiting_input','waiting_approval','completed','failed','rejected','cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(session_id,user_id) REFERENCES agent_storage.sessions(id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user_updated_idx ON agent_storage.sessions(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS executions_user_created_idx ON agent_storage.executions(user_id,created_at DESC);
-- group_id/proposal_id are server-validated business references, not duplicated domain tables.

-- Establish the migration table BEFORE reading its version (fresh or partial install).
-- Official checkpoint migration 0
CREATE TABLE IF NOT EXISTS agent_storage.checkpoint_migrations (
    v INTEGER PRIMARY KEY
);
DO $$
BEGIN
    IF (SELECT max(v) FROM agent_storage.checkpoint_migrations) > 9 THEN
        RAISE EXCEPTION 'Checkpoint schema is newer than this migration; do not downgrade';
    END IF;
END $$;
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (0) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 1
CREATE TABLE IF NOT EXISTS agent_storage.checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (1) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 2
CREATE TABLE IF NOT EXISTS agent_storage.checkpoint_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BYTEA,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (2) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 3
CREATE TABLE IF NOT EXISTS agent_storage.checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    blob BYTEA NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (3) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 4
ALTER TABLE agent_storage.checkpoint_blobs ALTER COLUMN blob DROP not null;
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (4) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 5
SELECT 1;
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (5) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 6
CREATE INDEX IF NOT EXISTS checkpoints_thread_id_idx ON agent_storage.checkpoints(thread_id);
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (6) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 7
CREATE INDEX IF NOT EXISTS checkpoint_blobs_thread_id_idx ON agent_storage.checkpoint_blobs(thread_id);
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (7) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 8
CREATE INDEX IF NOT EXISTS checkpoint_writes_thread_id_idx ON agent_storage.checkpoint_writes(thread_id);
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (8) ON CONFLICT(v) DO NOTHING;

-- Official checkpoint migration 9
ALTER TABLE agent_storage.checkpoint_writes ADD COLUMN IF NOT EXISTS task_path TEXT NOT NULL DEFAULT '';
INSERT INTO agent_storage.checkpoint_migrations(v) VALUES (9) ON CONFLICT(v) DO NOTHING;
ALTER TABLE agent_storage.sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_storage.sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE agent_storage.sessions TO service_role;
ALTER TABLE agent_storage.preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_storage.preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE agent_storage.preferences TO service_role;
ALTER TABLE agent_storage.executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_storage.executions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE agent_storage.executions TO service_role;
ALTER TABLE agent_storage.checkpoint_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_storage.checkpoint_migrations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE agent_storage.checkpoint_migrations TO service_role;
ALTER TABLE agent_storage.checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_storage.checkpoints FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE agent_storage.checkpoints TO service_role;
ALTER TABLE agent_storage.checkpoint_blobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_storage.checkpoint_blobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE agent_storage.checkpoint_blobs TO service_role;
ALTER TABLE agent_storage.checkpoint_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE agent_storage.checkpoint_writes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE agent_storage.checkpoint_writes TO service_role;
GRANT USAGE ON SCHEMA agent_storage TO service_role;
COMMIT;

-- Read-only confirmation: expect all 7 tables and RLS=true.
SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='agent_storage' ORDER BY tablename;
SELECT max(v) AS checkpoint_migration_version FROM agent_storage.checkpoint_migrations;
