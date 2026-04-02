-- PostgreSQL tables for Forgepad backend

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  address VARCHAR(42) UNIQUE,
  username VARCHAR(255),
  avatar VARCHAR(255),
  bio VARCHAR(255),
  likes INT DEFAULT 0,
  creationTime TIMESTAMP,
  updateTime TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  twitter_id VARCHAR(64),
  twitter_name VARCHAR(64),
  twitter_username VARCHAR(64),
  twitter_access VARCHAR(100),
  twitter_profile_picture VARCHAR(200),
  twitter_verified BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tokens (
  id SERIAL PRIMARY KEY,
  tokenName VARCHAR(60),
  tokenSymbol VARCHAR(30),
  tokenAddress VARCHAR(44) UNIQUE,
  tokenDescription TEXT,
  tokenImage VARCHAR(255),
  tokenBanner VARCHAR(255),
  marketcap DECIMAL(65,18) DEFAULT 0,
  price DECIMAL(65,18) DEFAULT 0,
  creatorAddress VARCHAR(44),
  network VARCHAR(255),
  replies INT DEFAULT 0,
  webLink VARCHAR(255),
  telegramLink VARCHAR(255),
  twitterLink VARCHAR(255),
  creationTime TIMESTAMP,
  updateTime TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  launchedAt TIMESTAMP,
  category INT DEFAULT 0,
  pairAddress VARCHAR(42),
  ethPrice DECIMAL(65,18) DEFAULT 0,
  volume DECIMAL(65,18),
  score DECIMAL(65,18),
  virtualEthAmount DECIMAL(65,18) DEFAULT 0,
  virtualTokenAmount DECIMAL(65,18) DEFAULT 0,
  poolType SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  tokenName VARCHAR(255),
  tokenSymbol VARCHAR(255),
  tokenAddress VARCHAR(42),
  tokenImage VARCHAR(255),
  swapperAddress VARCHAR(42),
  type VARCHAR(255),
  ethAmount DECIMAL(65,18),
  tokenAmount DECIMAL(65,18),
  network VARCHAR(255),
  date BIGINT,
  txHash VARCHAR(66) UNIQUE,
  tokenPrice DECIMAL(65,18) DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  ethPrice DECIMAL(65,18) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  tokenAddress VARCHAR(42),
  replyAddress VARCHAR(42),
  network VARCHAR(255),
  comment TEXT,
  code VARCHAR(255),
  date TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tokens_address ON tokens(tokenAddress);
CREATE INDEX idx_trades_token ON trades(tokenAddress);
CREATE INDEX idx_trades_date ON trades(date DESC);
CREATE INDEX idx_users_address ON users(address);