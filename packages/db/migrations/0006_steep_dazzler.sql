CREATE TABLE "period_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"date" date NOT NULL,
	"period_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"slot_id" uuid,
	"block_slot_id" uuid,
	"option_id" uuid,
	"status" text NOT NULL,
	"marked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "period_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_block_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"block_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"room_id" uuid
);
--> statement-breakpoint
ALTER TABLE "tt_block_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_block_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"period_id" uuid NOT NULL,
	"locked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tt_block_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_id" uuid NOT NULL,
	"name" text NOT NULL,
	"periods_per_week" integer NOT NULL,
	"doubles" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tt_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "substitutions" ALTER COLUMN "slot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "academic_years" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "board_override" text;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "medium" text;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "shift" text;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "stream_label" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "type" text DEFAULT 'theory' NOT NULL;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "max_marks_theory" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "max_marks_practical" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "board_code" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "tone" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "is_language" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "mode" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "rollup_percent" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "block_slot_id" uuid;--> statement-breakpoint
ALTER TABLE "substitutions" ADD COLUMN "option_id" uuid;--> statement-breakpoint
ALTER TABLE "period_attendance" ADD CONSTRAINT "period_attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_attendance" ADD CONSTRAINT "period_attendance_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_attendance" ADD CONSTRAINT "period_attendance_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_attendance" ADD CONSTRAINT "period_attendance_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_attendance" ADD CONSTRAINT "period_attendance_slot_id_timetable_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_attendance" ADD CONSTRAINT "period_attendance_block_slot_id_tt_block_slots_id_fk" FOREIGN KEY ("block_slot_id") REFERENCES "public"."tt_block_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_attendance" ADD CONSTRAINT "period_attendance_option_id_tt_block_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."tt_block_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_block_options" ADD CONSTRAINT "tt_block_options_block_id_tt_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."tt_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_block_options" ADD CONSTRAINT "tt_block_options_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_block_options" ADD CONSTRAINT "tt_block_options_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_block_options" ADD CONSTRAINT "tt_block_options_room_id_tt_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."tt_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_block_slots" ADD CONSTRAINT "tt_block_slots_version_id_tt_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."tt_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_block_slots" ADD CONSTRAINT "tt_block_slots_block_id_tt_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."tt_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_block_slots" ADD CONSTRAINT "tt_block_slots_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_blocks" ADD CONSTRAINT "tt_blocks_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_attendance_school_idx" ON "period_attendance" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "period_attendance_student_date_period" ON "period_attendance" USING btree ("student_id","date","period_id");--> statement-breakpoint
CREATE INDEX "period_attendance_section_date" ON "period_attendance" USING btree ("school_id","section_id","date");--> statement-breakpoint
CREATE INDEX "period_attendance_subject" ON "period_attendance" USING btree ("school_id","subject_id","date");--> statement-breakpoint
CREATE INDEX "tt_block_options_school_idx" ON "tt_block_options" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_block_options_subject" ON "tt_block_options" USING btree ("block_id","subject_id");--> statement-breakpoint
CREATE INDEX "tt_block_slots_school_idx" ON "tt_block_slots" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_block_slots_cell" ON "tt_block_slots" USING btree ("version_id","block_id","day_of_week","period_id");--> statement-breakpoint
CREATE INDEX "tt_blocks_school_idx" ON "tt_blocks" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_blocks_name" ON "tt_blocks" USING btree ("class_id","name");--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_block_slot_id_tt_block_slots_id_fk" FOREIGN KEY ("block_slot_id") REFERENCES "public"."tt_block_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_option_id_tt_block_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."tt_block_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "substitutions_block_date" ON "substitutions" USING btree ("block_slot_id","option_id","date");--> statement-breakpoint
CREATE POLICY "period_attendance_school_isolation" ON "period_attendance" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_block_options_school_isolation" ON "tt_block_options" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_block_slots_school_isolation" ON "tt_block_slots" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_blocks_school_isolation" ON "tt_blocks" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- Existing classes keep their order (by grade); terms get their order within the year by start date.
UPDATE "classes" SET "display_order" = "grade";--> statement-breakpoint
UPDATE "terms" t SET "sort_order" = r.n FROM (SELECT "id", row_number() OVER (PARTITION BY "year_id" ORDER BY "starts_on", "id")::int AS n FROM "terms") r WHERE r."id" = t."id";
