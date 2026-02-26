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
  player2_id  BIGINT NOT NULL REFERENCES players(id),

  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('scheduled','completed','forfeit','canceled')),
  result      TEXT NULL,
  notes       TEXT NOT NULL DEFAULT '',

  CONSTRAINT players_not_equal CHECK (player1_id <> player2_id),
  CONSTRAINT match_key_unique_per_schedule UNIQUE (schedule_id, match_key)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_players_level ON players(level);
CREATE INDEX IF NOT EXISTS idx_matches_schedule ON matches(schedule_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);