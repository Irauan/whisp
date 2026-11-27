-- Aether database, version 4: who started each session.
-- Decision 0006: the release time depends on who started the session.
ALTER TABLE sessions ADD COLUMN started_by TEXT NOT NULL DEFAULT 'person';
