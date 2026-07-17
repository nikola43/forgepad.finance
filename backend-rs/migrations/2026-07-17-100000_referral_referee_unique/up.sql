-- A referee may be credited to at most one referrer. The original schema only
-- had UNIQUE(referrer_id, referee_id), which still allowed two different
-- referrers to both claim the same referee under a concurrent-registration
-- race. Enforce single attribution at the DB level so the handler's
-- ON CONFLICT DO NOTHING is backed by a real invariant.
ALTER TABLE referrals ADD CONSTRAINT referrals_referee_unique UNIQUE (referee_id);
