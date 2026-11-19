CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_staff_id" uuid,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"summary" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "custom_design_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"brief" text NOT NULL,
	"quote_paise" bigint,
	"invoice_id" uuid
);
--> statement-breakpoint
ALTER TABLE "custom_design_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subscription_id" uuid,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"description" text NOT NULL,
	"sac_code" text DEFAULT '998431' NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"school_gstin" text,
	"place_of_supply" text,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "modules" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stage" text DEFAULT 'alpha' NOT NULL,
	"requires" text[] DEFAULT '{}'::text[] NOT NULL,
	"core" boolean DEFAULT false NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "one_time_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"reference" text,
	"recorded_by" uuid,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_modules" (
	"plan_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	CONSTRAINT "plan_modules_plan_id_module_key_pk" PRIMARY KEY("plan_id","module_key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"student_cap" integer NOT NULL,
	"price_annual_paise" bigint NOT NULL,
	"price_monthly_paise" bigint NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid,
	"school_id" uuid,
	"action" text NOT NULL,
	"summary" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hostname" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verify_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"check_error" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "school_module_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"set_by" uuid
);
--> statement-breakpoint
ALTER TABLE "school_module_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"plan_id" uuid,
	"student_cap" integer DEFAULT 300 NOT NULL,
	"board" text,
	"state" text,
	"city" text,
	"address" text,
	"phone" text,
	"email" text,
	"gstin" text,
	"udise_code" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"academic_year_start_month" integer DEFAULT 4 NOT NULL,
	"theme" jsonb,
	"logo_url" text,
	"setup_completed_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now(),
	"deletion_scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schools" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text,
	"support_staff_id" uuid,
	"read_only" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"two_factor_passed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"interval" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"price_paise" bigint NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"pending_plan_id" uuid,
	"gateway_subscription_id" text,
	"auto_renew" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_staff_id" uuid,
	"body" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"created_by_user_id" uuid,
	"assigned_staff_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text NOT NULL,
	"login_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"avatar_url" text,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_years" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "class_subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"grade" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "section_teachers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "section_teachers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 40 NOT NULL,
	"class_teacher_id" uuid,
	"room" text
);
--> statement-breakpoint
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"kind" text DEFAULT 'scholastic' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"class_id" uuid,
	"is_public" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assignment_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"max_marks" integer,
	"created_by" uuid,
	"status" text DEFAULT 'published' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "submission_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submission_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"text" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"marks" integer,
	"feedback" text,
	"graded_by" uuid,
	"graded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"marked_by" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "staff_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"marked_by" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "student_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"offset_days" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"audience" text DEFAULT 'all' NOT NULL,
	"class_id" uuid,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"tone" text DEFAULT 'default' NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "co_scholastic_grades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exam_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"grade" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "co_scholastic_grades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exam_papers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exam_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"date" date NOT NULL,
	"max_marks" integer NOT NULL,
	"pass_marks" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_papers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"year_id" uuid NOT NULL,
	"term_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grade_bands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scale_id" uuid NOT NULL,
	"grade" text NOT NULL,
	"min_percent" integer NOT NULL,
	"max_percent" integer NOT NULL,
	"grade_point" integer DEFAULT 0 NOT NULL,
	"remark" text
);
--> statement-breakpoint
ALTER TABLE "grade_bands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grade_scales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grade_scales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paper_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"marks_obtained" numeric(6, 2),
	"is_absent" boolean DEFAULT false NOT NULL,
	"entered_by" uuid
);
--> statement-breakpoint
ALTER TABLE "marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_heads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"is_recurring" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_heads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"late_fee_paise" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"receipt_no" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"paid_on" date NOT NULL,
	"collected_by" uuid,
	"status" text DEFAULT 'valid' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fee_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text DEFAULT 'overdue' NOT NULL,
	"sent_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_structure_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"structure_id" uuid NOT NULL,
	"head_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_structure_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"year_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"structure_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "late_fee_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"structure_id" uuid NOT NULL,
	"installment_id" uuid,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"max_paise" bigint
);
--> statement-breakpoint
ALTER TABLE "late_fee_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_concessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"head_id" uuid,
	"kind" text NOT NULL,
	"value" bigint NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "student_concessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "book_copies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"book_id" uuid NOT NULL,
	"accession_no" integer NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"shelf" text
);
--> statement-breakpoint
ALTER TABLE "book_copies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"isbn" text,
	"publisher" text,
	"category" text NOT NULL,
	"language" text DEFAULT 'English' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"copy_id" uuid NOT NULL,
	"borrower_kind" text NOT NULL,
	"student_id" uuid,
	"user_id" uuid,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"returned_on" date,
	"fine_paise" bigint DEFAULT 0 NOT NULL,
	"fine_waived" boolean DEFAULT false NOT NULL,
	"issued_by" uuid
);
--> statement-breakpoint
ALTER TABLE "loans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text NOT NULL,
	"kind" text DEFAULT 'direct' NOT NULL,
	"created_by" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid,
	"body" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "thread_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "thread_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_digest" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'system' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"digest_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text NOT NULL,
	"label" text NOT NULL,
	"requested_by" uuid,
	"status" text DEFAULT 'ready' NOT NULL,
	"file_key" text,
	"size_bytes" integer,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "data_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_id" text NOT NULL,
	"designation" text,
	"department" text,
	"qualification" text,
	"joining_date" date,
	"phone" text,
	"email" text,
	"photo_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"gender" text,
	"dob" date,
	"address" text
);
--> statement-breakpoint
ALTER TABLE "staff_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guardian_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid,
	"purpose" text NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"method" text DEFAULT 'paper_form' NOT NULL,
	"recorded_by" uuid,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardian_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"relation" text DEFAULT 'guardian' NOT NULL,
	"phone" text,
	"email" text,
	"occupation" text,
	"user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "guardians" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" uuid
);
--> statement-breakpoint
ALTER TABLE "student_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"class_id" uuid,
	"section_id" uuid,
	"roll_no" integer,
	"outcome" text DEFAULT 'studying' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_guardians" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admission_no" text NOT NULL,
	"name" text NOT NULL,
	"dob" date,
	"gender" text,
	"blood_group" text,
	"class_id" uuid,
	"section_id" uuid,
	"roll_no" integer,
	"admission_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"photo_key" text,
	"address" text,
	"apaar_id" text,
	"category" text,
	"user_id" uuid,
	"left_on" date
);
--> statement-breakpoint
ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_break" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timetable_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"section_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"period_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid,
	"room" text
);
--> statement-breakpoint
ALTER TABLE "timetable_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"route_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"morning_time" text NOT NULL,
	"evening_time" text NOT NULL,
	"monthly_fee_paise" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"vehicle_id" uuid,
	"morning_start" text NOT NULL,
	"evening_start" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_transport" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"pickup" boolean DEFAULT true NOT NULL,
	"drop" boolean DEFAULT true NOT NULL,
	"starts_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_transport" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registration_no" text NOT NULL,
	"kind" text DEFAULT 'bus' NOT NULL,
	"capacity" integer NOT NULL,
	"driver_name" text NOT NULL,
	"driver_phone" text NOT NULL,
	"attendant_name" text,
	"gps_device_id" text
);
--> statement-breakpoint
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_name" text NOT NULL,
	"dob" date,
	"class_applying" text,
	"parent_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"message" text,
	"source" text DEFAULT 'website' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"converted_student_id" uuid
);
--> statement-breakpoint
ALTER TABLE "enquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "school_sites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"template_key" text DEFAULT 'classic' NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"published_template_key" text,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "school_sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_module_key_modules_key_fk" FOREIGN KEY ("module_key") REFERENCES "public"."modules"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_module_overrides" ADD CONSTRAINT "school_module_overrides_module_key_modules_key_fk" FOREIGN KEY ("module_key") REFERENCES "public"."modules"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_platform_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teachers" ADD CONSTRAINT "section_teachers_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teachers" ADD CONSTRAINT "section_teachers_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_teachers" ADD CONSTRAINT "section_teachers_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_teacher_id_users_id_fk" FOREIGN KEY ("class_teacher_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_files" ADD CONSTRAINT "assignment_files_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reminders" ADD CONSTRAINT "billing_reminders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_scholastic_grades" ADD CONSTRAINT "co_scholastic_grades_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_scholastic_grades" ADD CONSTRAINT "co_scholastic_grades_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_scholastic_grades" ADD CONSTRAINT "co_scholastic_grades_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_scale_id_grade_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."grade_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marks" ADD CONSTRAINT "marks_paper_id_exam_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."exam_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marks" ADD CONSTRAINT "marks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_allocations" ADD CONSTRAINT "fee_payment_allocations_payment_id_fee_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."fee_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_allocations" ADD CONSTRAINT "fee_payment_allocations_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminders" ADD CONSTRAINT "fee_reminders_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminders" ADD CONSTRAINT "fee_reminders_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_structure_id_fee_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_structure_id_fee_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_structure_id_fee_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_concessions" ADD CONSTRAINT "student_concessions_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_copy_id_book_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."book_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_transport" ADD CONSTRAINT "student_transport_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_transport" ADD CONSTRAINT "student_transport_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_transport" ADD CONSTRAINT "student_transport_stop_id_route_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."route_stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_school_idx" ON "audit_logs" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "audit_school_time" ON "audit_logs" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "custom_design_requests_school_idx" ON "custom_design_requests" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "invoices_school_idx" ON "invoices" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "one_time_tokens_school_idx" ON "one_time_tokens" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ott_token" ON "one_time_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "payments_school_idx" ON "payments" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_order" ON "payments" USING btree ("gateway_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_version" ON "plans" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "platform_audit_time" ON "platform_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_staff_email" ON "platform_staff" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "school_domains_school_idx" ON "school_domains" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_domains_hostname" ON "school_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "school_module_overrides_school_idx" ON "school_module_overrides" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "smo_school_module" ON "school_module_overrides" USING btree ("school_id","module_key");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_slug" ON "schools" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sequences_school_idx" ON "sequences" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequences_school_key" ON "sequences" USING btree ("school_id","key");--> statement-breakpoint
CREATE INDEX "sessions_school_idx" ON "sessions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_token" ON "staff_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "subscriptions_school_idx" ON "subscriptions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "support_messages_school_idx" ON "support_messages" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "support_messages_ticket" ON "support_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_tickets_school_idx" ON "support_tickets" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "users_school_idx" ON "users" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_school_login" ON "users" USING btree ("school_id",lower("login_id"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_school_email" ON "users" USING btree ("school_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_school_phone" ON "users" USING btree ("school_id","phone");--> statement-breakpoint
CREATE INDEX "users_school_role" ON "users" USING btree ("school_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "academic_years_school_idx" ON "academic_years" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_name" ON "academic_years" USING btree ("school_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_current" ON "academic_years" USING btree ("school_id") WHERE "academic_years"."is_current";--> statement-breakpoint
CREATE INDEX "class_subjects_school_idx" ON "class_subjects" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_subjects_unique" ON "class_subjects" USING btree ("class_id","subject_id");--> statement-breakpoint
CREATE INDEX "classes_school_idx" ON "classes" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classes_name" ON "classes" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "section_teachers_school_idx" ON "section_teachers" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "section_teachers_unique" ON "section_teachers" USING btree ("section_id","subject_id");--> statement-breakpoint
CREATE INDEX "section_teachers_teacher" ON "section_teachers" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "sections_school_idx" ON "sections" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_unique" ON "sections" USING btree ("school_id","year_id","class_id","name");--> statement-breakpoint
CREATE INDEX "subjects_school_idx" ON "subjects" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_name" ON "subjects" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "terms_school_idx" ON "terms" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "terms_year" ON "terms" USING btree ("year_id");--> statement-breakpoint
CREATE INDEX "announcements_school_idx" ON "announcements" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "announcements_school_published" ON "announcements" USING btree ("school_id","published_at");--> statement-breakpoint
CREATE INDEX "assignment_files_school_idx" ON "assignment_files" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "assignment_files_assignment" ON "assignment_files" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignments_school_idx" ON "assignments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "assignments_section_due" ON "assignments" USING btree ("school_id","section_id","due_at");--> statement-breakpoint
CREATE INDEX "submission_files_school_idx" ON "submission_files" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "submission_files_submission" ON "submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submissions_school_idx" ON "submissions" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_assignment_student" ON "submissions" USING btree ("assignment_id","student_id");--> statement-breakpoint
CREATE INDEX "submissions_student" ON "submissions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "attendance_holidays_school_idx" ON "attendance_holidays" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_holidays_date" ON "attendance_holidays" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "staff_attendance_school_idx" ON "staff_attendance" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_attendance_user_date" ON "staff_attendance" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "staff_attendance_date" ON "staff_attendance" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "student_attendance_school_idx" ON "student_attendance" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_attendance_student_date" ON "student_attendance" USING btree ("student_id","date");--> statement-breakpoint
CREATE INDEX "student_attendance_section_date" ON "student_attendance" USING btree ("school_id","section_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_reminders_once" ON "billing_reminders" USING btree ("subscription_id","period_key","offset_days");--> statement-breakpoint
CREATE INDEX "events_school_idx" ON "events" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "events_school_starts" ON "events" USING btree ("school_id","starts_at");--> statement-breakpoint
CREATE INDEX "co_scholastic_grades_school_idx" ON "co_scholastic_grades" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "co_scholastic_unique" ON "co_scholastic_grades" USING btree ("exam_id","student_id","subject_id");--> statement-breakpoint
CREATE INDEX "exam_papers_school_idx" ON "exam_papers" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_papers_unique" ON "exam_papers" USING btree ("exam_id","class_id","subject_id");--> statement-breakpoint
CREATE INDEX "exams_school_idx" ON "exams" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exams_year" ON "exams" USING btree ("school_id","year_id");--> statement-breakpoint
CREATE INDEX "grade_bands_school_idx" ON "grade_bands" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "grade_bands_scale" ON "grade_bands" USING btree ("scale_id");--> statement-breakpoint
CREATE INDEX "grade_scales_school_idx" ON "grade_scales" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_scales_name" ON "grade_scales" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "marks_school_idx" ON "marks" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marks_unique" ON "marks" USING btree ("paper_id","student_id");--> statement-breakpoint
CREATE INDEX "marks_student" ON "marks" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "fee_heads_school_idx" ON "fee_heads" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_heads_name" ON "fee_heads" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "fee_payment_allocations_school_idx" ON "fee_payment_allocations" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_payment_allocations_payment" ON "fee_payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "fee_payments_school_idx" ON "fee_payments" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payments_receipt" ON "fee_payments" USING btree ("school_id","receipt_no");--> statement-breakpoint
CREATE INDEX "fee_payments_student" ON "fee_payments" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "fee_payments_paid_on" ON "fee_payments" USING btree ("school_id","paid_on");--> statement-breakpoint
CREATE INDEX "fee_reminders_school_idx" ON "fee_reminders" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_reminders_unique" ON "fee_reminders" USING btree ("installment_id","student_id","kind");--> statement-breakpoint
CREATE INDEX "fee_structure_items_school_idx" ON "fee_structure_items" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structure_items_head" ON "fee_structure_items" USING btree ("structure_id","head_id");--> statement-breakpoint
CREATE INDEX "fee_structures_school_idx" ON "fee_structures" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_structures_class_year" ON "fee_structures" USING btree ("school_id","year_id","class_id");--> statement-breakpoint
CREATE INDEX "installments_school_idx" ON "installments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "installments_structure" ON "installments" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "late_fee_rules_school_idx" ON "late_fee_rules" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "late_fee_rules_structure" ON "late_fee_rules" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "student_concessions_school_idx" ON "student_concessions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_concessions_student" ON "student_concessions" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "book_copies_school_idx" ON "book_copies" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_copies_accession" ON "book_copies" USING btree ("school_id","accession_no");--> statement-breakpoint
CREATE INDEX "book_copies_book" ON "book_copies" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "books_school_idx" ON "books" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "books_isbn" ON "books" USING btree ("school_id","isbn") WHERE "books"."isbn" is not null;--> statement-breakpoint
CREATE INDEX "books_title" ON "books" USING btree ("school_id","title");--> statement-breakpoint
CREATE INDEX "loans_school_idx" ON "loans" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loans_open_copy" ON "loans" USING btree ("copy_id") WHERE "loans"."returned_on" is null;--> statement-breakpoint
CREATE INDEX "loans_student" ON "loans" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "loans_user" ON "loans" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "loans_due" ON "loans" USING btree ("school_id","returned_on","due_on");--> statement-breakpoint
CREATE INDEX "message_threads_school_idx" ON "message_threads" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "message_threads_last" ON "message_threads" USING btree ("school_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_school_idx" ON "messages" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "messages_thread" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "thread_members_school_idx" ON "thread_members" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_members_unique" ON "thread_members" USING btree ("thread_id","user_id");--> statement-breakpoint
CREATE INDEX "thread_members_user" ON "thread_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_prefs_school_idx" ON "notification_prefs" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_user" ON "notification_prefs" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_school_idx" ON "notifications" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created" ON "notifications" USING btree ("school_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "data_exports_school_idx" ON "data_exports" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "data_exports_school_time" ON "data_exports" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_profiles_school_idx" ON "staff_profiles" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_user" ON "staff_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_employee" ON "staff_profiles" USING btree ("school_id","employee_id");--> statement-breakpoint
CREATE INDEX "staff_profiles_department" ON "staff_profiles" USING btree ("school_id","department");--> statement-breakpoint
CREATE INDEX "guardian_consents_school_idx" ON "guardian_consents" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "guardian_consents_student" ON "guardian_consents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "guardians_school_idx" ON "guardians" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "guardians_user" ON "guardians" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_documents_school_idx" ON "student_documents" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "student_documents_student" ON "student_documents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_enrollments_school_idx" ON "student_enrollments" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_enrollments_unique" ON "student_enrollments" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "student_guardians_school_idx" ON "student_guardians" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_unique" ON "student_guardians" USING btree ("student_id","guardian_id");--> statement-breakpoint
CREATE INDEX "students_school_idx" ON "students" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_admission_no" ON "students" USING btree ("school_id","admission_no");--> statement-breakpoint
CREATE INDEX "students_section" ON "students" USING btree ("school_id","section_id");--> statement-breakpoint
CREATE INDEX "students_status" ON "students" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "periods_school_idx" ON "periods" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "periods_order" ON "periods" USING btree ("school_id","sort_order");--> statement-breakpoint
CREATE INDEX "timetable_slots_school_idx" ON "timetable_slots" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_cell" ON "timetable_slots" USING btree ("section_id","day_of_week","period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_teacher_cell" ON "timetable_slots" USING btree ("teacher_id","day_of_week","period_id");--> statement-breakpoint
CREATE INDEX "route_stops_school_idx" ON "route_stops" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "route_stops_route" ON "route_stops" USING btree ("route_id","sequence");--> statement-breakpoint
CREATE INDEX "routes_school_idx" ON "routes" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_name" ON "routes" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "routes_vehicle" ON "routes" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "student_transport_school_idx" ON "student_transport" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_transport_student" ON "student_transport" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "student_transport_route" ON "student_transport" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "vehicles_school_idx" ON "vehicles" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_registration" ON "vehicles" USING btree ("school_id","registration_no");--> statement-breakpoint
CREATE INDEX "enquiries_school_idx" ON "enquiries" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "enquiries_school_status" ON "enquiries" USING btree ("school_id","status","created_at");--> statement-breakpoint
CREATE INDEX "school_sites_school_idx" ON "school_sites" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_sites_school" ON "school_sites" USING btree ("school_id");--> statement-breakpoint
CREATE POLICY "audit_logs_school_isolation" ON "audit_logs" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "custom_design_requests_school_isolation" ON "custom_design_requests" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "invoices_school_isolation" ON "invoices" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "one_time_tokens_school_isolation" ON "one_time_tokens" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "payments_school_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "school_domains_school_isolation" ON "school_domains" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "school_module_overrides_school_isolation" ON "school_module_overrides" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "schools_own_row" ON "schools" AS PERMISSIVE FOR ALL TO public USING (id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sequences_school_isolation" ON "sequences" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sessions_school_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_school_isolation" ON "subscriptions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "support_messages_school_isolation" ON "support_messages" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "support_tickets_school_isolation" ON "support_tickets" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "users_school_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "academic_years_school_isolation" ON "academic_years" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "class_subjects_school_isolation" ON "class_subjects" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "classes_school_isolation" ON "classes" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "section_teachers_school_isolation" ON "section_teachers" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sections_school_isolation" ON "sections" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subjects_school_isolation" ON "subjects" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "terms_school_isolation" ON "terms" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "announcements_school_isolation" ON "announcements" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "assignment_files_school_isolation" ON "assignment_files" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "assignments_school_isolation" ON "assignments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "submission_files_school_isolation" ON "submission_files" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "submissions_school_isolation" ON "submissions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "attendance_holidays_school_isolation" ON "attendance_holidays" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "staff_attendance_school_isolation" ON "staff_attendance" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_attendance_school_isolation" ON "student_attendance" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "events_school_isolation" ON "events" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "co_scholastic_grades_school_isolation" ON "co_scholastic_grades" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exam_papers_school_isolation" ON "exam_papers" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exams_school_isolation" ON "exams" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "grade_bands_school_isolation" ON "grade_bands" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "grade_scales_school_isolation" ON "grade_scales" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "marks_school_isolation" ON "marks" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_heads_school_isolation" ON "fee_heads" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_payment_allocations_school_isolation" ON "fee_payment_allocations" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_payments_school_isolation" ON "fee_payments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_reminders_school_isolation" ON "fee_reminders" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_structure_items_school_isolation" ON "fee_structure_items" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_structures_school_isolation" ON "fee_structures" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "installments_school_isolation" ON "installments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "late_fee_rules_school_isolation" ON "late_fee_rules" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_concessions_school_isolation" ON "student_concessions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "book_copies_school_isolation" ON "book_copies" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "books_school_isolation" ON "books" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "loans_school_isolation" ON "loans" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_threads_school_isolation" ON "message_threads" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "messages_school_isolation" ON "messages" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "thread_members_school_isolation" ON "thread_members" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notification_prefs_school_isolation" ON "notification_prefs" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notifications_school_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "data_exports_school_isolation" ON "data_exports" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "staff_profiles_school_isolation" ON "staff_profiles" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "guardian_consents_school_isolation" ON "guardian_consents" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "guardians_school_isolation" ON "guardians" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_documents_school_isolation" ON "student_documents" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_enrollments_school_isolation" ON "student_enrollments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_guardians_school_isolation" ON "student_guardians" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "students_school_isolation" ON "students" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "periods_school_isolation" ON "periods" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "timetable_slots_school_isolation" ON "timetable_slots" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "route_stops_school_isolation" ON "route_stops" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "routes_school_isolation" ON "routes" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "student_transport_school_isolation" ON "student_transport" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "vehicles_school_isolation" ON "vehicles" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "enquiries_school_isolation" ON "enquiries" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "school_sites_school_isolation" ON "school_sites" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);