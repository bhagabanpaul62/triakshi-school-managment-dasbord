-- Safety rules the application cannot bend. Re-applied after every migrate; idempotent.
-- Cascades from deleting a conversation or a school run as the table owner, so the guards below only bind the app roles.

-- The review log: who opened a conversation they are not in, when and why. Nobody edits or deletes it.
REVOKE UPDATE, DELETE ON message_reviews FROM app_school, app_console;
-- A report keeps what was said and who it is about; only its handling changes.
REVOKE UPDATE, DELETE ON message_reports FROM app_school, app_console;
GRANT UPDATE (state, outcome, handled_by, handled_at, updated_at) ON message_reports TO app_school, app_console;
-- A message is never edited. It can be removed (the original stays) and never deleted by the app.
REVOKE UPDATE, DELETE ON messages FROM app_school, app_console;
GRANT UPDATE (removed_at, removed_by, updated_at) ON messages TO app_school, app_console;
REVOKE DELETE ON message_files, message_restrictions FROM app_school, app_console;

CREATE OR REPLACE FUNCTION messages_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('app_school', 'app_console') THEN
    RAISE EXCEPTION '% is append only', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS message_reviews_append_only ON message_reviews;
CREATE TRIGGER message_reviews_append_only BEFORE UPDATE OR DELETE ON message_reviews FOR EACH ROW EXECUTE FUNCTION messages_append_only();

-- A report text never changes.
CREATE OR REPLACE FUNCTION message_reports_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('app_school', 'app_console') AND (
       NEW.note IS DISTINCT FROM OLD.note OR NEW.category IS DISTINCT FROM OLD.category OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
       OR NEW.message_id IS DISTINCT FROM OLD.message_id OR NEW.about_user_ids IS DISTINCT FROM OLD.about_user_ids OR NEW.reported_by IS DISTINCT FROM OLD.reported_by) THEN
    RAISE EXCEPTION 'a report cannot be changed, only handled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS message_reports_fixed ON message_reports;
CREATE TRIGGER message_reports_fixed BEFORE UPDATE ON message_reports FOR EACH ROW EXECUTE FUNCTION message_reports_fixed();

-- A message can be marked removed (the original stays) but never changed. A held conversation (one that was reported) also keeps every row and every removal.
CREATE OR REPLACE FUNCTION messages_held_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'a message cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.removed_at IS NOT NULL AND NEW.removed_at IS DISTINCT FROM OLD.removed_at)) AND
     EXISTS (SELECT 1 FROM message_threads t WHERE t.id = OLD.thread_id AND t.held_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this conversation is held for review' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS messages_held_guard ON messages;
CREATE TRIGGER messages_held_guard BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION messages_held_guard();

-- One family per conversation, whatever path adds a member. The thread row is locked so two parallel adds cannot both pass.
CREATE OR REPLACE FUNCTION thread_one_family() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t_kind text; fam int;
BEGIN
  SELECT kind INTO t_kind FROM message_threads WHERE id = NEW.thread_id FOR UPDATE;
  IF t_kind IS NULL OR t_kind = 'legacy' THEN RETURN NEW; END IF;
  SELECT count(*) INTO fam FROM (
    SELECT m.user_id FROM thread_members m JOIN users u ON u.id = m.user_id WHERE m.thread_id = NEW.thread_id AND u.role IN ('student', 'parent')
    UNION SELECT u.id FROM users u WHERE u.id = NEW.user_id AND u.role IN ('student', 'parent')) x;
  IF (t_kind = 'staff' AND fam > 0) OR fam > 1 THEN
    RAISE EXCEPTION 'a conversation can have only one family' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS thread_members_one_family ON thread_members;
CREATE TRIGGER thread_members_one_family BEFORE INSERT ON thread_members FOR EACH ROW EXECUTE FUNCTION thread_one_family();
