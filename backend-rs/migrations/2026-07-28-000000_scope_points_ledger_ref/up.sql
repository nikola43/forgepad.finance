-- points_ledger.ref carried a GLOBAL unique constraint while the refs the code
-- generates contain no user id ("quest:first_buy", "ach:creator",
-- "quest:daily_trade:2026-07-28"). Combined with ON CONFLICT (ref) DO NOTHING,
-- the FIRST user on the platform silently consumed every one-off quest and
-- achievement for everyone, and one user per day consumed each daily quest.
-- Every other user's grant inserted 0 rows. Scope uniqueness to the user, which
-- is what the ref strings already assume.
--
-- Written to be re-runnable: a migration that aborts halfway (e.g. the
-- constraint already exists) would roll back inside its transaction and leave
-- the index below uncreated, so every guard is explicit.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'points_ledger_ref_key') THEN
        ALTER TABLE points_ledger DROP CONSTRAINT points_ledger_ref_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'points_ledger_user_ref_key') THEN
        ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_user_ref_key UNIQUE (user_id, ref);
    END IF;
END $$;

-- The time-weighted points query walks each user's position PER TOKEN in
-- timestamp order (PARTITION BY swapper_id, token_id ORDER BY traded_at, id), so
-- the index must lead with both partition columns.
CREATE INDEX IF NOT EXISTS idx_trades_swapper_token_traded_at
  ON trades (swapper_id, token_id, traded_at, id);
DROP INDEX IF EXISTS idx_trades_swapper_traded_at;
