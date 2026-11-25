-- Erasing a person (DPDP): the audit log is append-only for the school, but contact values that were written into old entries'
-- "changes" must go too. This function is the one narrow door: it runs as the owner, touches only the caller's school (the one pinned
-- by withSchool), only entries about the ids it is given, and only contact keys inside `meta.changes`, which become "(erased)".
-- Words of the entry, who, when and the other fields stay. The caller writes its own audit entry about having done it.
CREATE OR REPLACE FUNCTION erase_audit_contacts(p_entity_ids text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sid uuid := nullif(current_setting('app.school_id', true), '')::uuid;
  keys text[] := ARRAY['phone', 'altPhone', 'emergencyPhone', 'emergencyName', 'address', 'email', 'parentName', 'message', 'notes', 'occupation'];
  n integer;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'no school is set' USING ERRCODE = '42501'; END IF;
  IF p_entity_ids IS NULL OR cardinality(p_entity_ids) = 0 THEN RETURN 0; END IF;
  UPDATE audit_logs a SET meta = jsonb_set(a.meta, '{changes}', (
      SELECT jsonb_object_agg(e.key, CASE WHEN e.key = ANY (keys) THEN '["(erased)", "(erased)"]'::jsonb ELSE e.value END)
        FROM jsonb_each(a.meta -> 'changes') e))
   WHERE a.school_id = sid
     AND a.entity_id = ANY (p_entity_ids)
     AND jsonb_typeof(a.meta -> 'changes') = 'object'
     AND EXISTS (SELECT 1 FROM jsonb_object_keys(a.meta -> 'changes') k WHERE k = ANY (keys) AND (a.meta -> 'changes' -> k) <> '["(erased)", "(erased)"]'::jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION erase_audit_contacts(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_audit_contacts(text[]) TO app_school;
