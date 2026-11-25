-- What a notice said before each correction is history: it can be added to, never changed or removed.
-- Two exceptions that are not changes to history: the notice (a draft that was never sent) is being deleted with its notes,
-- or the whole school is being deleted (the delete arrives from the parent, one trigger level deeper).
CREATE OR REPLACE FUNCTION announcement_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (pg_trigger_depth() > 1 OR EXISTS (
    SELECT 1 FROM announcements a WHERE a.id = OLD.announcement_id AND a.state = 'draft' AND a.fanned_out_at IS NULL)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'announcement_versions is append only';
END $$;

DROP TRIGGER IF EXISTS announcement_versions_append_only ON announcement_versions;
CREATE TRIGGER announcement_versions_append_only BEFORE UPDATE OR DELETE ON announcement_versions
  FOR EACH ROW EXECUTE FUNCTION announcement_versions_guard();

-- Backstop for the website rule: only a notice for everyone (or for the website alone) may be marked for the website.
-- NOT VALID: rows from before this rule are not rechecked, every new or changed row is.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_website_audience') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_website_audience CHECK (
      NOT website OR audience->'include' = '[]'::jsonb
      OR (audience->'exclude' = '[]'::jsonb AND audience->'include' @> '[{"type":"everyone"}]'::jsonb)) NOT VALID;
  END IF;
END $$;
