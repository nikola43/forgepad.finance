-- Plain ERC20 transfers are not trades, so nothing recorded them — a wallet
-- could buy on the curve, send the tokens elsewhere, and keep scoring forever
-- for a position it no longer held. Recording transfers lets the scoring query
-- subtract tokens that left a wallet.
CREATE TABLE IF NOT EXISTS token_transfers (
    id SERIAL PRIMARY KEY,
    token_id INTEGER NOT NULL REFERENCES tokens(id),
    from_user_id INTEGER REFERENCES users(id),
    to_user_id INTEGER REFERENCES users(id),
    amount NUMERIC(78,18) NOT NULL,
    transferred_at BIGINT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    log_index BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT token_transfers_tx_log_key UNIQUE (tx_hash, log_index)
);
-- Scoring subtracts a user's outgoing transfers, so this is the access path.
CREATE INDEX IF NOT EXISTS idx_token_transfers_from
  ON token_transfers (from_user_id, token_id, transferred_at, id);
