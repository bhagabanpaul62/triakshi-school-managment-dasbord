-- Support tables are shared with the console. A school may raise tickets, add its own messages and close/reopen,
-- but it cannot edit or delete messages, take a ticket for staff, or write a message as Triakshi staff.
REVOKE UPDATE, DELETE ON support_messages FROM app_school;
REVOKE DELETE ON support_tickets FROM app_school;
REVOKE UPDATE ON support_tickets FROM app_school;
GRANT UPDATE (status, last_message_at, updated_at) ON support_tickets TO app_school;

CREATE OR REPLACE FUNCTION support_school_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' THEN
    IF TG_TABLE_NAME = 'support_messages' THEN
      NEW.author_staff_id := NULL;
    ELSE
      NEW.assigned_staff_id := NULL;
      NEW.status := 'open';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_messages_school_guard ON support_messages;
CREATE TRIGGER support_messages_school_guard BEFORE INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION support_school_insert_guard();
DROP TRIGGER IF EXISTS support_tickets_school_guard ON support_tickets;
CREATE TRIGGER support_tickets_school_guard BEFORE INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_school_insert_guard();
