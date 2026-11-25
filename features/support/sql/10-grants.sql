-- Support tables are shared with the console. A school may raise tickets, add its own messages and files,
-- mark a ticket solved, reopen it, close it and rate it. It cannot edit or delete a message, take a ticket for
-- staff, set a number, an owner or a reply time, or write a message as Triakshi staff.
REVOKE UPDATE, DELETE ON support_messages FROM app_school;
REVOKE UPDATE, DELETE ON support_files FROM app_school;
REVOKE DELETE ON support_tickets FROM app_school;
REVOKE UPDATE ON support_tickets FROM app_school;
GRANT UPDATE (status, last_message_at, updated_at, rating, rating_note, resolved_at, closed_at) ON support_tickets TO app_school;
-- Triakshi's own side, and the log of visits and notices, are read-only for a school.
REVOKE ALL ON support_notes, support_saved_replies FROM app_school;

CREATE OR REPLACE FUNCTION support_school_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' THEN
    IF TG_TABLE_NAME = 'support_messages' THEN
      NEW.author_staff_id := NULL;
      NEW.staff_name := NULL;
      NEW.told_at := NULL;
    ELSE
      NEW.number := nextval('support_ticket_number');
      NEW.assigned_staff_id := NULL;
      NEW.status := 'open';
      NEW.reply_due_at := NULL;
      NEW.first_reply_at := NULL;
      NEW.overdue_told_at := NULL;
      NEW.pending_since := NULL;
      NEW.reminded_at := NULL;
      NEW.resolved_at := NULL;
      NEW.closed_at := NULL;
      NEW.rating := NULL;
      NEW.rating_note := NULL;
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

-- What a school may do to a ticket: solved, reopen, close, rate. Only the team can put it on "waiting for you";
-- a closed ticket stays closed (the school writes a follow-up); a rating is 1 to 5 and only on a solved or closed ticket.
CREATE OR REPLACE FUNCTION support_school_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_school' THEN
    IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN RAISE EXCEPTION 'Only the support team can wait for the school'; END IF;
    IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN RAISE EXCEPTION 'A closed ticket stays closed'; END IF;
    IF NEW.rating IS DISTINCT FROM OLD.rating AND (NEW.rating < 1 OR NEW.rating > 5 OR OLD.status NOT IN ('resolved', 'closed')) THEN
      RAISE EXCEPTION 'Rate a solved ticket from 1 to 5';
    END IF;
    IF NEW.status = 'open' AND OLD.status <> 'open' THEN
      NEW.pending_since := NULL; NEW.reminded_at := NULL; NEW.resolved_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_tickets_school_update_guard ON support_tickets;
CREATE TRIGGER support_tickets_school_update_guard BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_school_update_guard();

-- A school reads help votes and writes its own; nothing is edited afterwards.
REVOKE UPDATE, DELETE ON support_views FROM app_school;
