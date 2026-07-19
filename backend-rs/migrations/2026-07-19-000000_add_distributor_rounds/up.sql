-- Completed Distributor payout rounds. The newest row's time_end anchors the
-- current leaderboard window: scoring restarts ("clears") after each payout.
-- Rows are recorded by the round-runner after distribute() confirms on-chain.
CREATE TABLE IF NOT EXISTS distributor_rounds (
    id SERIAL PRIMARY KEY,
    round_id BIGINT NOT NULL UNIQUE,
    time_start BIGINT NOT NULL,
    time_end BIGINT NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
