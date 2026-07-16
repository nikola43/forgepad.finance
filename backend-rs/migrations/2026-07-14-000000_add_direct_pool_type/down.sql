-- Postgres cannot drop a single enum value. Reversing means rebuilding the type,
-- which requires every row using 'direct' to be remapped first.
ALTER TYPE pool_type RENAME TO pool_type_old;
CREATE TYPE pool_type AS ENUM ('v2', 'v3', 'v4');
ALTER TABLE tokens
    ALTER COLUMN pool_type DROP DEFAULT,
    ALTER COLUMN pool_type TYPE pool_type
        USING (CASE WHEN pool_type::text = 'direct' THEN 'v4' ELSE pool_type::text END)::pool_type,
    ALTER COLUMN pool_type SET DEFAULT 'v2';
DROP TYPE pool_type_old;
