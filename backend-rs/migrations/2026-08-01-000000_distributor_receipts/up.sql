-- Payout receipts. `distributor_rounds` recorded only enough to roll the
-- leaderboard window forward (round_id, window, tx_hash); everything that makes
-- a round VERIFIABLE — the pot, what was actually paid, the VRF winner and their
-- cut, who received what — arrived in the RoundDistributed event and was thrown
-- away. These columns capture it so the payout can be shown and audited against
-- the chain.
--
-- All new columns are NULLable: rows written by the old code path stay valid and
-- are backfilled from `rounds(roundId)` on the next indexer start.
--
-- Wei is NUMERIC, not BIGINT — a pot of >9.2 BNB overflows int8 and these are
-- amounts, so they are never converted to f64 before display.
ALTER TABLE distributor_rounds
    ADD COLUMN IF NOT EXISTS pot_wei           NUMERIC,
    ADD COLUMN IF NOT EXISTS distributed_wei   NUMERIC,
    ADD COLUMN IF NOT EXISTS winner_address    TEXT,
    ADD COLUMN IF NOT EXISTS winner_amount_wei NUMERIC,
    ADD COLUMN IF NOT EXISTS holder_count      INTEGER,
    ADD COLUMN IF NOT EXISTS vrf_random        NUMERIC,
    ADD COLUMN IF NOT EXISTS block_number      BIGINT,
    ADD COLUMN IF NOT EXISTS distributed_at    BIGINT;

-- Per-recipient lines of a round, expanded from the round's packed `shares`
-- blob (24-byte entries: address(20) ++ big-endian uint32 share). `amount_wei`
-- mirrors the contract's own arithmetic, distributed_wei * share / 2^32, so the
-- sum over a round is <= distributed_wei (share flooring loses dust, never
-- gains it).
--
-- Keyed on (round_id, address) so re-indexing the same log is a no-op.
CREATE TABLE IF NOT EXISTS distributor_payouts (
    round_id   BIGINT  NOT NULL,
    address    TEXT    NOT NULL,
    share      BIGINT  NOT NULL,
    amount_wei NUMERIC NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (round_id, address)
);

-- "What have I been paid?" is the per-wallet lookup this table exists to serve.
CREATE INDEX IF NOT EXISTS distributor_payouts_address_idx
    ON distributor_payouts (address);
