DROP TRIGGER IF EXISTS indexing_updated_at ON indexing_state;
DROP TRIGGER IF EXISTS tokens_updated_at ON tokens;
DROP TRIGGER IF EXISTS users_updated_at ON users;
DROP FUNCTION IF EXISTS update_updated_at();

DROP TABLE IF EXISTS indexing_state;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS kings;
DROP TABLE IF EXISTS token_creation_requests;
DROP TABLE IF EXISTS referral_info;
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS follows;
DROP TABLE IF EXISTS holders;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS tokens;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS trade_type;
DROP TYPE IF EXISTS token_category;
DROP TYPE IF EXISTS pool_type;
