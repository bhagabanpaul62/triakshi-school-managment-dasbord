-- Custom domains. A school may read, add and remove its own domains and choose the primary one (RLS limits rows to its school).
-- It may NOT change status, verified_at, the token, health, the record results, the clocks or the certificate: the platform
-- (console role / worker) writes those, so a school cannot mark its own domain live or hide a failure.
REVOKE UPDATE ON school_domains FROM app_school;
GRANT UPDATE (is_primary, updated_at) ON school_domains TO app_school;

-- A school-role insert starts as a plain pending claim, whatever the caller sends.
CREATE OR REPLACE FUNCTION school_domains_force_pending() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' THEN
    NEW.status := 'pending';
    NEW.verified_at := NULL;
    NEW.kind := 'custom';
    NEW.health := NULL;
    NEW.failing_since := NULL;
    NEW.txt_missing_since := NULL;
    NEW.records := '[]'::jsonb;
    NEW.cert_expires_at := NULL;
    NEW.dns_provider := NULL;
    NEW.told_at := NULL;
    NEW.last_checked_at := NULL;
    NEW.check_error := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS school_domains_force_pending ON school_domains;
CREATE TRIGGER school_domains_force_pending BEFORE INSERT ON school_domains
  FOR EACH ROW EXECUTE FUNCTION school_domains_force_pending();

-- Domain history: append-only for the school (update and delete are revoked in 02-platform-access.sql). The school
-- writes only what it did itself; verified, failing, recovered, failed, released and lost are the platform's words.
CREATE OR REPLACE FUNCTION school_domain_events_school_kinds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' AND NEW.kind NOT IN ('added', 'primary', 'removed', 'checked') THEN
    RAISE EXCEPTION 'The school cannot write a "%" domain event', NEW.kind USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS school_domain_events_school_kinds ON school_domain_events;
CREATE TRIGGER school_domain_events_school_kinds BEFORE INSERT ON school_domain_events
  FOR EACH ROW EXECUTE FUNCTION school_domain_events_school_kinds();
