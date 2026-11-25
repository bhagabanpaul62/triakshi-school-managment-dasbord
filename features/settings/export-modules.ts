/**
 * Which module owns which table, so an admin can choose modules for an export. A table that is not listed belongs to "school"
 * (the school itself, its people, roles, the audit log), which every export carries. Written by hand: a feature never imports another.
 */
const MODULE_TABLES: Record<string, string[]> = {
  students: ["students", "guardians", "student_guardians", "guardian_consents", "student_documents", "student_enrollments"],
  staff: ["staff_profiles"],
  academics: ["academic_years", "terms", "classes", "sections", "subjects", "class_subjects", "section_teachers", "subject_groups", "subject_group_subjects", "student_subjects", "houses", "student_houses", "house_points"],
  announcements: ["announcement_categories", "announcements", "announcement_versions", "announcement_files", "announcement_recipients", "announcement_responses", "announcement_templates"],
  assignments: ["assignments", "assignment_extensions", "assignment_files", "submissions", "submission_comments", "submission_files"],
  attendance: ["student_attendance", "period_attendance", "staff_attendance", "attendance_holidays", "attendance_settings", "absence_alerts", "leave_requests", "attendance_condonations", "leave_types", "leave_ledger"],
  events: ["events", "event_people", "event_files"],
  exams: ["grade_scales", "grade_bands", "exams", "exam_papers", "marks", "co_scholastic_grades", "co_scholastic_scales", "report_templates", "paper_components", "component_marks", "term_weights", "report_remarks"],
  expenses: ["exp_vendors", "exp_bills", "exp_bill_lines", "exp_payments", "exp_payment_bills", "exp_recurring", "exp_petty_floats", "exp_petty_entries", "exp_claims", "exp_budgets", "exp_income", "exp_budget_alerts"],
  fees: ["fee_heads", "fee_plans", "fee_plan_classes", "fee_plan_lines", "fee_plan_dues", "fee_student_plans", "fee_opt_ins", "fee_invoices", "fee_invoice_lines", "fee_due_parts", "fee_notes", "fee_concession_types", "fee_concessions", "fee_concession_uses", "fee_settlements", "fee_counters", "fee_receipts", "fee_receipt_methods", "fee_allocations", "fee_advances", "fee_cheques", "fee_refunds", "fee_upi_slips", "fee_reminder_log", "fee_promises", "fee_reminder_stops", "fee_invoice_changes", "fee_opening_batches"],
  finance: ["fin_accounts", "fin_cash_accounts", "fin_cost_centres", "fin_journals", "fin_journal_lines", "fin_approvals", "fin_series", "fin_templates", "fin_prints", "fin_periods", "fin_settings", "fin_bank_statements", "fin_bank_lines", "fin_journal_drafts", "fin_bank_matches", "fin_bank_drafts", "fin_year_closes"],
  library: ["books", "book_copies", "loans", "library_settings", "book_holds"],
  meetings: ["meeting_days", "meeting_windows", "meeting_slots", "meeting_waits"],
  messages: ["message_batches", "message_threads", "thread_members", "messages", "message_files", "message_reports", "message_reviews", "message_restrictions", "saved_replies"],
  notifications: ["notifications", "notification_prefs", "comm_deliveries", "email_suppressions", "mail_usage", "comm_settings", "comm_groups"],
  payroll: ["pay_profiles", "pay_structures", "pay_components", "pay_assignments", "pay_runs", "pay_items", "pay_lines", "pay_loans", "pay_loan_repayments", "pay_exits", "pay_declarations", "pay_rate_overrides", "pay_config", "pay_remittances"],
  requests: ["request_categories", "requests", "request_events"],
  timetable: ["periods", "tt_versions", "timetable_slots", "tt_subject_load", "tt_teacher_rules", "tt_rooms", "tt_blocks", "tt_block_options", "tt_block_slots", "tt_settings", "substitutions", "tt_day_overrides"],
  transport: ["vehicles", "routes", "route_stops", "student_transport", "vehicle_documents", "vehicle_document_alerts"],
  website: ["school_sites", "site_versions", "site_media", "site_redirects", "site_page_days", "site_disclosure", "enquiries", "enquiry_events", "enquiry_tasks", "enquiry_settings", "enquiry_seats"],
};

const OWNER = new Map(Object.entries(MODULE_TABLES).flatMap(([m, tables]) => tables.map((t) => [t, m] as const)));

/** The module a table belongs to; "school" for the rest. */
export const moduleOfTable = (table: string) => OWNER.get(table) ?? "school";

/** Modules an admin can tick for a school's export: only those the school has on. */
export const exportModules = (features: Iterable<string>) => [...features].filter((f) => f in MODULE_TABLES).sort();
