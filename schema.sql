-- ═══════════════════════════════════════════════════════════════
-- VANGUARD PREDICTION BOT — Full Supabase Schema
-- Run this in the Supabase SQL Editor to recreate all tables
-- ═══════════════════════════════════════════════════════════════

-- Drop existing tables (order matters for dependencies)
DROP TABLE IF EXISTS chart_prices CASCADE;
DROP TABLE IF EXISTS paper_trader_trades CASCADE;
DROP TABLE IF EXISTS paper_trader_sessions CASCADE;
DROP TABLE IF EXISTS live_prediction CASCADE;
DROP TABLE IF EXISTS prediction_stats CASCADE;
DROP TABLE IF EXISTS predictions CASCADE;
DROP TABLE IF EXISTS track_records CASCADE;
DROP TABLE IF EXISTS history CASCADE;
DROP TABLE IF EXISTS ws_metrics CASCADE;

-- ═══════════════════════════════════════════
-- 1. PREDICTIONS — Historical prediction results
-- One row per 5-minute window per source
-- ═══════════════════════════════════════════
CREATE TABLE predictions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          BIGINT NOT NULL,                    -- Window start timestamp (unix seconds)
  ptb         DOUBLE PRECISION,                   -- Nullable for skip / no-trade rows
  end_price   DOUBLE PRECISION,                   -- Null until a prediction settles
  over        BOOLEAN,                            -- Null for skips / unsettled rows
  source      TEXT NOT NULL DEFAULT 'vanguard-bot', -- 'vanguard-bot' or 'vanguard'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ts, source)                             -- Prevent duplicate saves per window
);

-- Index for fast lookups by source and time
CREATE INDEX idx_predictions_source_ts ON predictions (source, ts DESC);

-- ═══════════════════════════════════════════
-- 2. LIVE_PREDICTION — Real-time bot prediction (single row, id=1)
-- Upserted continuously by the bot
-- ═══════════════════════════════════════════
CREATE TABLE live_prediction (
  id          INT PRIMARY KEY CHECK (id IN (1, 2, 3)),   -- 1=5m, 2=15m, 3=1h
  window_start BIGINT,                            -- Current window timestamp
  direction   TEXT NOT NULL DEFAULT 'pending',     -- 'up', 'down', or 'pending'
  confidence  TEXT,                                -- 'HIGH', 'MED', 'LOW'
  conf_pct    DOUBLE PRECISION,                   -- Confidence percentage (0-100)
  ptb         DOUBLE PRECISION,                   -- Current price to beat
  btc_price   DOUBLE PRECISION,                   -- BTC price at prediction time
  bull_score  DOUBLE PRECISION DEFAULT 0,         -- Bull signal total
  bear_score  DOUBLE PRECISION DEFAULT 0,         -- Bear signal total
  signals     TEXT DEFAULT '',                    -- Signal descriptions
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert the default rows for each timeframe
INSERT INTO live_prediction (id, direction) VALUES
  (1, 'pending'),
  (2, 'pending'),
  (3, 'pending');

-- ═══════════════════════════════════════════
-- 3. CHART_PRICES — Rolling BTC price history for chart
-- ═══════════════════════════════════════════
CREATE TABLE chart_prices (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          BIGINT NOT NULL,                    -- Timestamp in milliseconds
  price       DOUBLE PRECISION NOT NULL,          -- BTC price
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for time-range queries
CREATE INDEX idx_chart_prices_ts ON chart_prices (ts);

-- Separate wallet/session state for the paper trader
CREATE TABLE paper_trader_sessions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           TEXT NOT NULL,
  timeframe         TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h')),
  mode              TEXT NOT NULL DEFAULT 'paper_trader',
  starting_balance  DOUBLE PRECISION NOT NULL DEFAULT 1000,
  available_balance DOUBLE PRECISION NOT NULL DEFAULT 1000,
  equity            DOUBLE PRECISION NOT NULL DEFAULT 1000,
  allocation_pct    DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  total_trades      INT NOT NULL DEFAULT 0,
  wins              INT NOT NULL DEFAULT 0,
  losses            INT NOT NULL DEFAULT 0,
  skips             INT NOT NULL DEFAULT 0,
  win_rate          DOUBLE PRECISION NOT NULL DEFAULT 0,
  realized_pnl      DOUBLE PRECISION NOT NULL DEFAULT 0,
  unrealized_pnl    DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_result       TEXT,
  last_action       TEXT,
  last_signal       TEXT,
  current_position  TEXT DEFAULT 'FLAT',
  current_entry     DOUBLE PRECISION,
  current_shares    DOUBLE PRECISION,
  last_window_start BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, timeframe)
);

CREATE INDEX idx_paper_trader_sessions_user_tf ON paper_trader_sessions (user_id, timeframe);

-- Separate trade ledger for each simulated paper trader execution
CREATE TABLE paper_trader_trades (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id     BIGINT REFERENCES paper_trader_sessions(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  timeframe      TEXT NOT NULL CHECK (timeframe IN ('5m', '15m', '1h')),
  window_start   BIGINT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('open', 'close', 'skip', 'reset')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'skipped', 'reset')),
  direction      TEXT CHECK (direction IN ('up', 'down')),
  signal_source  TEXT DEFAULT 'bot_final_vote',
  ptb            DOUBLE PRECISION,
  entry_price    DOUBLE PRECISION,
  exit_price     DOUBLE PRECISION,
  btc_entry      DOUBLE PRECISION,
  btc_exit       DOUBLE PRECISION,
  shares         DOUBLE PRECISION,
  margin_used    DOUBLE PRECISION,
  pnl            DOUBLE PRECISION DEFAULT 0,
  pnl_pct        DOUBLE PRECISION DEFAULT 0,
  result         TEXT CHECK (result IN ('WIN', 'LOSS', 'OPEN', 'SKIP')),
  note           TEXT,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, timeframe, window_start, action)
);

CREATE INDEX idx_paper_trader_trades_user_tf_window ON paper_trader_trades (user_id, timeframe, window_start DESC);
CREATE INDEX idx_paper_trader_trades_session ON paper_trader_trades (session_id, created_at DESC);

-- ═══════════════════════════════════════════
-- 4. PREDICTION_STATS — Aggregated stats (optional, read-only)
-- ═══════════════════════════════════════════
CREATE TABLE prediction_stats (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  wins        INT DEFAULT 0,
  losses      INT DEFAULT 0,
  total       INT DEFAULT 0,
  win_rate    DOUBLE PRECISION DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO prediction_stats (id) VALUES (1);

-- ═══════════════════════════════════════════════════════════════
-- 5. TRACK_RECORDS — generic tracking events (optional)
-- Used by backend or scripts to store arbitrary track records (plays, actions)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE track_records (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     TEXT,
  action      TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_track_records_user ON track_records (user_id);

-- 6. HISTORY — normalized event history (one row per event)
CREATE TABLE history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     TEXT,
  event       JSONB NOT NULL,
  ts          BIGINT, -- optional event timestamp (ms)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_ts ON history (ts DESC);

-- 7. WS_METRICS — websocket activity metrics (time-series)
CREATE TABLE ws_metrics (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          BIGINT NOT NULL,    -- timestamp in ms
  ws_count    INT NOT NULL,        -- count of WS messages observed at ts
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ws_metrics_ts ON ws_metrics (ts DESC);

-- ═══════════════════════════════════════════
-- ROW LEVEL SECURITY — Allow anon read/write
-- ═══════════════════════════════════════════
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_prediction ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trader_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trader_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ws_metrics ENABLE ROW LEVEL SECURITY;

-- Anon can read and insert predictions
CREATE POLICY "anon_read_predictions" ON predictions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_predictions" ON predictions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delete_predictions" ON predictions FOR DELETE TO anon USING (true);

-- Anon can read and upsert live_prediction
CREATE POLICY "anon_read_live" ON live_prediction FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_live" ON live_prediction FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_live" ON live_prediction FOR UPDATE TO anon USING (true);

-- Anon can read and insert chart_prices
CREATE POLICY "anon_read_chart" ON chart_prices FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_chart" ON chart_prices FOR INSERT TO anon WITH CHECK (true);

-- Anon can manage paper trader sessions
CREATE POLICY "anon_read_paper_trader_sessions" ON paper_trader_sessions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_paper_trader_sessions" ON paper_trader_sessions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_paper_trader_sessions" ON paper_trader_sessions FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_delete_paper_trader_sessions" ON paper_trader_sessions FOR DELETE TO anon USING (true);

-- Anon can manage paper trader trades
CREATE POLICY "anon_read_paper_trader_trades" ON paper_trader_trades FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_paper_trader_trades" ON paper_trader_trades FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_paper_trader_trades" ON paper_trader_trades FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_delete_paper_trader_trades" ON paper_trader_trades FOR DELETE TO anon USING (true);

-- Anon can read and insert track_records
CREATE POLICY "anon_read_track_records" ON track_records FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_track_records" ON track_records FOR INSERT TO anon WITH CHECK (true);

-- Anon can read and insert history
CREATE POLICY "anon_read_history" ON history FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_history" ON history FOR INSERT TO anon WITH CHECK (true);

-- Anon can read and insert ws_metrics
CREATE POLICY "anon_read_ws_metrics" ON ws_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_ws_metrics" ON ws_metrics FOR INSERT TO anon WITH CHECK (true);

-- Anon can read and update prediction_stats
CREATE POLICY "anon_read_stats" ON prediction_stats FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_stats" ON prediction_stats FOR UPDATE TO anon USING (true);

-- ═══════════════════════════════════════════
-- CLEANUP FUNCTION — Auto-delete old chart prices (>1 hour)
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION cleanup_old_chart_prices()
RETURNS void AS $$
BEGIN
  DELETE FROM chart_prices WHERE ts < (EXTRACT(EPOCH FROM NOW()) * 1000 - 3600000);
END;
$$ LANGUAGE plpgsql;
