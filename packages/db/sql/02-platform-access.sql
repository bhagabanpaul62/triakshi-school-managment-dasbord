-- What the school app may do with platform tables (spec §8). RLS already limits rows to its own school.
REVOKE INSERT, UPDATE, DELETE ON plans, plan_modules, modules FROM app_school;
REVOKE ALL ON platform_staff, staff_sessions, platform_audit_logs, webhook_events FROM app_school;
REVOKE INSERT, UPDATE, DELETE ON school_module_overrides, subscriptions, invoices, payments, credit_notes, account_credits, tds_certificates FROM app_school;
REVOKE UPDATE, DELETE ON audit_logs FROM app_school;
REVOKE INSERT, DELETE ON schools FROM app_school;
REVOKE UPDATE ON schools FROM app_school;
GRANT UPDATE (name, board, state, city, address, phone, email, gstin, udise_code, timezone,
  academic_year_start_month, theme, logo_url, setup_completed_at, updated_at) ON schools TO app_school;
-- Audit log is append-only for everyone but the migration owner.
REVOKE UPDATE, DELETE ON audit_logs FROM app_console;

-- The school app may create its own invite/reset/verify tokens, but never a support-login token
-- (those come only from the console). Enforced by trigger because RLS cannot see the purpose column per role.
CREATE OR REPLACE FUNCTION block_school_support_tokens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' THEN
    -- Creating one, or turning a token into one, is console-only.
    IF NEW.purpose = 'support_login' AND (TG_OP = 'INSERT' OR OLD.purpose <> 'support_login') THEN
      RAISE EXCEPTION 'support_login tokens can only be issued by the console';
    END IF;
    -- Consuming one (setting used_at) is allowed; changing who, what or how long is not.
    IF TG_OP = 'UPDATE' AND OLD.purpose = 'support_login' AND (NEW.meta IS DISTINCT FROM OLD.meta
       OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.token_hash IS DISTINCT FROM OLD.token_hash) THEN
      RAISE EXCEPTION 'support_login tokens cannot be changed by the school';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS one_time_tokens_no_school_support ON one_time_tokens;
CREATE TRIGGER one_time_tokens_no_school_support BEFORE INSERT OR UPDATE ON one_time_tokens
  FOR EACH ROW EXECUTE FUNCTION block_school_support_tokens();

-- Schools may request custom design work, but only the console sets status, quotes and invoices.
REVOKE UPDATE, DELETE ON custom_design_requests FROM app_school;
CREATE OR REPLACE FUNCTION school_design_request_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' THEN
    NEW.status := 'requested'; NEW.quote_paise := NULL; NEW.invoice_id := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS custom_design_requests_school_defaults ON custom_design_requests;
CREATE TRIGGER custom_design_requests_school_defaults BEFORE INSERT ON custom_design_requests
  FOR EACH ROW EXECUTE FUNCTION school_design_request_defaults();
