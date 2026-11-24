CREATE TABLE "account_credits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_paise" bigint NOT NULL,
	"kind" text NOT NULL,
	"invoice_id" uuid,
	"payment_id" uuid,
	"credit_note_id" uuid,
	"source_key" text NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "account_credits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"reason" text NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"settlement" text NOT NULL,
	"refund_method" text,
	"refund_reference" text,
	"refunded_on" text,
	"refunded_at" timestamp with time zone,
	"refunded_by" uuid,
	"issued_by" uuid,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tds_certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"quarter" text NOT NULL,
	"remind_on" text NOT NULL,
	"status" text DEFAULT 'awaited' NOT NULL,
	"file_key" text,
	"file_name" text,
	"uploaded_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"note" text,
	"reminded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tds_certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"date" date NOT NULL,
	"half_days" integer NOT NULL,
	"kind" text NOT NULL,
	"request_id" uuid,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "leave_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"yearly_half_days" integer DEFAULT 0 NOT NULL,
	"carry_forward_half_days" integer DEFAULT 0 NOT NULL,
	"encashable" boolean DEFAULT false NOT NULL,
	"half_day_allowed" boolean DEFAULT true NOT NULL,
	"needs_file_after_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_bill_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bill_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_centre_id" uuid,
	"vehicle_id" uuid,
	"label" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"gst_paise" bigint DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "exp_bill_lines_amount" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "exp_bill_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"bill_no" text NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"file_key" text,
	"file_name" text,
	"gross_paise" bigint DEFAULT 0 NOT NULL,
	"tds_paise" bigint DEFAULT 0 NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"source_key" text,
	"created_by" uuid,
	CONSTRAINT "exp_bills_paid" CHECK (paid_paise >= 0 and paid_paise <= gross_paise - tds_paise)
);
--> statement-breakpoint
ALTER TABLE "exp_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_budget_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"budget_id" uuid NOT NULL,
	"percent" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exp_budget_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fy" text NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_centre_id" uuid,
	"months" jsonb NOT NULL,
	"on_over" text DEFAULT 'warn' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exp_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"spent_on" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"account_id" uuid,
	"cost_centre_id" uuid,
	"file_key" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"pay_with" text DEFAULT 'now' NOT NULL,
	"cash_account_id" uuid,
	"paid_on" date,
	"payroll_ref" uuid,
	CONSTRAINT "exp_claims_amount" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "exp_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_income" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"from_name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_centre_id" uuid,
	"label" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"cash_account_id" uuid,
	"reference" text,
	"status" text DEFAULT 'valid' NOT NULL,
	"reverse_reason" text,
	"verify_token" text NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "exp_income" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_payment_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payment_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exp_payment_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"vendor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"cash_account_id" uuid,
	"reference" text,
	"status" text DEFAULT 'valid' NOT NULL,
	"reverse_reason" text,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "exp_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_petty_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"float_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"account_id" uuid,
	"cost_centre_id" uuid,
	"cash_account_id" uuid,
	"label" text NOT NULL,
	"file_key" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" uuid,
	CONSTRAINT "exp_petty_entries_amount" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "exp_petty_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_petty_floats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"holder_id" uuid NOT NULL,
	"name" text NOT NULL,
	"limit_paise" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exp_petty_floats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_recurring" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"label" text NOT NULL,
	"frequency" text NOT NULL,
	"next_on" date NOT NULL,
	"ends_on" date,
	"due_days" integer DEFAULT 7 NOT NULL,
	"lines" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exp_recurring" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exp_vendors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"gstin" text,
	"pan_sealed" text,
	"pan_last4" text,
	"bank_sealed" text,
	"bank_last4" text,
	"ifsc" text,
	"upi_id" text,
	"tds_basis_points" integer DEFAULT 0 NOT NULL,
	"default_account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exp_vendors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_advances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"ref_id" uuid,
	"note" text,
	"date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_advances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid,
	"invoice_line_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"date" date NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "fee_allocations_amount" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "fee_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_cheques" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"cheque_no" text NOT NULL,
	"bank" text NOT NULL,
	"cheque_date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"deposited_to" uuid,
	"deposited_on" date,
	"cleared_on" date,
	"bounced_on" date,
	"bounce_reason" text
);
--> statement-breakpoint
ALTER TABLE "fee_cheques" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_concession_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"auto" text,
	"mode" text NOT NULL,
	"value" bigint NOT NULL,
	"head_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"per" text DEFAULT 'year' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_concession_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_concession_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"concession_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "fee_concession_uses_amount" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "fee_concession_uses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_concessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"type_id" uuid,
	"head_id" uuid,
	"mode" text NOT NULL,
	"value" bigint NOT NULL,
	"reason" text NOT NULL,
	"file_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"per" text DEFAULT 'year' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_concessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"float_paise" bigint DEFAULT 0 NOT NULL,
	"expected_paise" bigint,
	"counted_paise" bigint,
	"denominations" jsonb,
	"difference_reason" text,
	"closed_at" timestamp with time zone,
	"difference_state" text,
	"difference_approval_id" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_due_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_due_parts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_invoice_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"invoice_id" uuid,
	"student_id" uuid,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"lowers_paise" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"direct" boolean DEFAULT false NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_invoice_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"head_id" uuid,
	"kind" text DEFAULT 'fee' NOT NULL,
	"label" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"concession_paise" bigint DEFAULT 0 NOT NULL,
	"credited_paise" bigint DEFAULT 0 NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_invoice_lines_paid" CHECK (amount_paise > 0 and concession_paise >= 0 and credited_paise >= 0 and paid_paise >= 0 and concession_paise + credited_paise + paid_paise <= amount_paise)
);
--> statement-breakpoint
ALTER TABLE "fee_invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"class_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_key" text,
	"label" text NOT NULL,
	"issue_date" date,
	"due_date" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"replaces_id" uuid,
	"note" text,
	"snapshot" jsonb NOT NULL,
	"late_rule" jsonb,
	"template_version" integer,
	"verify_token" text,
	"gross_paise" bigint DEFAULT 0 NOT NULL,
	"concession_paise" bigint DEFAULT 0 NOT NULL,
	"credited_paise" bigint DEFAULT 0 NOT NULL,
	"late_paise" bigint DEFAULT 0 NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	CONSTRAINT "fee_invoices_paid" CHECK (paid_paise >= 0 and paid_paise <= gross_paise - concession_paise - credited_paise + late_paise)
);
--> statement-breakpoint
ALTER TABLE "fee_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text,
	"invoice_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason_type" text NOT NULL,
	"reason" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"issued_on" date,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_opening_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_name" text NOT NULL,
	"rows" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_opening_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_opt_ins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"head_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_opt_ins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_plan_classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"class_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_plan_classes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_plan_dues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"line_id" uuid NOT NULL,
	"due_key" text NOT NULL,
	"label" text NOT NULL,
	"bill_on" date NOT NULL,
	"due_on" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "fee_plan_dues_amount" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "fee_plan_dues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_plan_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"head_id" uuid NOT NULL,
	"optional" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_plan_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"year_id" uuid NOT NULL,
	"root_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"admission_type" text DEFAULT 'all' NOT NULL,
	"late_rule" jsonb,
	"join_rule" text DEFAULT 'due_after_joining' NOT NULL,
	"note" text,
	"approval_file_key" text,
	"published_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_promises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"promised_on" date NOT NULL,
	"amount_paise" bigint,
	"note" text,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_promises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_receipt_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"cash_account_id" uuid,
	"reference" text,
	CONSTRAINT "fee_receipt_methods_amount" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "fee_receipt_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"student_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"advance_paise" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"counter_id" uuid,
	"payer_name" text,
	"note" text,
	"snapshot" jsonb NOT NULL,
	"template_version" integer,
	"verify_token" text NOT NULL,
	"collected_by" uuid,
	"reverse_reason" text,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "fee_receipts_amount" CHECK (amount_paise > 0 and advance_paise >= 0 and advance_paise <= amount_paise)
);
--> statement-breakpoint
ALTER TABLE "fee_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text,
	"student_id" uuid NOT NULL,
	"source" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"cash_account_id" uuid,
	"reference" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_on" date,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_reminder_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_reminder_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_reminder_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"offset_days" integer NOT NULL,
	"due_on" date NOT NULL,
	"sent_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_reminder_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"plan" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_student_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"year_id" uuid NOT NULL,
	"root_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fee_student_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_upi_slips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"utr" text NOT NULL,
	"paid_on" date NOT NULL,
	"invoice_ids" jsonb NOT NULL,
	"file_key" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reason" text,
	"receipt_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fee_upi_slips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"group_name" text NOT NULL,
	"system_key" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"href" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"self_approved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_bank_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bank_line_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_bank_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_bank_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"statement_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount_paise" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"journal_line_id" uuid,
	"matched_by" uuid,
	"matched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fin_bank_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_bank_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bank_line_id" uuid NOT NULL,
	"journal_line_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_bank_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_bank_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"imported_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fin_bank_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_cash_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"bank_name" text,
	"account_last4" text,
	"ifsc" text,
	"upi_id" text,
	"upi_name" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_cash_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_cost_centres" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_cost_centres" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_journal_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"memo" text NOT NULL,
	"lines" jsonb NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_journal_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_paise" bigint DEFAULT 0 NOT NULL,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"party_type" text,
	"party_id" uuid,
	"cost_centre_id" uuid,
	"memo" text,
	CONSTRAINT "fin_journal_lines_one_side" CHECK ((debit_paise > 0 and credit_paise = 0) or (credit_paise > 0 and debit_paise = 0))
);
--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_journals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"original_date" date,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"memo" text NOT NULL,
	"reverses_id" uuid,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fin_journals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"month" date NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"changed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fin_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_prints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"copy_no" integer NOT NULL,
	"printed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fin_prints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"prefix" text NOT NULL,
	"width" integer DEFAULT 6 NOT NULL,
	"start_at" integer DEFAULT 1 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"basis" text DEFAULT 'accrual' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "fin_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fin_year_closes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fy" text NOT NULL,
	"run" integer DEFAULT 1 NOT NULL,
	"journal_id" uuid,
	"status" text DEFAULT 'closed' NOT NULL,
	"surplus_paise" bigint DEFAULT 0 NOT NULL,
	"closed_by" uuid,
	"reopen_reason" text,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fin_year_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"gross_paise" bigint NOT NULL,
	"from_date" date NOT NULL,
	"hourly_paise" bigint,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"created_by" uuid,
	CONSTRAINT "pay_assignments_gross" CHECK (gross_paise >= 0)
);
--> statement-breakpoint
ALTER TABLE "pay_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"structure_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"is_basic" boolean DEFAULT false NOT NULL,
	"is_wage" boolean DEFAULT false NOT NULL,
	"pro_rata" boolean DEFAULT true NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"account_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_config" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_declarations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"other_income_paise" bigint DEFAULT 0 NOT NULL,
	"deductions_paise" bigint DEFAULT 0 NOT NULL,
	"previous_salary_paise" bigint DEFAULT 0 NOT NULL,
	"previous_tds_paise" bigint DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "pay_declarations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_exits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"last_day" date NOT NULL,
	"reason" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"run_id" uuid,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "pay_exits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"payslip_no" text,
	"calendar_days" integer NOT NULL,
	"paid_half_days" integer NOT NULL,
	"unpaid_half_days" integer DEFAULT 0 NOT NULL,
	"unmarked_days" integer DEFAULT 0 NOT NULL,
	"hours" numeric(8, 2),
	"gross_paise" bigint DEFAULT 0 NOT NULL,
	"deductions_paise" bigint DEFAULT 0 NOT NULL,
	"employer_paise" bigint DEFAULT 0 NOT NULL,
	"net_paise" bigint DEFAULT 0 NOT NULL,
	"skipped_reason" text,
	"payout" text DEFAULT 'pending' NOT NULL,
	"payout_ref" text,
	"paid_on" date,
	"cash_account_id" uuid,
	"fail_reason" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_version" integer
);
--> statement-breakpoint
ALTER TABLE "pay_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text,
	"label" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"ref_id" uuid,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_loan_repayments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"loan_id" uuid NOT NULL,
	"item_id" uuid,
	"date" date NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_loan_repayments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_loans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"emi_paise" bigint NOT NULL,
	"starts_on" date NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cash_account_id" uuid,
	"given_on" date,
	"paused_until" date,
	"created_by" uuid,
	CONSTRAINT "pay_loans_amount" CHECK (amount_paise > 0 and emi_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "pay_loans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"pan_sealed" text,
	"pan_last4" text,
	"uan_sealed" text,
	"uan_last4" text,
	"esi_sealed" text,
	"esi_last4" text,
	"bank_sealed" text,
	"bank_last4" text,
	"bank_name" text,
	"ifsc" text,
	"pay_by" text DEFAULT 'bank' NOT NULL,
	"regime" text DEFAULT 'new' NOT NULL,
	"state" text,
	"pf_applies" boolean,
	"esi_applies" boolean,
	"pt_applies" boolean,
	"pf_on_full_wages" boolean DEFAULT false NOT NULL,
	"pays_monthly" boolean DEFAULT true NOT NULL,
	"cost_centre_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_rate_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"state" text,
	"from_date" date NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "pay_rate_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_remittances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"month" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text,
	"cash_account_id" uuid,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "pay_remittances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"month" date NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pay_date" date,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pay_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_structures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tds_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credited_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credit_applied_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tds_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "half_day" text;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD COLUMN "type" text DEFAULT 'income' NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD COLUMN "is_tuition" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "account_credits" ADD CONSTRAINT "account_credits_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_credits" ADD CONSTRAINT "account_credits_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_credits" ADD CONSTRAINT "account_credits_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_certificates" ADD CONSTRAINT "tds_certificates_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_certificates" ADD CONSTRAINT "tds_certificates_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_type_id_leave_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_bill_lines" ADD CONSTRAINT "exp_bill_lines_bill_id_exp_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."exp_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_bill_lines" ADD CONSTRAINT "exp_bill_lines_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_bill_lines" ADD CONSTRAINT "exp_bill_lines_cost_centre_id_fin_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."fin_cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_bills" ADD CONSTRAINT "exp_bills_vendor_id_exp_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."exp_vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_budget_alerts" ADD CONSTRAINT "exp_budget_alerts_budget_id_exp_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."exp_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_budgets" ADD CONSTRAINT "exp_budgets_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_budgets" ADD CONSTRAINT "exp_budgets_cost_centre_id_fin_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."fin_cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_claims" ADD CONSTRAINT "exp_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_claims" ADD CONSTRAINT "exp_claims_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_claims" ADD CONSTRAINT "exp_claims_cost_centre_id_fin_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."fin_cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_claims" ADD CONSTRAINT "exp_claims_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_income" ADD CONSTRAINT "exp_income_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_income" ADD CONSTRAINT "exp_income_cost_centre_id_fin_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."fin_cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_income" ADD CONSTRAINT "exp_income_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_payment_bills" ADD CONSTRAINT "exp_payment_bills_payment_id_exp_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."exp_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_payment_bills" ADD CONSTRAINT "exp_payment_bills_bill_id_exp_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."exp_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_payments" ADD CONSTRAINT "exp_payments_vendor_id_exp_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."exp_vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_payments" ADD CONSTRAINT "exp_payments_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_petty_entries" ADD CONSTRAINT "exp_petty_entries_float_id_exp_petty_floats_id_fk" FOREIGN KEY ("float_id") REFERENCES "public"."exp_petty_floats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_petty_entries" ADD CONSTRAINT "exp_petty_entries_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_petty_entries" ADD CONSTRAINT "exp_petty_entries_cost_centre_id_fin_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."fin_cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_petty_entries" ADD CONSTRAINT "exp_petty_entries_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_petty_floats" ADD CONSTRAINT "exp_petty_floats_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_recurring" ADD CONSTRAINT "exp_recurring_vendor_id_exp_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."exp_vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exp_vendors" ADD CONSTRAINT "exp_vendors_default_account_id_fin_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_advances" ADD CONSTRAINT "fee_advances_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_receipt_id_fee_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."fee_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_invoice_line_id_fee_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."fee_invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_cheques" ADD CONSTRAINT "fee_cheques_receipt_id_fee_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."fee_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_cheques" ADD CONSTRAINT "fee_cheques_deposited_to_fin_cash_accounts_id_fk" FOREIGN KEY ("deposited_to") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concession_types" ADD CONSTRAINT "fee_concession_types_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concession_uses" ADD CONSTRAINT "fee_concession_uses_concession_id_fee_concessions_id_fk" FOREIGN KEY ("concession_id") REFERENCES "public"."fee_concessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concession_uses" ADD CONSTRAINT "fee_concession_uses_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_type_id_fee_concession_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."fee_concession_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_counters" ADD CONSTRAINT "fee_counters_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_due_parts" ADD CONSTRAINT "fee_due_parts_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_changes" ADD CONSTRAINT "fee_invoice_changes_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_changes" ADD CONSTRAINT "fee_invoice_changes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_replaces_id_fee_invoices_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."fee_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_notes" ADD CONSTRAINT "fee_notes_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_notes" ADD CONSTRAINT "fee_notes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_opt_ins" ADD CONSTRAINT "fee_opt_ins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_opt_ins" ADD CONSTRAINT "fee_opt_ins_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_opt_ins" ADD CONSTRAINT "fee_opt_ins_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plan_classes" ADD CONSTRAINT "fee_plan_classes_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fee_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plan_classes" ADD CONSTRAINT "fee_plan_classes_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plan_dues" ADD CONSTRAINT "fee_plan_dues_line_id_fee_plan_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."fee_plan_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plan_lines" ADD CONSTRAINT "fee_plan_lines_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fee_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plan_lines" ADD CONSTRAINT "fee_plan_lines_head_id_fee_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."fee_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_promises" ADD CONSTRAINT "fee_promises_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipt_methods" ADD CONSTRAINT "fee_receipt_methods_receipt_id_fee_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."fee_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipt_methods" ADD CONSTRAINT "fee_receipt_methods_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_counter_id_fee_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."fee_counters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminder_stops" ADD CONSTRAINT "fee_reminder_stops_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminder_log" ADD CONSTRAINT "fee_reminder_log_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_reminder_log" ADD CONSTRAINT "fee_reminder_log_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_settlements" ADD CONSTRAINT "fee_settlements_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_student_plans" ADD CONSTRAINT "fee_student_plans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_student_plans" ADD CONSTRAINT "fee_student_plans_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_upi_slips" ADD CONSTRAINT "fee_upi_slips_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_upi_slips" ADD CONSTRAINT "fee_upi_slips_receipt_id_fee_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."fee_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_drafts" ADD CONSTRAINT "fin_bank_drafts_bank_line_id_fin_bank_lines_id_fk" FOREIGN KEY ("bank_line_id") REFERENCES "public"."fin_bank_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_drafts" ADD CONSTRAINT "fin_bank_drafts_draft_id_fin_journal_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."fin_journal_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_lines" ADD CONSTRAINT "fin_bank_lines_statement_id_fin_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."fin_bank_statements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_lines" ADD CONSTRAINT "fin_bank_lines_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_lines" ADD CONSTRAINT "fin_bank_lines_journal_line_id_fin_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."fin_journal_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_matches" ADD CONSTRAINT "fin_bank_matches_bank_line_id_fin_bank_lines_id_fk" FOREIGN KEY ("bank_line_id") REFERENCES "public"."fin_bank_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_matches" ADD CONSTRAINT "fin_bank_matches_journal_line_id_fin_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."fin_journal_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_statements" ADD CONSTRAINT "fin_bank_statements_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_cash_accounts" ADD CONSTRAINT "fin_cash_accounts_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_journal_id_fin_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."fin_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_cost_centre_id_fin_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."fin_cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journals" ADD CONSTRAINT "fin_journals_reverses_id_fin_journals_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."fin_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_year_closes" ADD CONSTRAINT "fin_year_closes_journal_id_fin_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."fin_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_assignments" ADD CONSTRAINT "pay_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_assignments" ADD CONSTRAINT "pay_assignments_structure_id_pay_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."pay_structures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_structure_id_pay_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."pay_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_declarations" ADD CONSTRAINT "pay_declarations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_exits" ADD CONSTRAINT "pay_exits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_exits" ADD CONSTRAINT "pay_exits_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pay_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pay_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_items" ADD CONSTRAINT "pay_items_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_lines" ADD CONSTRAINT "pay_lines_item_id_pay_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pay_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_loan_repayments" ADD CONSTRAINT "pay_loan_repayments_loan_id_pay_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."pay_loans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_loan_repayments" ADD CONSTRAINT "pay_loan_repayments_item_id_pay_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pay_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_loans" ADD CONSTRAINT "pay_loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_loans" ADD CONSTRAINT "pay_loans_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profiles" ADD CONSTRAINT "pay_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profiles" ADD CONSTRAINT "pay_profiles_cost_centre_id_fin_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."fin_cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_remittances" ADD CONSTRAINT "pay_remittances_cash_account_id_fin_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."fin_cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_credits_school_idx" ON "account_credits" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_credits_source" ON "account_credits" USING btree ("school_id","source_key");--> statement-breakpoint
CREATE INDEX "credit_notes_school_idx" ON "credit_notes" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_number" ON "credit_notes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "tds_certificates_school_idx" ON "tds_certificates" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tds_certificates_payment" ON "tds_certificates" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "leave_ledger_school_idx" ON "leave_ledger" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_yearly" ON "leave_ledger" USING btree ("user_id","type_id","date","kind") WHERE "leave_ledger"."kind" in ('credit','carry');--> statement-breakpoint
CREATE INDEX "leave_ledger_person" ON "leave_ledger" USING btree ("school_id","user_id","type_id","date");--> statement-breakpoint
CREATE INDEX "leave_ledger_request" ON "leave_ledger" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "leave_types_school_idx" ON "leave_types" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code" ON "leave_types" USING btree ("school_id",lower("code"));--> statement-breakpoint
CREATE INDEX "exp_bill_lines_school_idx" ON "exp_bill_lines" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exp_bill_lines_bill" ON "exp_bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "exp_bill_lines_account" ON "exp_bill_lines" USING btree ("school_id","account_id");--> statement-breakpoint
CREATE INDEX "exp_bills_school_idx" ON "exp_bills" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_bills_number" ON "exp_bills" USING btree ("vendor_id",lower("bill_no")) WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "exp_bills_source" ON "exp_bills" USING btree ("school_id","source_key");--> statement-breakpoint
CREATE INDEX "exp_bills_status" ON "exp_bills" USING btree ("school_id","status","due_date");--> statement-breakpoint
CREATE INDEX "exp_budget_alerts_school_idx" ON "exp_budget_alerts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_budget_alerts_unique" ON "exp_budget_alerts" USING btree ("budget_id","percent");--> statement-breakpoint
CREATE INDEX "exp_budgets_school_idx" ON "exp_budgets" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_budgets_unique" ON "exp_budgets" USING btree ("school_id","fy","account_id",coalesce("cost_centre_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "exp_claims_school_idx" ON "exp_claims" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exp_claims_user" ON "exp_claims" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "exp_claims_status" ON "exp_claims" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "exp_income_school_idx" ON "exp_income" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_income_number" ON "exp_income" USING btree ("school_id","number");--> statement-breakpoint
CREATE INDEX "exp_income_date" ON "exp_income" USING btree ("school_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_income_token" ON "exp_income" USING btree ("verify_token");--> statement-breakpoint
CREATE INDEX "exp_payment_bills_school_idx" ON "exp_payment_bills" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_payment_bills_unique" ON "exp_payment_bills" USING btree ("payment_id","bill_id");--> statement-breakpoint
CREATE INDEX "exp_payment_bills_bill" ON "exp_payment_bills" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "exp_payments_school_idx" ON "exp_payments" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_payments_number" ON "exp_payments" USING btree ("school_id","number");--> statement-breakpoint
CREATE INDEX "exp_payments_vendor" ON "exp_payments" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "exp_payments_date" ON "exp_payments" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "exp_petty_entries_school_idx" ON "exp_petty_entries" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exp_petty_entries_float" ON "exp_petty_entries" USING btree ("float_id");--> statement-breakpoint
CREATE INDEX "exp_petty_floats_school_idx" ON "exp_petty_floats" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_petty_floats_name" ON "exp_petty_floats" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "exp_recurring_school_idx" ON "exp_recurring" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "exp_recurring_next" ON "exp_recurring" USING btree ("school_id","next_on");--> statement-breakpoint
CREATE INDEX "exp_vendors_school_idx" ON "exp_vendors" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_vendors_name" ON "exp_vendors" USING btree ("school_id",lower("name"));--> statement-breakpoint
CREATE INDEX "fee_advances_school_idx" ON "fee_advances" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_advances_student" ON "fee_advances" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_allocations_school_idx" ON "fee_allocations" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_allocations_receipt" ON "fee_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "fee_allocations_line" ON "fee_allocations" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE INDEX "fee_allocations_student" ON "fee_allocations" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_allocations_date" ON "fee_allocations" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "fee_cheques_school_idx" ON "fee_cheques" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_cheques_receipt" ON "fee_cheques" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "fee_cheques_status" ON "fee_cheques" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "fee_concession_types_school_idx" ON "fee_concession_types" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_concession_types_name" ON "fee_concession_types" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "fee_concession_uses_school_idx" ON "fee_concession_uses" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_concession_uses_unique" ON "fee_concession_uses" USING btree ("concession_id","invoice_id");--> statement-breakpoint
CREATE INDEX "fee_concession_uses_invoice" ON "fee_concession_uses" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fee_concessions_school_idx" ON "fee_concessions" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_concessions_student" ON "fee_concessions" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "fee_counters_school_idx" ON "fee_counters" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_counters_open" ON "fee_counters" USING btree ("school_id","user_id") WHERE closed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_counters_day" ON "fee_counters" USING btree ("school_id","user_id","day");--> statement-breakpoint
CREATE INDEX "fee_due_parts_school_idx" ON "fee_due_parts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_due_parts_unique" ON "fee_due_parts" USING btree ("invoice_id","due_on");--> statement-breakpoint
CREATE INDEX "fee_invoice_changes_school_idx" ON "fee_invoice_changes" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_invoice_changes_invoice" ON "fee_invoice_changes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fee_invoice_changes_student" ON "fee_invoice_changes" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_invoice_lines_school_idx" ON "fee_invoice_lines" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_invoice_lines_invoice" ON "fee_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fee_invoice_lines_head" ON "fee_invoice_lines" USING btree ("school_id","head_id");--> statement-breakpoint
CREATE INDEX "fee_invoices_school_idx" ON "fee_invoices" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_number" ON "fee_invoices" USING btree ("school_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_source" ON "fee_invoices" USING btree ("school_id","source_key") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_token" ON "fee_invoices" USING btree ("verify_token");--> statement-breakpoint
CREATE INDEX "fee_invoices_student" ON "fee_invoices" USING btree ("school_id","student_id","status");--> statement-breakpoint
CREATE INDEX "fee_invoices_open" ON "fee_invoices" USING btree ("school_id","due_date") WHERE status = 'issued' and paid_paise < gross_paise - concession_paise - credited_paise + late_paise;--> statement-breakpoint
CREATE INDEX "fee_notes_school_idx" ON "fee_notes" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_notes_number" ON "fee_notes" USING btree ("school_id","number");--> statement-breakpoint
CREATE INDEX "fee_notes_invoice" ON "fee_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fee_notes_student" ON "fee_notes" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_opening_batches_school_idx" ON "fee_opening_batches" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_opening_batches_status" ON "fee_opening_batches" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "fee_opt_ins_school_idx" ON "fee_opt_ins" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_opt_ins_unique" ON "fee_opt_ins" USING btree ("student_id","year_id","head_id");--> statement-breakpoint
CREATE INDEX "fee_plan_classes_school_idx" ON "fee_plan_classes" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_plan_classes_unique" ON "fee_plan_classes" USING btree ("plan_id","class_id");--> statement-breakpoint
CREATE INDEX "fee_plan_dues_school_idx" ON "fee_plan_dues" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_plan_dues_key" ON "fee_plan_dues" USING btree ("line_id","due_key");--> statement-breakpoint
CREATE INDEX "fee_plan_lines_school_idx" ON "fee_plan_lines" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_plan_lines_head" ON "fee_plan_lines" USING btree ("plan_id","head_id");--> statement-breakpoint
CREATE INDEX "fee_plans_school_idx" ON "fee_plans" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_plans_version" ON "fee_plans" USING btree ("root_id","version");--> statement-breakpoint
CREATE INDEX "fee_plans_year" ON "fee_plans" USING btree ("school_id","year_id","status");--> statement-breakpoint
CREATE INDEX "fee_promises_school_idx" ON "fee_promises" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_promises_student" ON "fee_promises" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_receipt_methods_school_idx" ON "fee_receipt_methods" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_receipt_methods_receipt" ON "fee_receipt_methods" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "fee_receipts_school_idx" ON "fee_receipts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_number" ON "fee_receipts" USING btree ("school_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_token" ON "fee_receipts" USING btree ("verify_token");--> statement-breakpoint
CREATE INDEX "fee_receipts_student" ON "fee_receipts" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_receipts_date" ON "fee_receipts" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "fee_refunds_school_idx" ON "fee_refunds" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_refunds_number" ON "fee_refunds" USING btree ("school_id","number");--> statement-breakpoint
CREATE INDEX "fee_refunds_student" ON "fee_refunds" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_reminder_stops_school_idx" ON "fee_reminder_stops" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_reminder_stops_student" ON "fee_reminder_stops" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_reminder_log_school_idx" ON "fee_reminder_log" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_reminder_log_unique" ON "fee_reminder_log" USING btree ("invoice_id","due_on","offset_days");--> statement-breakpoint
CREATE INDEX "fee_settlements_school_idx" ON "fee_settlements" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_settlements_student" ON "fee_settlements" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "fee_student_plans_school_idx" ON "fee_student_plans" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_student_plans_unique" ON "fee_student_plans" USING btree ("student_id","year_id");--> statement-breakpoint
CREATE INDEX "fee_upi_slips_school_idx" ON "fee_upi_slips" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_upi_slips_utr" ON "fee_upi_slips" USING btree ("school_id","utr") WHERE status <> 'rejected';--> statement-breakpoint
CREATE INDEX "fee_upi_slips_status" ON "fee_upi_slips" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "fin_accounts_school_idx" ON "fin_accounts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_accounts_code" ON "fin_accounts" USING btree ("school_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_accounts_system" ON "fin_accounts" USING btree ("school_id","system_key");--> statement-breakpoint
CREATE INDEX "fin_approvals_school_idx" ON "fin_approvals" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fin_approvals_status" ON "fin_approvals" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_approvals_open" ON "fin_approvals" USING btree ("school_id","kind","ref_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "fin_bank_drafts_school_idx" ON "fin_bank_drafts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_drafts_line" ON "fin_bank_drafts" USING btree ("bank_line_id");--> statement-breakpoint
CREATE INDEX "fin_bank_lines_school_idx" ON "fin_bank_lines" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_lines_fingerprint" ON "fin_bank_lines" USING btree ("cash_account_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_lines_match" ON "fin_bank_lines" USING btree ("journal_line_id");--> statement-breakpoint
CREATE INDEX "fin_bank_matches_school_idx" ON "fin_bank_matches" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_matches_line" ON "fin_bank_matches" USING btree ("journal_line_id");--> statement-breakpoint
CREATE INDEX "fin_bank_matches_bank" ON "fin_bank_matches" USING btree ("bank_line_id");--> statement-breakpoint
CREATE INDEX "fin_bank_statements_school_idx" ON "fin_bank_statements" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fin_cash_accounts_school_idx" ON "fin_cash_accounts" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_cash_accounts_name" ON "fin_cash_accounts" USING btree ("school_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_cash_accounts_account" ON "fin_cash_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "fin_cost_centres_school_idx" ON "fin_cost_centres" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_cost_centres_name" ON "fin_cost_centres" USING btree ("school_id","name");--> statement-breakpoint
CREATE INDEX "fin_journal_drafts_school_idx" ON "fin_journal_drafts" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_school_idx" ON "fin_journal_lines" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_journal" ON "fin_journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_account" ON "fin_journal_lines" USING btree ("school_id","account_id");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_party" ON "fin_journal_lines" USING btree ("school_id","party_type","party_id");--> statement-breakpoint
CREATE INDEX "fin_journals_school_idx" ON "fin_journals" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_journals_source" ON "fin_journals" USING btree ("school_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_journals_number" ON "fin_journals" USING btree ("school_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_journals_reverses" ON "fin_journals" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "fin_journals_date" ON "fin_journals" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "fin_journals_ref" ON "fin_journals" USING btree ("school_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "fin_periods_school_idx" ON "fin_periods" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_periods_month" ON "fin_periods" USING btree ("school_id","month");--> statement-breakpoint
CREATE INDEX "fin_prints_school_idx" ON "fin_prints" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_prints_copy" ON "fin_prints" USING btree ("school_id","doc_type","doc_id","copy_no");--> statement-breakpoint
CREATE INDEX "fin_series_school_idx" ON "fin_series" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_series_key" ON "fin_series" USING btree ("school_id","key");--> statement-breakpoint
CREATE INDEX "fin_settings_school_idx" ON "fin_settings" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_settings_school" ON "fin_settings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fin_templates_school_idx" ON "fin_templates" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_templates_version" ON "fin_templates" USING btree ("school_id","kind","version");--> statement-breakpoint
CREATE INDEX "fin_year_closes_school_idx" ON "fin_year_closes" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_year_closes_run" ON "fin_year_closes" USING btree ("school_id","fy","run");--> statement-breakpoint
CREATE INDEX "pay_assignments_school_idx" ON "pay_assignments" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_assignments_unique" ON "pay_assignments" USING btree ("user_id","from_date");--> statement-breakpoint
CREATE INDEX "pay_components_school_idx" ON "pay_components" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "pay_components_structure" ON "pay_components" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "pay_config_school_idx" ON "pay_config" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_config_school" ON "pay_config" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "pay_declarations_school_idx" ON "pay_declarations" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_declarations_unique" ON "pay_declarations" USING btree ("user_id","fy");--> statement-breakpoint
CREATE INDEX "pay_exits_school_idx" ON "pay_exits" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_exits_user" ON "pay_exits" USING btree ("user_id","last_day");--> statement-breakpoint
CREATE INDEX "pay_items_school_idx" ON "pay_items" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_items_unique" ON "pay_items" USING btree ("run_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_items_slip" ON "pay_items" USING btree ("school_id","payslip_no");--> statement-breakpoint
CREATE INDEX "pay_items_user" ON "pay_items" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "pay_lines_school_idx" ON "pay_lines" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "pay_lines_item" ON "pay_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pay_lines_code" ON "pay_lines" USING btree ("school_id","code");--> statement-breakpoint
CREATE INDEX "pay_loan_repayments_school_idx" ON "pay_loan_repayments" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "pay_loan_repayments_loan" ON "pay_loan_repayments" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "pay_loans_school_idx" ON "pay_loans" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "pay_loans_user" ON "pay_loans" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "pay_profiles_school_idx" ON "pay_profiles" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_profiles_user" ON "pay_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pay_rate_overrides_school_idx" ON "pay_rate_overrides" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_rate_overrides_unique" ON "pay_rate_overrides" USING btree ("school_id","key",coalesce("state", ''),"from_date");--> statement-breakpoint
CREATE INDEX "pay_remittances_school_idx" ON "pay_remittances" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "pay_remittances_month" ON "pay_remittances" USING btree ("school_id","key","month");--> statement-breakpoint
CREATE INDEX "pay_runs_school_idx" ON "pay_runs" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_runs_month" ON "pay_runs" USING btree ("school_id","month") WHERE kind = 'monthly' and status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "pay_runs_list" ON "pay_runs" USING btree ("school_id","month");--> statement-breakpoint
CREATE INDEX "pay_structures_school_idx" ON "pay_structures" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_structures_name" ON "pay_structures" USING btree ("school_id","name");--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_id_leave_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "account_credits_school_isolation" ON "account_credits" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "credit_notes_school_isolation" ON "credit_notes" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tds_certificates_school_isolation" ON "tds_certificates" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "leave_ledger_school_isolation" ON "leave_ledger" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "leave_types_school_isolation" ON "leave_types" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_bill_lines_school_isolation" ON "exp_bill_lines" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_bills_school_isolation" ON "exp_bills" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_budget_alerts_school_isolation" ON "exp_budget_alerts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_budgets_school_isolation" ON "exp_budgets" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_claims_school_isolation" ON "exp_claims" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_income_school_isolation" ON "exp_income" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_payment_bills_school_isolation" ON "exp_payment_bills" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_payments_school_isolation" ON "exp_payments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_petty_entries_school_isolation" ON "exp_petty_entries" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_petty_floats_school_isolation" ON "exp_petty_floats" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_recurring_school_isolation" ON "exp_recurring" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "exp_vendors_school_isolation" ON "exp_vendors" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_advances_school_isolation" ON "fee_advances" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_allocations_school_isolation" ON "fee_allocations" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_cheques_school_isolation" ON "fee_cheques" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_concession_types_school_isolation" ON "fee_concession_types" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_concession_uses_school_isolation" ON "fee_concession_uses" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_concessions_school_isolation" ON "fee_concessions" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_counters_school_isolation" ON "fee_counters" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_due_parts_school_isolation" ON "fee_due_parts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_invoice_changes_school_isolation" ON "fee_invoice_changes" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_invoice_lines_school_isolation" ON "fee_invoice_lines" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_invoices_school_isolation" ON "fee_invoices" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_notes_school_isolation" ON "fee_notes" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_opening_batches_school_isolation" ON "fee_opening_batches" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_opt_ins_school_isolation" ON "fee_opt_ins" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_plan_classes_school_isolation" ON "fee_plan_classes" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_plan_dues_school_isolation" ON "fee_plan_dues" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_plan_lines_school_isolation" ON "fee_plan_lines" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_plans_school_isolation" ON "fee_plans" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_promises_school_isolation" ON "fee_promises" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_receipt_methods_school_isolation" ON "fee_receipt_methods" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_receipts_school_isolation" ON "fee_receipts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_refunds_school_isolation" ON "fee_refunds" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_reminder_stops_school_isolation" ON "fee_reminder_stops" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_reminder_log_school_isolation" ON "fee_reminder_log" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_settlements_school_isolation" ON "fee_settlements" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_student_plans_school_isolation" ON "fee_student_plans" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fee_upi_slips_school_isolation" ON "fee_upi_slips" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_accounts_school_isolation" ON "fin_accounts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_approvals_school_isolation" ON "fin_approvals" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_bank_drafts_school_isolation" ON "fin_bank_drafts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_bank_lines_school_isolation" ON "fin_bank_lines" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_bank_matches_school_isolation" ON "fin_bank_matches" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_bank_statements_school_isolation" ON "fin_bank_statements" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_cash_accounts_school_isolation" ON "fin_cash_accounts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_cost_centres_school_isolation" ON "fin_cost_centres" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_journal_drafts_school_isolation" ON "fin_journal_drafts" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_journal_lines_school_isolation" ON "fin_journal_lines" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_journals_school_isolation" ON "fin_journals" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_periods_school_isolation" ON "fin_periods" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_prints_school_isolation" ON "fin_prints" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_series_school_isolation" ON "fin_series" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_settings_school_isolation" ON "fin_settings" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_templates_school_isolation" ON "fin_templates" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "fin_year_closes_school_isolation" ON "fin_year_closes" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_assignments_school_isolation" ON "pay_assignments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_components_school_isolation" ON "pay_components" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_config_school_isolation" ON "pay_config" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_declarations_school_isolation" ON "pay_declarations" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_exits_school_isolation" ON "pay_exits" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_items_school_isolation" ON "pay_items" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_lines_school_isolation" ON "pay_lines" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_loan_repayments_school_isolation" ON "pay_loan_repayments" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_loans_school_isolation" ON "pay_loans" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_profiles_school_isolation" ON "pay_profiles" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_rate_overrides_school_isolation" ON "pay_rate_overrides" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_remittances_school_isolation" ON "pay_remittances" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_runs_school_isolation" ON "pay_runs" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pay_structures_school_isolation" ON "pay_structures" AS PERMISSIVE FOR ALL TO public USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid) WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- The old "manage fees" grant becomes collect + setup + propose. Nobody gains approve.
UPDATE "school_roles" SET "grants" = (SELECT array_agg(DISTINCT g) FROM unnest(array_remove("grants", 'fees:manage') || ARRAY['fees:collect','fees:setup','fees:concede']) AS g) WHERE 'fees:manage' = ANY("grants");--> statement-breakpoint
UPDATE "fee_heads" SET "is_tuition" = true WHERE "kind" = 'tuition';
