-- Custom enum types
CREATE TYPE pool_type AS ENUM ('v2', 'v3', 'v4');
CREATE TYPE token_category AS ENUM ('normal', 'nsfw');
CREATE TYPE trade_type AS ENUM ('buy', 'sell');

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    address VARCHAR(50) NOT NULL UNIQUE,
    username VARCHAR(255),
    avatar VARCHAR(255),
    bio TEXT,
    likes INTEGER NOT NULL DEFAULT 0,
    twitter_id VARCHAR(64),
    twitter_name VARCHAR(64),
    twitter_username VARCHAR(64),
    twitter_access VARCHAR(100),
    twitter_profile_picture VARCHAR(200),
    twitter_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Tokens (FK → users via creator_id)
-- ============================================================
CREATE TABLE tokens (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(60) NOT NULL,
    symbol VARCHAR(30) NOT NULL,
    description TEXT,
    image VARCHAR(255),
    banner VARCHAR(255),
    creator_id INTEGER NOT NULL REFERENCES users(id),
    network VARCHAR(50) NOT NULL,
    marketcap NUMERIC(78, 18) NOT NULL DEFAULT 0,
    price NUMERIC(78, 18) NOT NULL DEFAULT 0,
    eth_price NUMERIC(78, 18) NOT NULL DEFAULT 0,
    volume NUMERIC(78, 18) NOT NULL DEFAULT 0,
    score NUMERIC(78, 18) NOT NULL DEFAULT 0,
    virtual_eth_amount NUMERIC(78, 18) NOT NULL DEFAULT 0,
    virtual_token_amount NUMERIC(78, 18) NOT NULL DEFAULT 0,
    pair_address VARCHAR(50),
    pool_type pool_type NOT NULL DEFAULT 'v2',
    category token_category NOT NULL DEFAULT 'normal',
    reply_count INTEGER NOT NULL DEFAULT 0,
    web_link VARCHAR(255),
    telegram_link VARCHAR(255),
    twitter_link VARCHAR(255),
    launched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tokens_network ON tokens(network);
CREATE INDEX idx_tokens_creator ON tokens(creator_id);
CREATE INDEX idx_tokens_score ON tokens(score DESC);
CREATE INDEX idx_tokens_marketcap ON tokens(marketcap DESC);
CREATE INDEX idx_tokens_created ON tokens(created_at DESC);

-- ============================================================
-- Trades (FK → tokens, users)
-- ============================================================
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    token_id INTEGER NOT NULL REFERENCES tokens(id),
    swapper_id INTEGER NOT NULL REFERENCES users(id),
    trade_type trade_type NOT NULL,
    eth_amount NUMERIC(78, 18) NOT NULL,
    token_amount NUMERIC(78, 18) NOT NULL,
    token_price NUMERIC(78, 18) NOT NULL DEFAULT 0,
    eth_price NUMERIC(78, 18) NOT NULL DEFAULT 0,
    tx_hash VARCHAR(66) NOT NULL UNIQUE,
    traded_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trades_token ON trades(token_id);
CREATE INDEX idx_trades_swapper ON trades(swapper_id);
CREATE INDEX idx_trades_traded_at ON trades(traded_at DESC);

-- ============================================================
-- Chats (FK → tokens, users, self-ref for threading)
-- ============================================================
CREATE TABLE chats (
    id SERIAL PRIMARY KEY,
    token_id INTEGER NOT NULL REFERENCES tokens(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    parent_id INTEGER REFERENCES chats(id),
    content TEXT NOT NULL,
    code VARCHAR(255),
    network VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chats_token ON chats(token_id);

-- ============================================================
-- Holders (junction: tokens × users)
-- ============================================================
CREATE TABLE holders (
    id SERIAL PRIMARY KEY,
    token_id INTEGER NOT NULL REFERENCES tokens(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount NUMERIC(78, 18) NOT NULL DEFAULT 0,
    UNIQUE(token_id, user_id)
);

CREATE INDEX idx_holders_token ON holders(token_id);
CREATE INDEX idx_holders_user ON holders(user_id);

-- ============================================================
-- Follows (single junction, replaces followers + followees)
-- ============================================================
CREATE TABLE follows (
    id SERIAL PRIMARY KEY,
    follower_id INTEGER NOT NULL REFERENCES users(id),
    followee_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(follower_id, followee_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_followee ON follows(followee_id);

-- ============================================================
-- Referrals
-- ============================================================
CREATE TABLE referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(id),
    referee_id INTEGER NOT NULL REFERENCES users(id),
    UNIQUE(referrer_id, referee_id)
);

CREATE TABLE referral_info (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    referral_code VARCHAR(10) NOT NULL UNIQUE,
    earnings INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- Token creation requests (pending blockchain confirmation)
-- ============================================================
CREATE TABLE token_creation_requests (
    id SERIAL PRIMARY KEY,
    creator_address VARCHAR(50) NOT NULL,
    body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Kings (featured / top tokens)
-- ============================================================
CREATE TABLE kings (
    id SERIAL PRIMARY KEY,
    token_id INTEGER NOT NULL REFERENCES tokens(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- ============================================================
-- Admins
-- ============================================================
CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
    penalized BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================
-- Blockchain indexing state
-- ============================================================
CREATE TABLE indexing_state (
    id SERIAL PRIMARY KEY,
    network VARCHAR(50) NOT NULL UNIQUE,
    last_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tokens_updated_at
    BEFORE UPDATE ON tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER indexing_updated_at
    BEFORE UPDATE ON indexing_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
