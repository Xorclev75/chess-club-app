-- Players
CREATE TABLE IF NOT EXISTS players (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  level       INTEGER NOT NULL CHECK (level IN (1,2,3)),
  score       NUMERIC(6,2) NOT NULL DEFAULT 0
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

  -- This mirrors your old `${scheduleId}-${idx}` behavior (handy for UI)
  match_key   TEXT NOT NULL,

  match_date  DATE NOT NULL,
  level       INTEGER NOT NULL CHECK (level IN (1,2,3)),

  player1_id  BIGINT NOT NULL REFERENCES players(id),

  -- BYE support: opponent can be NULL
  player2_id  BIGINT NULL REFERENCES players(id),

  -- Optional explicit BYE flag (nice for clarity; not required if you rely on NULL player2_id)
  is_bye      BOOLEAN NOT NULL DEFAULT FALSE,

  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('scheduled','completed','forfeit','canceled')),
  result      TEXT NULL,
  notes       TEXT NOT NULL DEFAULT '',

  -- If player2_id is present, it must not equal player1_id
  CONSTRAINT players_not_equal
    CHECK (player2_id IS NULL OR player1_id <> player2_id),

  -- Keep is_bye consistent with NULL opponent (optional but recommended)
  CONSTRAINT bye_consistency
    CHECK ((is_bye = TRUE AND player2_id IS NULL) OR (is_bye = FALSE)),

  CONSTRAINT match_key_unique_per_schedule UNIQUE (schedule_id, match_key)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_players_level ON players(level);
CREATE INDEX IF NOT EXISTS idx_matches_schedule ON matches(schedule_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);

-- Optional: speeds up joins/filters by opponent/player
CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches(player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_is_bye ON matches(is_bye);