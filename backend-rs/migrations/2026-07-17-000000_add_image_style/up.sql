-- Universe/art style used for the AI fusion image (curated label or free text).
-- Nullable: tokens created before this feature have no style.
ALTER TABLE tokens ADD COLUMN image_style VARCHAR(200);
