-- Direct-launch tokens (createTokenDirect: no bonding curve, listed straight on V4)
-- report a pool_type the original enum has no value for, so any insert of one fails.
-- PG allows ADD VALUE inside a transaction as long as the value is not USED in the
-- same transaction; this migration only declares it, so Diesel's wrapping tx is fine.
ALTER TYPE pool_type ADD VALUE IF NOT EXISTS 'direct';
