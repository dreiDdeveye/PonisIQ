-- Allow skip rows in prediction history tables.
-- Run this once in the Supabase SQL editor for the existing deployed database.

ALTER TABLE IF EXISTS predictions
  ALTER COLUMN ptb DROP NOT NULL,
  ALTER COLUMN end_price DROP NOT NULL,
  ALTER COLUMN over DROP NOT NULL;

ALTER TABLE IF EXISTS predictions_15m
  ALTER COLUMN ptb DROP NOT NULL,
  ALTER COLUMN end_price DROP NOT NULL,
  ALTER COLUMN over DROP NOT NULL;

ALTER TABLE IF EXISTS predictions_1h
  ALTER COLUMN ptb DROP NOT NULL,
  ALTER COLUMN end_price DROP NOT NULL,
  ALTER COLUMN over DROP NOT NULL;
