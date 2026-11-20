CREATE TABLE "co_scholastic_scales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"grades" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "co_scholastic_scales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "component_marks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"component_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"marks" numeric(6, 2),
	"is_absent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "component_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "paper_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paper_id" uuid NOT NULL,
	"name" text NOT NULL,
	"max_marks" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_remarks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"text" text NOT NULL,
	"by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "report_remarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_band" text NOT NULL,
	"board" text DEFAULT 'cbse' NOT NULL,
	"scale_id" uuid,
	"co_scale_id" uuid,
	"show_grade" boolean DEFAULT true NOT NULL,
	"show_rank" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "term_weights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"term_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"weight_percent" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "term_weights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_key" text NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fee_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"slot_id" uuid NOT NULL,
	"absent_teacher_id" uuid,
	"cover_teacher_id" uuid NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "substitutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_day_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"period_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tt_day_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"capacity" integer
);
--> statement-breakpoint
ALTER TABLE "tt_rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_teacher_first_period" boolean DEFAULT true NOT NULL,
	"no_same_subject_twice_a_day" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tt_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_subject_load" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"periods_per_week" integer NOT NULL,
	"double_periods" integer DEFAULT 0 NOT NULL,
	"room_kind" text
);
--> statement-breakpoint
ALTER TABLE "tt_subject_load" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_teacher_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"max_per_day" integer,
	"max_per_week" integer,
	"unavailable" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tt_teacher_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tt_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"report" jsonb,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tt_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicle_document_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document_id" uuid NOT NULL,
	"expires_on" date NOT NULL,
	"days_before" integer NOT NULL,
	"sent_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_document_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text,
	"expires_on" date NOT NULL,
	"file_key" text,
	"file_name" text
);
--> statement-breakpoint
ALTER TABLE "vehicle_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "timetable_slots_cell";--> statement-breakpoint
DROP INDEX "timetable_slots_teacher_cell";--> statement-breakpoint
ALTER TABLE "co_scholastic_grades" ALTER COLUMN "exam_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_payment_allocations" ALTER COLUMN "installment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "co_scholastic_grades" ADD COLUMN "term_id" uuid;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD COLUMN "start_time" text;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD COLUMN "end_time" text;--> statement-breakpoint
ALTER TABLE "fee_payment_allocations" ADD COLUMN "charge_id" uuid;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD COLUMN "version_id" uuid;--> statement-breakpoint
-- Existing slots move into one live version per school (timetable versions, docs/ACADEMICS-PRD.md 4.3).
INSERT INTO "tt_versions" ("id", "school_id", "name", "status", "published_at")
  SELECT gen_random_uuid(), s.school_id, 'Live timetable', 'live', now() FROM (SELECT DISTINCT "school_id" FROM "timetable_slots") s;--> statement-breakpoint
UPDATE "timetable_slots" t SET "version_id" = v."id" FROM "tt_versions" v WHERE v."school_id" = t."school_id" AND v."status" = 'live';--> statement-breakpoint
ALTER TABLE "timetable_slots" ALTER COLUMN "version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "tracking_url" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "component_marks" ADD CONSTRAINT "component_marks_component_id_paper_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."paper_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_marks" ADD CONSTRAINT "component_marks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_components" ADD CONSTRAINT "paper_components_paper_id_exam_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_remarks" ADD CONSTRAINT "report_remarks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_remarks" ADD CONSTRAINT "report_remarks_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_scale_id_grade_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."grade_scales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_co_scale_id_co_scholastic_scales_id_fk" FOREIGN KEY ("co_scale_id") REFERENCES "public"."co_scholastic_scales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_weights" ADD CONSTRAINT "term_weights_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_weights" ADD CONSTRAINT "term_weights_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_slot_id_timetable_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_absent_teacher_id_users_id_fk" FOREIGN KEY ("absent_teacher_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_cover_teacher_id_users_id_fk" FOREIGN KEY ("cover_teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_subject_load" ADD CONSTRAINT "tt_subject_load_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_subject_load" ADD CONSTRAINT "tt_subject_load_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_teacher_rules" ADD CONSTRAINT "tt_teacher_rules_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_versions" ADD CONSTRAINT "tt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_document_alerts" ADD CONSTRAINT "vehicle_document_alerts_document_id_vehicle_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."vehicle_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "co_scholastic_scales_school_idx" ON "co_scholastic_scales" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "co_scholastic_scales_name" ON "co_scholastic_scales" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "component_marks_school_idx" ON "component_marks" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "component_marks_unique" ON "component_marks" USING btree ("component_id","student_id");--> statement-breakpoint
CREATE INDEX "component_marks_student" ON "component_marks" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "paper_components_school_idx" ON "paper_components" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_components_name" ON "paper_components" USING btree ("paper_id","name");--> statement-breakpoint
CREATE INDEX "report_remarks_school_idx" ON "report_remarks" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_remarks_unique" ON "report_remarks" USING btree ("student_id","term_id");--> statement-breakpoint
CREATE INDEX "report_templates_school_idx" ON "report_templates" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_templates_band" ON "report_templates" USING btree ("school_id","class_band");--> statement-breakpoint
CREATE INDEX "term_weights_school_idx" ON "term_weights" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "term_weights_unique" ON "term_weights" USING btree ("term_id","exam_id");--> statement-breakpoint
CREATE INDEX "fee_charges_school_idx" ON "fee_charges" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_charges_source" ON "fee_charges" USING btree ("school_id","source_key");--> statement-breakpoint
CREATE INDEX "fee_charges_student" ON "fee_charges" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "substitutions_school_idx" ON "substitutions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "substitutions_slot_date" ON "substitutions" USING btree ("slot_id","date");--> statement-breakpoint
CREATE INDEX "substitutions_date" ON "substitutions" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "tt_day_overrides_school_idx" ON "tt_day_overrides" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_day_overrides_date" ON "tt_day_overrides" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "tt_rooms_school_idx" ON "tt_rooms" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_rooms_name" ON "tt_rooms" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "tt_settings_school_idx" ON "tt_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_settings_school" ON "tt_settings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "tt_subject_load_school_idx" ON "tt_subject_load" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_subject_load_unique" ON "tt_subject_load" USING btree ("class_id","subject_id");--> statement-breakpoint
CREATE INDEX "tt_teacher_rules_school_idx" ON "tt_teacher_rules" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_teacher_rules_teacher" ON "tt_teacher_rules" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "tt_versions_school_idx" ON "tt_versions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_versions_one_live" ON "tt_versions" USING btree ("school_id") WHERE "tt_versions"."status" = 'live';--> statement-breakpoint
CREATE INDEX "vehicle_document_alerts_school_idx" ON "vehicle_document_alerts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_document_alerts_unique" ON "vehicle_document_alerts" USING btree ("document_id","expires_on","days_before");--> statement-breakpoint
CREATE INDEX "vehicle_documents_school_idx" ON "vehicle_documents" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "vehicle_documents_vehicle" ON "vehicle_documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_documents_expiry" ON "vehicle_documents" USING btree ("school_id","expires_on");--> statement-breakpoint
ALTER TABLE "co_scholastic_grades" ADD CONSTRAINT "co_scholastic_grades_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_allocations" ADD CONSTRAINT "fee_payment_allocations_charge_id_fee_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."fee_charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_version_id_tt_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."tt_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_payment_allocations_charge" ON "fee_payment_allocations" USING btree ("charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_cell" ON "timetable_slots" USING btree ("version_id","section_id","day_of_week","period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_teacher_cell" ON "timetable_slots" USING btree ("version_id","teacher_id","day_of_week","period_id");--> statement-breakpoint
CREATE POLICY "co_scholastic_scales_school_isolation" ON "co_scholastic_scales" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "component_marks_school_isolation" ON "component_marks" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "paper_components_school_isolation" ON "paper_components" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "report_remarks_school_isolation" ON "report_remarks" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "report_templates_school_isolation" ON "report_templates" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "term_weights_school_isolation" ON "term_weights" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_charges_school_isolation" ON "fee_charges" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "substitutions_school_isolation" ON "substitutions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_day_overrides_school_isolation" ON "tt_day_overrides" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_rooms_school_isolation" ON "tt_rooms" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_settings_school_isolation" ON "tt_settings" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_subject_load_school_isolation" ON "tt_subject_load" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_teacher_rules_school_isolation" ON "tt_teacher_rules" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tt_versions_school_isolation" ON "tt_versions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "vehicle_document_alerts_school_isolation" ON "vehicle_document_alerts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "vehicle_documents_school_isolation" ON "vehicle_documents" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
--> statement-breakpoint
-- Co-scholastic grades are keyed by term now. A term with two exams has two rows per student and subject:
-- keep the newest, drop the rest, then move the survivors to the term and only then add the unique index.
DELETE FROM "co_scholastic_grades" g USING "exams" e, (
  SELECT g2."id", row_number() OVER (PARTITION BY e2."term_id", g2."student_id", g2."subject_id" ORDER BY g2."updated_at" DESC, g2."id" DESC) AS rn
  FROM "co_scholastic_grades" g2 JOIN "exams" e2 ON e2."id" = g2."exam_id" WHERE e2."term_id" IS NOT NULL
) d WHERE d."id" = g."id" AND d.rn > 1 AND e."id" = g."exam_id";--> statement-breakpoint
UPDATE "co_scholastic_grades" g SET "term_id" = e."term_id", "exam_id" = NULL FROM "exams" e WHERE e."id" = g."exam_id" AND e."term_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "co_scholastic_term_unique" ON "co_scholastic_grades" USING btree ("term_id","student_id","subject_id");