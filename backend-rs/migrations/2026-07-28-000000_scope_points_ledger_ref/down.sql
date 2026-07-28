-- Reverting reinstates the global-ref bug; only useful for schema archaeology.
-- Guarded because duplicate (user_id, ref) rows created while the fix was live
-- would make the old constraint impossible to re-add.
DROP INDEX IF EXISTS idx_trades_swapper_token_traded_at;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'points_ledger_user_ref_key') THEN
        ALTER TABLE points_ledger DROP CONSTRAINT points_ledger_user_ref_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'points_ledger_ref_key')
       AND NOT EXISTS (SELECT 1 FROM (SELECT ref FROM points_ledger GROUP BY ref HAVING count(*) > 1) d) THEN
        ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_ref_key UNIQUE (ref);
    END IF;
END $$;
