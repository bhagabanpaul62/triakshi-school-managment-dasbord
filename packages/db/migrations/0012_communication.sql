CREATE TABLE "announcement_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"tone" text DEFAULT 'default' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
ALTER TABLE "announcement_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcement_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "announcement_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"person_key" text NOT NULL,
	"user_id" uuid,
	"student_id" uuid,
	"name" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"section_id" uuid,
	"joined_late" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"nudged_at" timestamp with time zone,
	"before_tracking" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
ALTER TABLE "announcement_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcement_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"by_name" text NOT NULL,
	"by_relation" text NOT NULL,
	"on_paper" boolean DEFAULT false NOT NULL,
	"file_key" text,
	"recorded_by" uuid,
	"ip" text
);--> statement-breakpoint
ALTER TABLE "announcement_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcement_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"draft" jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "announcement_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcement_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"note" text,
	"changed_by" uuid
);--> statement-breakpoint
ALTER TABLE "announcement_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "calendar_feeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL
);--> statement-breakpoint
ALTER TABLE "event_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"person_key" text NOT NULL,
	"user_id" uuid,
	"student_id" uuid,
	"name" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"answer" text,
	"guests" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone,
	"waiting_since" timestamp with time zone,
	"checked_in_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "event_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meeting_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"audience" jsonb NOT NULL,
	"slot_minutes" smallint DEFAULT 10 NOT NULL,
	"per_family" smallint DEFAULT 6 NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid
);--> statement-breakpoint
ALTER TABLE "meeting_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meeting_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"window_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"student_id" uuid,
	"booked_by" uuid,
	"booked_at" timestamp with time zone,
	"walk_in" boolean DEFAULT false NOT NULL,
	"visit" text,
	"private_note" text,
	"shared_remark" text,
	"reminded_day" boolean DEFAULT false NOT NULL,
	"reminded_hour" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
ALTER TABLE "meeting_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meeting_waits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"notified_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "meeting_waits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "meeting_windows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"day" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"place" text,
	"video_url" text
);--> statement-breakpoint
ALTER TABLE "meeting_windows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text NOT NULL,
	"audience_label" text NOT NULL,
	"created_by" uuid
);--> statement-breakpoint
ALTER TABLE "message_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL
);--> statement-breakpoint
ALTER TABLE "message_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid,
	"category" text NOT NULL,
	"note" text NOT NULL,
	"reported_by" uuid,
	"reporter_name" text NOT NULL,
	"about_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"outcome" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "message_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_restrictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"until" date NOT NULL,
	"lifted_at" timestamp with time zone,
	"created_by" uuid
);--> statement-breakpoint
ALTER TABLE "message_restrictions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" uuid NOT NULL,
	"report_id" uuid,
	"reviewer_id" uuid NOT NULL,
	"reviewer_name" text NOT NULL,
	"reason" text NOT NULL,
	"action" text DEFAULT 'opened' NOT NULL
);--> statement-breakpoint
ALTER TABLE "message_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"user_id" uuid
);--> statement-breakpoint
ALTER TABLE "saved_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comm_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_key" text NOT NULL,
	"notification_id" uuid,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"mode" text DEFAULT 'instant' NOT NULL,
	"priority" smallint DEFAULT 4 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"address" text,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "comm_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comm_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"audience" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by" uuid
);--> statement-breakpoint
ALTER TABLE "comm_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comm_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "comm_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"address" text NOT NULL,
	"reason" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mail_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "mail_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device" text,
	"last_ok_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"nature" text DEFAULT 'general' NOT NULL,
	"owner_user_id" uuid,
	"owner_role" text DEFAULT 'admin' NOT NULL,
	"target_days" smallint DEFAULT 3 NOT NULL,
	"escalation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "request_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"detail" text,
	"by_user_id" uuid,
	"by_name" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "request_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" uuid NOT NULL,
	"number" text NOT NULL,
	"category_id" uuid NOT NULL,
	"student_id" uuid,
	"raised_by" uuid,
	"raised_by_name" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"owner_id" uuid,
	"owner_role" text NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"linked" jsonb,
	"about_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"first_answer_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"merged_into_id" uuid,
	"solved" boolean,
	"feedback" text
);--> statement-breakpoint
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "thread_members" DROP CONSTRAINT "thread_members_user_id_users_id_fk";--> statement-breakpoint
DROP INDEX "thread_members_user";--> statement-breakpoint
-- Hand-written data steps below: never regenerate this file.
CREATE TEMP TABLE old_public AS SELECT id, 'a' AS t FROM announcements WHERE is_public AND audience = 'all' UNION ALL SELECT id, 'e' FROM events WHERE is_public AND audience = 'all';--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "audience" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "audience" SET DATA TYPE jsonb USING CASE audience
  WHEN 'all' THEN '{"include":[{"type":"everyone"}],"exclude":[]}'::jsonb
  WHEN 'staff' THEN '{"include":[{"type":"staff"}],"exclude":[]}'::jsonb
  WHEN 'class' THEN CASE WHEN class_id IS NULL THEN '{"include":[{"type":"families"}],"exclude":[]}'::jsonb ELSE jsonb_build_object('include', jsonb_build_array(jsonb_build_object('type','class','id',class_id)), 'exclude', '[]'::jsonb) END
  ELSE '{"include":[{"type":"families"}],"exclude":[]}'::jsonb END;--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "published_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "audience" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "audience" SET DATA TYPE jsonb USING CASE audience
  WHEN 'all' THEN '{"include":[{"type":"everyone"}],"exclude":[]}'::jsonb
  WHEN 'staff' THEN '{"include":[{"type":"staff"}],"exclude":[]}'::jsonb
  WHEN 'class' THEN CASE WHEN class_id IS NULL THEN '{"include":[{"type":"families"}],"exclude":[]}'::jsonb ELSE jsonb_build_object('include', jsonb_build_array(jsonb_build_object('type','class','id',class_id)), 'exclude', '[]'::jsonb) END
  ELSE '{"include":[{"type":"families"}],"exclude":[]}'::jsonb END;--> statement-breakpoint
ALTER TABLE "message_threads" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "thread_members" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "type" text DEFAULT 'notice' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "state" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "lang2" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "title2" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "body2" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "audience_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "response" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "reminders" jsonb DEFAULT '{"before":true,"onDay":true,"after":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "website" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "fanned_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "pinned_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "approval_reason" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "withdrawn_by" uuid;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "withdraw_reason" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "verify_hash" text;--> statement-breakpoint
ALTER TABLE "attendance_holidays" ADD COLUMN "kind" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_holidays" ADD COLUMN "applies_to" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_holidays" ADD COLUMN "class_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_holidays" ADD COLUMN "span_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_holidays" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "attendance_holidays" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "type" text DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "state" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "bring" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "audience_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "reminders" jsonb DEFAULT '[1440,120]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "reminded_for" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "rsvp" jsonb DEFAULT '{"on":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "consent_href" text;--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "student_id" uuid;--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "state" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "as_office" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "deliver_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "thread_members" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "thread_members" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "thread_members" ADD COLUMN "state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_members" ADD COLUMN "muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_members" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_members" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "groups" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "digest_hour" smallint DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "quiet_from" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "quiet_to" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "away_until" date;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "away_text" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "unsubscribe_hash" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "topic" text DEFAULT 'work.update' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "subject_type" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "subject_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "action" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "private_body" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Ids that point at nobody would break the new foreign keys.
UPDATE announcements SET created_by = NULL WHERE created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = created_by);--> statement-breakpoint
UPDATE events SET created_by = NULL WHERE created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = created_by);--> statement-breakpoint
UPDATE events SET owner_id = created_by;--> statement-breakpoint
-- People keep their names in old conversations.
UPDATE thread_members m SET name = u.name, role = u.role FROM users u WHERE u.id = m.user_id;--> statement-breakpoint
UPDATE thread_members SET name = 'Removed user', role = 'staff' WHERE name IS NULL;--> statement-breakpoint
UPDATE messages m SET sender_name = u.name FROM users u WHERE u.id = m.sender_id;--> statement-breakpoint
UPDATE messages SET sender_name = 'Removed user' WHERE sender_name IS NULL;--> statement-breakpoint
ALTER TABLE thread_members ALTER COLUMN name SET NOT NULL, ALTER COLUMN role SET NOT NULL;--> statement-breakpoint
ALTER TABLE messages ALTER COLUMN sender_name SET NOT NULL;--> statement-breakpoint
-- One child and staff: about that child. Staff only: staff. Anything else becomes read only.
UPDATE message_threads t SET kind = k.kind, student_id = k.student_id, state = CASE WHEN k.kind = 'legacy' THEN 'closed' ELSE 'open' END,
  closed_reason = CASE WHEN k.kind = 'legacy' THEN 'Old group conversations are read only. Start a new conversation instead.' END
FROM (
  SELECT t.id,
    CASE WHEN fam = 0 THEN 'staff' WHEN fam = 1 AND staff > 0 AND sid IS NOT NULL THEN 'student' ELSE 'legacy' END AS kind,
    CASE WHEN fam = 1 AND staff > 0 THEN sid END AS student_id
  FROM message_threads t JOIN LATERAL (
    SELECT count(*) FILTER (WHERE u.role IN ('student','parent')) AS fam, count(*) FILTER (WHERE u.role NOT IN ('student','parent')) AS staff,
      (SELECT s.id FROM students s JOIN thread_members m2 ON m2.user_id = s.user_id WHERE m2.thread_id = t.id ORDER BY s.status = 'active' DESC, s.admission_no LIMIT 1) AS sid
    FROM thread_members m JOIN users u ON u.id = m.user_id WHERE m.thread_id = t.id) x ON true) k
WHERE k.id = t.id;--> statement-breakpoint
-- Notices already posted are published; "students" and "families" are one audience now.
UPDATE announcements a SET state = 'published', fanned_out_at = published_at;--> statement-breakpoint
UPDATE announcements SET pinned_until = now() + interval '30 days' WHERE pinned;--> statement-breakpoint
UPDATE announcements SET website = true WHERE id IN (SELECT id FROM old_public WHERE t = 'a');--> statement-breakpoint
UPDATE events SET is_public = false WHERE is_public AND id NOT IN (SELECT id FROM old_public WHERE t = 'e');--> statement-breakpoint
UPDATE announcements a SET audience_label = CASE WHEN audience->'include'->0->>'type' = 'everyone' THEN 'Everyone' WHEN audience->'include'->0->>'type' = 'staff' THEN 'All staff' WHEN audience->'include'->0->>'type' = 'class' THEN coalesce((SELECT c.name FROM classes c WHERE c.id = (audience->'include'->0->>'id')::uuid), 'One class') ELSE 'All families' END;--> statement-breakpoint
UPDATE events a SET audience_label = CASE WHEN audience->'include'->0->>'type' = 'everyone' THEN 'Everyone' WHEN audience->'include'->0->>'type' = 'staff' THEN 'All staff' WHEN audience->'include'->0->>'type' = 'class' THEN coalesce((SELECT c.name FROM classes c WHERE c.id = (audience->'include'->0->>'id')::uuid), 'One class') ELSE 'All families' END;--> statement-breakpoint
-- Notifications get a topic; message and notice rows know what they are about.
UPDATE notifications n SET
  topic = CASE kind WHEN 'announcement' THEN 'notice.published' WHEN 'fee_due' THEN 'fees.due' WHEN 'result' THEN 'exam.result' WHEN 'assignment' THEN 'homework.new' WHEN 'message' THEN 'message.new' ELSE 'work.update' END,
  subject_type = CASE WHEN kind = 'message' AND href ~ 'thread=[0-9a-f-]{36}' THEN 'thread' END,
  subject_id = CASE WHEN kind = 'message' THEN substring(href from 'thread=([0-9a-f-]{36})') END,
  private_body = (kind = 'message'),
  read_at = CASE WHEN read_at IS NULL AND kind = 'message' AND EXISTS (SELECT 1 FROM thread_members m WHERE m.user_id = n.user_id AND m.thread_id::text = substring(n.href from 'thread=([0-9a-f-]{36})') AND m.last_read_at >= n.created_at) THEN now() ELSE read_at END;--> statement-breakpoint
UPDATE notification_prefs SET groups = (SELECT jsonb_object_agg(g, '{"push":true,"email":"off"}'::jsonb) FROM unnest(ARRAY['attendance','notices','messages','homework','exams','fees','services','calendar','work']) g) WHERE NOT email_digest;--> statement-breakpoint
-- Who the notices of the last 90 days were for. Nobody measured seen, so it is marked as before tracking.
INSERT INTO announcement_recipients (id, school_id, announcement_id, person_key, user_id, student_id, name, label, section_id, before_tracking, created_at)
SELECT gen_random_uuid(), a.school_id, a.id, 's:' || s.id, s.user_id, s.id, s.name, concat_ws(' ', c.name, sec.name), s.section_id, true, a.published_at
FROM announcements a JOIN students s ON s.school_id = a.school_id AND s.status = 'active' LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
WHERE a.published_at > now() - interval '90 days' AND (a.audience->'include'->0->>'type' IN ('everyone','families') OR (a.audience->'include'->0->>'type' = 'class' AND s.class_id = (a.audience->'include'->0->>'id')::uuid));--> statement-breakpoint
INSERT INTO announcement_recipients (id, school_id, announcement_id, person_key, user_id, name, label, before_tracking, created_at)
SELECT gen_random_uuid(), a.school_id, a.id, 'u:' || u.id, u.id, u.name, initcap(u.role), true, a.published_at
FROM announcements a JOIN users u ON u.school_id = a.school_id AND u.status = 'active' AND u.role NOT IN ('student','parent')
WHERE a.published_at > now() - interval '90 days' AND a.audience->'include'->0->>'type' IN ('everyone','staff');--> statement-breakpoint
-- Holidays: attendance_holidays is the only list. A past day with marks, approved leave or a processed payroll is left for the admin to decide.
CREATE TEMP TABLE holiday_days AS
SELECT e.id AS event_id, e.school_id, e.title, e.description, d::date AS day,
  EXISTS (SELECT 1 FROM attendance_holidays h WHERE h.school_id = e.school_id AND h.date = d::date) AS have,
  (d::date <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND EXISTS (SELECT 1 FROM student_attendance x WHERE x.school_id = e.school_id AND x.date = d::date))
    OR EXISTS (SELECT 1 FROM staff_attendance x WHERE x.school_id = e.school_id AND x.date = d::date)
    OR EXISTS (SELECT 1 FROM period_attendance x WHERE x.school_id = e.school_id AND x.date = d::date)
    OR EXISTS (SELECT 1 FROM leave_requests l WHERE l.school_id = e.school_id AND l.status = 'approved' AND d::date BETWEEN l.from_date AND l.to_date)
    OR EXISTS (SELECT 1 FROM pay_runs r WHERE r.school_id = e.school_id AND r.status NOT IN ('draft','cancelled') AND r.month = date_trunc('month', d)::date) AS blocked
FROM events e CROSS JOIN LATERAL generate_series((e.starts_at AT TIME ZONE 'Asia/Kolkata')::date, (coalesce(e.ends_at, e.starts_at) AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
WHERE e.is_holiday;--> statement-breakpoint
INSERT INTO attendance_holidays (id, school_id, date, name, kind, span_id, note)
SELECT DISTINCT ON (school_id, day) gen_random_uuid(), school_id, day, title, 'other', event_id, left(description, 500) FROM holiday_days WHERE NOT have AND NOT blocked ORDER BY school_id, day, title
ON CONFLICT (school_id, date) DO NOTHING;--> statement-breakpoint
INSERT INTO notifications (id, school_id, user_id, topic, title, body, href)
SELECT gen_random_uuid(), h.school_id, u.id, 'work.update', 'Check these holidays', 'Some days of "' || h.title || '" already have attendance, leave or payroll (' || string_agg(to_char(h.day, 'DD Mon'), ', ' ORDER BY h.day) || '), so they were not made holidays. Add them only if the school was closed.', '/app/attendance/holidays'
FROM holiday_days h JOIN users u ON u.school_id = h.school_id AND u.role = 'admin' AND u.status = 'active' WHERE h.blocked AND NOT h.have GROUP BY h.school_id, h.title, u.id;--> statement-breakpoint
DELETE FROM events e WHERE e.is_holiday AND NOT EXISTS (SELECT 1 FROM holiday_days h WHERE h.event_id = e.id AND h.blocked AND NOT h.have);--> statement-breakpoint
-- People of live and coming events.
INSERT INTO event_people (id, school_id, event_id, person_key, user_id, student_id, name, label)
SELECT gen_random_uuid(), e.school_id, e.id, 's:' || s.id, s.user_id, s.id, s.name, concat_ws(' ', c.name, sec.name)
FROM events e JOIN students s ON s.school_id = e.school_id AND s.status = 'active' LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
WHERE coalesce(e.ends_at, e.starts_at) > now() - interval '400 days' AND (e.audience->'include'->0->>'type' IN ('everyone','families') OR (e.audience->'include'->0->>'type' = 'class' AND s.class_id = (e.audience->'include'->0->>'id')::uuid));--> statement-breakpoint
INSERT INTO event_people (id, school_id, event_id, person_key, user_id, name, label)
SELECT gen_random_uuid(), e.school_id, e.id, 'u:' || u.id, u.id, u.name, initcap(u.role)
FROM events e JOIN users u ON u.school_id = e.school_id AND u.status = 'active' AND u.role NOT IN ('student','parent') WHERE coalesce(e.ends_at, e.starts_at) > now() - interval '400 days' AND e.audience->'include'->0->>'type' IN ('everyone','staff');--> statement-breakpoint
-- Reminders already due are not sent for old events.
UPDATE events SET reminded_for = reminders WHERE starts_at < now() + interval '1 day';--> statement-breakpoint
-- Custom roles: write became draft and publish; everyone reads notices and the calendar and may raise requests.
UPDATE school_roles SET grants = array_cat(array_remove(grants, 'announcements:write'), ARRAY['announcements:draft','announcements:publish']) WHERE 'announcements:write' = ANY(grants);--> statement-breakpoint
UPDATE school_roles SET grants = array_remove(grants, 'notifications:send');--> statement-breakpoint
-- Schools that already have the ready-made roles get the new ones once; Front office no longer publishes by itself.
UPDATE school_roles SET grants = array_cat(array_remove(grants, 'announcements:publish'), ARRAY['requests:office','meetings:use']), description = 'Looks up students, answers enquiries and posts notices.' WHERE is_template AND name = 'Front office';--> statement-breakpoint
INSERT INTO school_roles (id, school_id, name, description, base, is_template, grants) SELECT gen_random_uuid(), s.school_id, r.name, r.description, 'staff', true, array_cat(ARRAY['home:view','notifications:read','messages:use','settings:read','payroll:self','announcements:read','events:read','requests:use'], r.grants) FROM (SELECT DISTINCT school_id FROM school_roles WHERE is_template) s CROSS JOIN (VALUES ('Safeguarding lead', 'Reviews reported conversations. Sees student details, nothing else.', ARRAY['messages:safeguard','students:read']), ('Coordinator', 'Writes and publishes notices, approves others, runs events and the requests inbox.', ARRAY['announcements:draft','announcements:publish','announcements:approve','events:write','requests:office','students:read','academics:read'])) AS r(name, description, grants) ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE school_roles SET grants = (SELECT array_agg(DISTINCT g ORDER BY g) FROM unnest(array_cat(grants, ARRAY['announcements:read','events:read','requests:use'])) g);--> statement-breakpoint
ALTER TABLE "announcement_files" ADD CONSTRAINT "announcement_files_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_responses" ADD CONSTRAINT "announcement_responses_recipient_id_announcement_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."announcement_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_versions" ADD CONSTRAINT "announcement_versions_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_files" ADD CONSTRAINT "event_files_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_days" ADD CONSTRAINT "meeting_days_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_slots" ADD CONSTRAINT "meeting_slots_meeting_id_meeting_days_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_days"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_slots" ADD CONSTRAINT "meeting_slots_window_id_meeting_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."meeting_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_slots" ADD CONSTRAINT "meeting_slots_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_slots" ADD CONSTRAINT "meeting_slots_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_waits" ADD CONSTRAINT "meeting_waits_meeting_id_meeting_days_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_waits" ADD CONSTRAINT "meeting_waits_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_waits" ADD CONSTRAINT "meeting_waits_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_windows" ADD CONSTRAINT "meeting_windows_meeting_id_meeting_days_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_windows" ADD CONSTRAINT "meeting_windows_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_batches" ADD CONSTRAINT "message_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_files" ADD CONSTRAINT "message_files_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_restrictions" ADD CONSTRAINT "message_restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reviews" ADD CONSTRAINT "message_reviews_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_deliveries" ADD CONSTRAINT "comm_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_deliveries" ADD CONSTRAINT "comm_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_groups" ADD CONSTRAINT "comm_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_categories" ADD CONSTRAINT "request_categories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_category_id_request_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."request_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_categories_school_idx" ON "announcement_categories" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_categories_name" ON "announcement_categories" USING btree ("school_id",lower("name"));--> statement-breakpoint
CREATE INDEX "announcement_files_school_idx" ON "announcement_files" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "announcement_files_notice" ON "announcement_files" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "announcement_recipients_school_idx" ON "announcement_recipients" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_recipients_once" ON "announcement_recipients" USING btree ("announcement_id","person_key");--> statement-breakpoint
CREATE INDEX "announcement_recipients_user" ON "announcement_recipients" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "announcement_responses_school_idx" ON "announcement_responses" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_responses_recipient" ON "announcement_responses" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "announcement_templates_school_idx" ON "announcement_templates" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_templates_name" ON "announcement_templates" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "announcement_versions_school_idx" ON "announcement_versions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_versions_unique" ON "announcement_versions" USING btree ("announcement_id","version");--> statement-breakpoint
CREATE INDEX "calendar_feeds_school_idx" ON "calendar_feeds" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_user" ON "calendar_feeds" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_token" ON "calendar_feeds" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "calendar_feeds_used" ON "calendar_feeds" USING btree ("school_id","last_used_at");--> statement-breakpoint
CREATE INDEX "event_files_school_idx" ON "event_files" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "event_files_event" ON "event_files" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_people_school_idx" ON "event_people" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_people_once" ON "event_people" USING btree ("event_id","person_key");--> statement-breakpoint
CREATE INDEX "event_people_user" ON "event_people" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "meeting_days_school_idx" ON "meeting_days" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "meeting_days_state" ON "meeting_days" USING btree ("school_id","state");--> statement-breakpoint
CREATE INDEX "meeting_slots_school_idx" ON "meeting_slots" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "meeting_slots_meeting" ON "meeting_slots" USING btree ("meeting_id","teacher_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_slots_teacher_time" ON "meeting_slots" USING btree ("teacher_id","starts_at") WHERE "meeting_slots"."state" <> 'removed' and not "meeting_slots"."walk_in";--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_slots_child_teacher" ON "meeting_slots" USING btree ("meeting_id","teacher_id","student_id") WHERE "meeting_slots"."state" = 'booked';--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_slots_child_time" ON "meeting_slots" USING btree ("student_id","starts_at") WHERE "meeting_slots"."state" = 'booked';--> statement-breakpoint
CREATE INDEX "meeting_waits_school_idx" ON "meeting_waits" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_waits_unique" ON "meeting_waits" USING btree ("meeting_id","teacher_id","student_id");--> statement-breakpoint
CREATE INDEX "meeting_windows_school_idx" ON "meeting_windows" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "meeting_windows_meeting" ON "meeting_windows" USING btree ("meeting_id","teacher_id");--> statement-breakpoint
CREATE INDEX "message_batches_school_idx" ON "message_batches" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "message_batches_creator" ON "message_batches" USING btree ("school_id","created_by");--> statement-breakpoint
CREATE INDEX "message_files_school_idx" ON "message_files" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "message_files_message" ON "message_files" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_reports_school_idx" ON "message_reports" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "message_reports_state" ON "message_reports" USING btree ("school_id","state");--> statement-breakpoint
CREATE INDEX "message_restrictions_school_idx" ON "message_restrictions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "message_restrictions_user" ON "message_restrictions" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "message_reviews_school_idx" ON "message_reviews" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "message_reviews_time" ON "message_reviews" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "saved_replies_school_idx" ON "saved_replies" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "saved_replies_user" ON "saved_replies" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "comm_deliveries_school_idx" ON "comm_deliveries" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comm_deliveries_once" ON "comm_deliveries" USING btree ("school_id","source_key","user_id","channel");--> statement-breakpoint
CREATE INDEX "comm_deliveries_due" ON "comm_deliveries" USING btree ("state","next_at","priority");--> statement-breakpoint
CREATE INDEX "comm_deliveries_notification" ON "comm_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "comm_groups_school_idx" ON "comm_groups" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comm_groups_name" ON "comm_groups" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "comm_settings_school_idx" ON "comm_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comm_settings_school" ON "comm_settings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "email_suppressions_school_idx" ON "email_suppressions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_address" ON "email_suppressions" USING btree ("school_id",lower("address"));--> statement-breakpoint
CREATE INDEX "mail_usage_school_idx" ON "mail_usage" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_usage_day" ON "mail_usage" USING btree ("school_id","day");--> statement-breakpoint
CREATE INDEX "push_subscriptions_school_idx" ON "push_subscriptions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user" ON "push_subscriptions" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "request_categories_school_idx" ON "request_categories" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_categories_name" ON "request_categories" USING btree ("school_id",lower("name"));--> statement-breakpoint
CREATE INDEX "request_events_school_idx" ON "request_events" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "request_events_request" ON "request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "requests_school_idx" ON "requests" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_number" ON "requests" USING btree ("school_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_thread" ON "requests" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "requests_queue" ON "requests" USING btree ("school_id","state","due_at");--> statement-breakpoint
CREATE INDEX "requests_owner" ON "requests" USING btree ("school_id","owner_id");--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_category_id_announcement_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."announcement_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_batch_id_message_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."message_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_state" ON "announcements" USING btree ("school_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_number" ON "announcements" USING btree ("school_id","number");--> statement-breakpoint
CREATE INDEX "announcements_verify" ON "announcements" USING btree ("verify_hash");--> statement-breakpoint
CREATE INDEX "events_series" ON "events" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "message_threads_student" ON "message_threads" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "message_threads_batch" ON "message_threads" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "messages_sender" ON "messages" USING btree ("school_id","sender_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client" ON "messages" USING btree ("school_id","sender_id","client_id");--> statement-breakpoint
CREATE INDEX "notification_prefs_unsub" ON "notification_prefs" USING btree ("unsubscribe_hash");--> statement-breakpoint
CREATE INDEX "notifications_subject" ON "notifications" USING btree ("school_id","subject_type","subject_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_unread" ON "notifications" USING btree ("school_id","user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_open_action" ON "notifications" USING btree ("school_id","user_id") WHERE "notifications"."action" and "notifications"."done_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_group_open" ON "notifications" USING btree ("school_id","user_id","group_key") WHERE "notifications"."group_key" is not null and "notifications"."read_at" is null and "notifications"."done_at" is null;--> statement-breakpoint
CREATE INDEX "thread_members_user" ON "thread_members" USING btree ("school_id","user_id");--> statement-breakpoint
ALTER TABLE "announcements" DROP COLUMN "class_id";--> statement-breakpoint
ALTER TABLE "announcements" DROP COLUMN "is_public";--> statement-breakpoint
ALTER TABLE "announcements" DROP COLUMN "pinned";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "class_id";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "is_holiday";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "tone";--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP COLUMN "email_digest";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "digest_sent_at";--> statement-breakpoint
CREATE POLICY "announcement_categories_school_isolation" ON "announcement_categories" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "announcement_files_school_isolation" ON "announcement_files" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "announcement_recipients_school_isolation" ON "announcement_recipients" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "announcement_responses_school_isolation" ON "announcement_responses" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "announcement_templates_school_isolation" ON "announcement_templates" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "announcement_versions_school_isolation" ON "announcement_versions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "calendar_feeds_school_isolation" ON "calendar_feeds" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_files_school_isolation" ON "event_files" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_people_school_isolation" ON "event_people" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "meeting_days_school_isolation" ON "meeting_days" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "meeting_slots_school_isolation" ON "meeting_slots" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "meeting_waits_school_isolation" ON "meeting_waits" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "meeting_windows_school_isolation" ON "meeting_windows" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_batches_school_isolation" ON "message_batches" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_files_school_isolation" ON "message_files" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_reports_school_isolation" ON "message_reports" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_restrictions_school_isolation" ON "message_restrictions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_reviews_school_isolation" ON "message_reviews" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "saved_replies_school_isolation" ON "saved_replies" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comm_deliveries_school_isolation" ON "comm_deliveries" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comm_groups_school_isolation" ON "comm_groups" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "comm_settings_school_isolation" ON "comm_settings" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "email_suppressions_school_isolation" ON "email_suppressions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mail_usage_school_isolation" ON "mail_usage" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "push_subscriptions_school_isolation" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "request_categories_school_isolation" ON "request_categories" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "request_events_school_isolation" ON "request_events" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "requests_school_isolation" ON "requests" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
DROP TABLE old_public;--> statement-breakpoint
DROP TABLE holiday_days;
