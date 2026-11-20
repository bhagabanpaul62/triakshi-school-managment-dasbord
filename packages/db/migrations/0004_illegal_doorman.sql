CREATE TABLE "house_points" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"house_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"awarded_by" uuid,
	"awarded_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "house_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "houses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"tone" text DEFAULT 'default' NOT NULL,
	"captain_student_id" uuid
);
--> statement-breakpoint
ALTER TABLE "houses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_houses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"house_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_houses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"group_id" uuid
);
--> statement-breakpoint
ALTER TABLE "student_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject_group_subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"group_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subject_group_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subject_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assignment_extensions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"granted_by" uuid
);
--> statement-breakpoint
ALTER TABLE "assignment_extensions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "submission_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submission_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "absence_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_condonations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"file_key" text,
	"file_name" text,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "attendance_condonations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"threshold_percent" integer DEFAULT 75 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"student_id" uuid,
	"user_id" uuid,
	"requested_by" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"file_key" text,
	"file_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "book_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"book_id" uuid NOT NULL,
	"student_id" uuid,
	"user_id" uuid,
	"status" text DEFAULT 'waiting' NOT NULL,
	"ready_until" date
);
--> statement-breakpoint
ALTER TABLE "book_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "library_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"loan_days" integer DEFAULT 14 NOT NULL,
	"student_limit" integer DEFAULT 2 NOT NULL,
	"staff_limit" integer DEFAULT 5 NOT NULL,
	"fine_per_day_paise" integer DEFAULT 200 NOT NULL,
	"renewals_allowed" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD COLUMN "is_elective" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "renewals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "fine_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "last_reminder_on" date;--> statement-breakpoint
ALTER TABLE "house_points" ADD CONSTRAINT "house_points_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_points" ADD CONSTRAINT "house_points_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_houses" ADD CONSTRAINT "student_houses_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_group_id_subject_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."subject_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_group_subjects" ADD CONSTRAINT "subject_group_subjects_group_id_subject_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."subject_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_group_subjects" ADD CONSTRAINT "subject_group_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_groups" ADD CONSTRAINT "subject_groups_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_alerts" ADD CONSTRAINT "absence_alerts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_condonations" ADD CONSTRAINT "attendance_condonations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_condonations" ADD CONSTRAINT "attendance_condonations_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_condonations" ADD CONSTRAINT "attendance_condonations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_holds" ADD CONSTRAINT "book_holds_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_holds" ADD CONSTRAINT "book_holds_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_holds" ADD CONSTRAINT "book_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "house_points_school_idx" ON "house_points" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "house_points_house" ON "house_points" USING btree ("house_id");--> statement-breakpoint
CREATE INDEX "houses_school_idx" ON "houses" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "houses_name" ON "houses" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "student_houses_school_idx" ON "student_houses" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_houses_student" ON "student_houses" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "student_houses_house" ON "student_houses" USING btree ("house_id");--> statement-breakpoint
CREATE INDEX "student_subjects_school_idx" ON "student_subjects" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_subjects_unique" ON "student_subjects" USING btree ("student_id","year_id","subject_id");--> statement-breakpoint
CREATE INDEX "student_subjects_student" ON "student_subjects" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "subject_group_subjects_school_idx" ON "subject_group_subjects" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_group_subjects_unique" ON "subject_group_subjects" USING btree ("group_id","subject_id");--> statement-breakpoint
CREATE INDEX "subject_groups_school_idx" ON "subject_groups" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_groups_unique" ON "subject_groups" USING btree ("class_id","name");--> statement-breakpoint
CREATE INDEX "assignment_extensions_school_idx" ON "assignment_extensions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_extensions_assignment_student" ON "assignment_extensions" USING btree ("assignment_id","student_id");--> statement-breakpoint
CREATE INDEX "submission_comments_school_idx" ON "submission_comments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "submission_comments_submission" ON "submission_comments" USING btree ("submission_id","created_at");--> statement-breakpoint
CREATE INDEX "absence_alerts_school_idx" ON "absence_alerts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "absence_alerts_student_date" ON "absence_alerts" USING btree ("student_id","date");--> statement-breakpoint
CREATE INDEX "attendance_condonations_school_idx" ON "attendance_condonations" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_condonations_student_year" ON "attendance_condonations" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "attendance_settings_school_idx" ON "attendance_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_settings_school" ON "attendance_settings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "leave_requests_school_idx" ON "leave_requests" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "leave_requests_status" ON "leave_requests" USING btree ("school_id","status","from_date");--> statement-breakpoint
CREATE INDEX "leave_requests_requester" ON "leave_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "book_holds_school_idx" ON "book_holds" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "book_holds_book" ON "book_holds" USING btree ("school_id","book_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "book_holds_student_live" ON "book_holds" USING btree ("book_id","student_id") WHERE "book_holds"."status" in ('waiting','ready') and "book_holds"."student_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "book_holds_user_live" ON "book_holds" USING btree ("book_id","user_id") WHERE "book_holds"."status" in ('waiting','ready') and "book_holds"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "library_settings_school_idx" ON "library_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_settings_school" ON "library_settings" USING btree ("school_id");--> statement-breakpoint
CREATE POLICY "house_points_school_isolation" ON "house_points" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "houses_school_isolation" ON "houses" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_houses_school_isolation" ON "student_houses" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_subjects_school_isolation" ON "student_subjects" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subject_group_subjects_school_isolation" ON "subject_group_subjects" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subject_groups_school_isolation" ON "subject_groups" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "assignment_extensions_school_isolation" ON "assignment_extensions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "submission_comments_school_isolation" ON "submission_comments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "absence_alerts_school_isolation" ON "absence_alerts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "attendance_condonations_school_isolation" ON "attendance_condonations" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "attendance_settings_school_isolation" ON "attendance_settings" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "leave_requests_school_isolation" ON "leave_requests" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "book_holds_school_isolation" ON "book_holds" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "library_settings_school_isolation" ON "library_settings" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);