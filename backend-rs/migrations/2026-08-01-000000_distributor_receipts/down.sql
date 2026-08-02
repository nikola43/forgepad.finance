DROP TABLE IF EXISTS distributor_payouts;

ALTER TABLE distributor_rounds
    DROP COLUMN IF EXISTS pot_wei,
    DROP COLUMN IF EXISTS distributed_wei,
    DROP COLUMN IF EXISTS winner_address,
    DROP COLUMN IF EXISTS winner_amount_wei,
    DROP COLUMN IF EXISTS holder_count,
    DROP COLUMN IF EXISTS vrf_random,
    DROP COLUMN IF EXISTS block_number,
    DROP COLUMN IF EXISTS distributed_at;
