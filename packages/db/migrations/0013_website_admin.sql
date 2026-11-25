CREATE SEQUENCE "public"."support_ticket_number" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"identifier" text NOT NULL,
	"outcome" text NOT NULL,
	"method" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"new_device" boolean DEFAULT false NOT NULL,
	"support_staff_id" uuid
);
--> statement-breakpoint
ALTER TABLE "login_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tone" text DEFAULT 'info' NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"plan_key" text,
	"school_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_domain_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain_id" uuid,
	"hostname" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"by_name" text
);
--> statement-breakpoint
ALTER TABLE "school_domain_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "school_setup_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"percent" integer NOT NULL,
	"done" integer NOT NULL,
	"total" integer NOT NULL,
	"next_key" text,
	"next_label" text,
	"last_login_at" timestamp with time zone,
	"students" integer DEFAULT 0 NOT NULL,
	"first_attendance_on" text,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_setup_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_saved_replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"article" text NOT NULL,
	"useful" boolean
);
--> statement-breakpoint
ALTER TABLE "support_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_id" uuid NOT NULL,
	"staff_name" text NOT NULL,
	"as_user_id" uuid NOT NULL,
	"as_user_name" text NOT NULL,
	"reason" text NOT NULL,
	"read_only" boolean NOT NULL,
	"emergency" boolean DEFAULT false NOT NULL,
	"entered_at" timestamp with time zone,
	"told_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "support_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "privacy_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"subject_name" text NOT NULL,
	"raised_by" uuid,
	"raised_by_name" text NOT NULL,
	"contact" text,
	"details" text NOT NULL,
	"due_on" date NOT NULL,
	"owner_id" uuid,
	"outcome" text,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"reminded_on" date,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "setup_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"assigned_to" uuid,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"skipped_by" uuid,
	"skip_reason" text
);
--> statement-breakpoint
ALTER TABLE "setup_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enquiry_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_user_id" uuid,
	"by_name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiry_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enquiry_seats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session" text NOT NULL,
	"class_name" text NOT NULL,
	"seats" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiry_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enquiry_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiry_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enquiry_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"due_at" timestamp with time zone NOT NULL,
	"owner_id" uuid,
	"done_at" timestamp with time zone,
	"outcome" text,
	"reminded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "enquiry_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_disclosure" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL,
	"updated_by" uuid,
	"warned" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_disclosure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"alt" text,
	"replaced_key" text,
	"uploaded_by" uuid
);
--> statement-breakpoint
ALTER TABLE "site_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_page_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"path" text NOT NULL,
	"origin" text NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_page_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_redirects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"template_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"name" text,
	"changes" text[] DEFAULT '{}'::text[] NOT NULL,
	"by_user_id" uuid,
	"by_name" text
);
--> statement-breakpoint
ALTER TABLE "site_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "school_domains_hostname";--> statement-breakpoint
ALTER TABLE "school_domains" ADD COLUMN "health" text;--> statement-breakpoint
ALTER TABLE "school_domains" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_domains" ADD COLUMN "txt_missing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_domains" ADD COLUMN "records" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "school_domains" ADD COLUMN "cert_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_domains" ADD COLUMN "dns_provider" text;--> statement-breakpoint
ALTER TABLE "school_domains" ADD COLUMN "told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "affiliation_no" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "school_code" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "school_type" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "medium" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "established_year" integer;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "head_name" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "head_qualification" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "support_access" text DEFAULT 'always' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "support_access_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "redirect_to_primary" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "staff_name" text;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "number" integer DEFAULT nextval('support_ticket_number') NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "category" text DEFAULT 'question' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "context" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "follow_up_of" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reply_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "first_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "overdue_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rating_note" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alert_new_device" boolean;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "tables_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "tables_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_exports" ADD COLUMN "downloads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "kind" text DEFAULT 'admission' NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "session" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "previous_school" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "relation" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "phone_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "alt_phone" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "page_path" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "consent_text" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "stage_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "reached" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "first_contact_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "call_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "late_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "draft_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "draft_by" uuid;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "published_by" uuid;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "scheduled" jsonb;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "scheduled_template_key" text;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "scheduled_by" uuid;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "asked_by" uuid;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "asked_note" text;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "offline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school_sites" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "support_files" ADD CONSTRAINT "support_files_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_files" ADD CONSTRAINT "support_files_message_id_support_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."support_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_files" ADD CONSTRAINT "privacy_files_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_events" ADD CONSTRAINT "enquiry_events_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_tasks" ADD CONSTRAINT "enquiry_tasks_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- DATA STEPS (hand-written, never regenerate): they run before the new unique indexes.
-- Enquiries: the phone key, how far each got, and a reference per calendar year (IST) in the order they came.
UPDATE enquiries SET phone_key = right(regexp_replace(phone, '\D', '', 'g'), 10), stage_at = updated_at,
  reached = CASE WHEN status = 'closed' THEN 'new' ELSE status END,
  close_reason = CASE WHEN status = 'closed' THEN 'Not recorded' END,
  first_contact_at = CASE WHEN status <> 'new' THEN updated_at END;--> statement-breakpoint
UPDATE enquiries e SET ref = 'E-' || r.y || '-' || lpad(r.n::text, 4, '0')
  FROM (SELECT id, to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY') AS y,
          row_number() OVER (PARTITION BY school_id, to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY') ORDER BY created_at, id) AS n FROM enquiries) r
 WHERE r.id = e.id;--> statement-breakpoint
INSERT INTO sequences (id, school_id, key, value)
  SELECT gen_random_uuid(), school_id, 'enquiry:' || to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY'), count(*)::int FROM enquiries GROUP BY 2, 3
  ON CONFLICT (school_id, key) DO NOTHING;--> statement-breakpoint
INSERT INTO enquiry_events (id, school_id, created_at, updated_at, enquiry_id, kind, body, by_name)
  SELECT gen_random_uuid(), school_id, created_at, created_at, id, 'created', NULL, 'System' FROM enquiries
  UNION ALL
  SELECT gen_random_uuid(), school_id, updated_at, updated_at, id, 'note', notes, 'System' FROM enquiries WHERE coalesce(btrim(notes), '') <> '';--> statement-breakpoint
-- Version 1 of every live website. Sites already public keep naming their teachers.
INSERT INTO site_versions (id, school_id, created_at, updated_at, number, kind, template_key, content, changes, by_name)
  SELECT gen_random_uuid(), school_id, coalesce(published_at, now()), coalesce(published_at, now()), 1, 'publish', coalesce(published_template_key, template_key), published,
         ARRAY['The live website when versions began'], 'System' FROM school_sites WHERE published IS NOT NULL;--> statement-breakpoint
UPDATE school_sites SET settings = '{"teachersChecked": true}'::jsonb WHERE published IS NOT NULL;--> statement-breakpoint
-- Old tickets: numbers in the order they came, and nothing about them is told again.
UPDATE support_tickets t SET number = 1000 + r.n FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM support_tickets) r WHERE r.id = t.id;--> statement-breakpoint
SELECT setval('support_ticket_number', greatest(1001, (SELECT coalesce(max(number), 1000) + 1 FROM support_tickets)), false);--> statement-breakpoint
UPDATE support_tickets t SET reply_due_at = t.created_at, overdue_told_at = now(), reminded_at = CASE WHEN t.status = 'pending' THEN now() END,
  first_reply_at = (SELECT min(m.created_at) FROM support_messages m WHERE m.ticket_id = t.id AND m.author_staff_id IS NOT NULL),
  pending_since = CASE WHEN t.status = 'pending' THEN t.updated_at END,
  resolved_at = CASE WHEN t.status = 'resolved' THEN t.updated_at END, closed_at = CASE WHEN t.status = 'closed' THEN t.updated_at END;--> statement-breakpoint
UPDATE support_messages m SET told_at = now(), staff_name = coalesce(p.name, 'Triakshi support') FROM support_messages x LEFT JOIN platform_staff p ON p.id = x.author_staff_id
 WHERE x.id = m.id AND m.author_staff_id IS NOT NULL;--> statement-breakpoint
-- Old export files follow the new keeping time.
UPDATE data_exports SET expires_at = now() + interval '7 days' WHERE file_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "login_events_school_idx" ON "login_events" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "login_events_school_time" ON "login_events" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "login_events_user" ON "login_events" USING btree ("school_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_notices_time" ON "platform_notices" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "school_domain_events_school_idx" ON "school_domain_events" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "school_domain_events_domain" ON "school_domain_events" USING btree ("school_id","domain_id","created_at");--> statement-breakpoint
CREATE INDEX "school_setup_status_school_idx" ON "school_setup_status" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_setup_status_school" ON "school_setup_status" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "support_files_school_idx" ON "support_files" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "support_files_ticket" ON "support_files" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_notes_ticket" ON "support_notes" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_views_school_idx" ON "support_views" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "support_views_article" ON "support_views" USING btree ("article");--> statement-breakpoint
CREATE INDEX "support_visits_school_idx" ON "support_visits" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "support_visits_time" ON "support_visits" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "account_settings_school_idx" ON "account_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_settings_school" ON "account_settings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "privacy_files_school_idx" ON "privacy_files" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "privacy_files_request" ON "privacy_files" USING btree ("school_id","request_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_school_idx" ON "privacy_requests" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_state" ON "privacy_requests" USING btree ("school_id","state","due_on");--> statement-breakpoint
CREATE INDEX "setup_tasks_school_idx" ON "setup_tasks" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_tasks_key" ON "setup_tasks" USING btree ("school_id","key");--> statement-breakpoint
CREATE INDEX "enquiry_events_school_idx" ON "enquiry_events" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "enquiry_events_enquiry" ON "enquiry_events" USING btree ("enquiry_id","created_at");--> statement-breakpoint
CREATE INDEX "enquiry_seats_school_idx" ON "enquiry_seats" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiry_seats_key" ON "enquiry_seats" USING btree ("school_id","session","class_name");--> statement-breakpoint
CREATE INDEX "enquiry_settings_school_idx" ON "enquiry_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiry_settings_school" ON "enquiry_settings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "enquiry_tasks_school_idx" ON "enquiry_tasks" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "enquiry_tasks_enquiry" ON "enquiry_tasks" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "enquiry_tasks_due" ON "enquiry_tasks" USING btree ("school_id","due_at") WHERE "enquiry_tasks"."done_at" is null;--> statement-breakpoint
CREATE INDEX "site_disclosure_school_idx" ON "site_disclosure" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_disclosure_school" ON "site_disclosure" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "site_media_school_idx" ON "site_media" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_media_key" ON "site_media" USING btree ("school_id","file_key");--> statement-breakpoint
CREATE INDEX "site_page_days_school_idx" ON "site_page_days" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_page_days_key" ON "site_page_days" USING btree ("school_id","day","path","origin");--> statement-breakpoint
CREATE INDEX "site_redirects_school_idx" ON "site_redirects" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_redirects_from" ON "site_redirects" USING btree ("school_id","from_path");--> statement-breakpoint
CREATE INDEX "site_versions_school_idx" ON "site_versions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_versions_number" ON "site_versions" USING btree ("school_id","number");--> statement-breakpoint
CREATE INDEX "audit_school_module" ON "audit_logs" USING btree ("school_id","module","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "school_domains_verified_hostname" ON "school_domains" USING btree ("hostname") WHERE "school_domains"."status" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "school_domains_school_hostname" ON "school_domains" USING btree ("school_id","hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_number" ON "support_tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "support_tickets_status" ON "support_tickets" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "enquiries_next" ON "enquiries" USING btree ("school_id","next_at");--> statement-breakpoint
CREATE INDEX "enquiries_phone" ON "enquiries" USING btree ("school_id","phone_key");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_ref" ON "enquiries" USING btree ("school_id","ref");--> statement-breakpoint
CREATE POLICY "login_events_school_isolation" ON "login_events" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "school_domain_events_school_isolation" ON "school_domain_events" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "school_setup_status_school_isolation" ON "school_setup_status" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "support_files_school_isolation" ON "support_files" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "support_views_school_isolation" ON "support_views" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "support_visits_school_isolation" ON "support_visits" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "account_settings_school_isolation" ON "account_settings" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "privacy_files_school_isolation" ON "privacy_files" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "privacy_requests_school_isolation" ON "privacy_requests" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "setup_tasks_school_isolation" ON "setup_tasks" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "enquiry_events_school_isolation" ON "enquiry_events" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "enquiry_seats_school_isolation" ON "enquiry_seats" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "enquiry_settings_school_isolation" ON "enquiry_settings" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "enquiry_tasks_school_isolation" ON "enquiry_tasks" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "site_disclosure_school_isolation" ON "site_disclosure" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "site_media_school_isolation" ON "site_media" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "site_page_days_school_isolation" ON "site_page_days" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "site_redirects_school_isolation" ON "site_redirects" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "site_versions_school_isolation" ON "site_versions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);