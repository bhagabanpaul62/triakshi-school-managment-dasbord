-- Custom domains. A school may read, add and remove its own domains and choose the primary one (RLS limits rows to its school).
-- It may NOT change status, verified_at or the token: verification is done by the platform (console role / worker).
REVOKE UPDATE ON school_domains FROM app_school;
GRANT UPDATE (is_primary, updated_at) ON school_domains TO app_school;

-- A school-role insert can never start out verified, whatever the caller sends.
CREATE OR REPLACE FUNCTION school_domains_force_pending() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' THEN
    NEW.status := 'pending';
    NEW.verified_at := NULL;
    NEW.kind := 'custom';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS school_domains_force_pending ON school_domains;
CREATE TRIGGER school_domains_force_pending BEFORE INSERT ON school_domains
  FOR EACH ROW EXECUTE FUNCTION school_domains_force_pending();
