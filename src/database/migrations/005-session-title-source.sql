-- Aether database, version 5: where the title of each session comes from.
-- Story S10: a title from the agent never replaces a title that the user typed. The values are
-- 'prompt' (the first line of the first message), 'agent' and 'user'. No CHECK lists them: the
-- store validates them in code, because a CHECK needs a table rebuild to change (user preference 5).
ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'prompt';
