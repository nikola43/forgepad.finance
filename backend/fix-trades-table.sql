-- Fix trades table to add auto-increment to id column
-- This will fix the "null value in column 'id' violates not-null constraint" error

-- Drop existing sequence if it exists
DROP SEQUENCE IF EXISTS trades_id_seq CASCADE;

-- Create a new sequence for the id column
CREATE SEQUENCE trades_id_seq;

-- Set the id column to use the sequence as default
ALTER TABLE trades
  ALTER COLUMN id SET DEFAULT nextval('trades_id_seq');

-- Set the sequence to start from the current maximum id + 1
-- This ensures no conflicts with existing records
SELECT setval('trades_id_seq', COALESCE((SELECT MAX(id) FROM trades), 0) + 1, false);

-- Make id column auto-increment
ALTER SEQUENCE trades_id_seq OWNED BY trades.id;

-- Verify the change
\d trades
