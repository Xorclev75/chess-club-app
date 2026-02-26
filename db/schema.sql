-- =========================================
-- Chess Club schema (BYE-friendly) — FIXED/IMPROVED
-- - Cascading deletes for schedules -> matches
-- - BYE-friendly nullable player ids
-- - Uniqueness + fast lookups
-- - Prevent duplicate player names per level (optional but recommended)
-- - Prevent duplicate matches within a schedule (optional but recommended)
-- =========================================

BEGIN;

-- Players
CREATE TABLE IF NOT EXISTS players (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  level       INTEGER NOT NULL CHECK (level IN (1,2,3)),
  score       NUMERIC(6,2) NOT NULL DEFAULT 0,

  -- Optional but recommended: avoid duplicates like "Josh" twice in same level
  CONSTRAINT uq_players_level_name UNIQUE (level, name)
);

-- Schedules (one schedule record per generated set)
CREATE TABLE IF NOT EXISTS schedules (
  id          BIGSERIAL PRIMARY KEY,
  created_at  DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Matches (belongs to a schedule)
CREATE TABLE IF NOT EXISTS matches (
  id          BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,

  -- Mirrors `${scheduleId}-${idx}` (handy for UI)
  match_key   TEXT NOT NULL,

  match_date  DATE NOT NULL,
  level       INTEGER NOT NULL CHECK (level IN (1,2,3)),

  -- BYE-friendly: allow NULL for one side (or the other)
  player1_id  BIGINT NULL REFERENCES players(id) ON DELETE SET NULL,
  player2_id  BIGINT NULL REFERENCES players(id) ON DELETE SET NULL,

  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('scheduled','completed','forfeit','canceled')),
  result      TEXT NULL,
  notes       TEXT NOT NULL DEFAULT '',

  -- Enforce that in non-BYE matches, players are different.
  CONSTRAINT players_not_equal CHECK (
    player1_id IS NULL
    OR player2_id IS NULL
    OR player1_id <> player2_id
  ),

  -- Prevent rows where BOTH sides are NULL
  CONSTRAINT at_least_one_player CHECK (
    player1_id IS NOT NULL OR player2_id IS NOT NULL
  ),

  -- Your UI references (schedule_id, match_key)
  CONSTRAINT match_key_unique_per_schedule UNIQUE (schedule_id, match_key),

  -- Optional but recommended: prevent exact duplicate pairings on the same day+level+schedule
  -- (handles swapped sides too using LEAST/GREATEST)
  CONSTRAINT uq_match_dedupe UNIQUE (
    schedule_id,
    match_date,
    level,
    LEAST(COALESCE(player1_id, 0), COALESCE(player2_id, 0)),
    GREATEST(COALESCE(player1_id, 0), COALESCE(player2_id, 0))
  )
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_players_level ON players(level);
CREATE INDEX IF NOT EXISTS idx_matches_schedule ON matches(schedule_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);

-- Extra: these speed up common queries (optional but usually worth it)
CREATE INDEX IF NOT EXISTS idx_matches_schedule_date ON matches(schedule_id, match_date);
CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches(player2_id);

COMMIT;