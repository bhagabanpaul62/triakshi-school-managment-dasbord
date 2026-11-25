/**
 * Where an audit entry's record lives. `table` lets the log check the record still exists before it offers a link
 * (the log keeps the words after the record is deleted). Keys are the lower-cased `entity` the services write.
 * Entries without a table are one page per school: they link when the entity is named.
 */
interface Link { label: string; table?: string; href: (id: string) => string }
const link = (label: string, table: string | undefined, href: (id: string) => string): Link => ({ label, table, href });
const page = (label: string, href: string) => link(label, undefined, () => href);

const LINKS: Record<string, Link> = {
  student: link("Student", "students", (id) => `/app/students/${id}`),
  staff: link("Staff member", "users", (id) => `/app/staff/${id}`),
  user: link("Login", "users", (id) => `/app/settings/users/${id}`),
  invoice: link("Invoice", "fee_invoices", (id) => `/app/fees/invoices/${id}`),
  receipt: link("Receipt", "fee_receipts", (id) => `/app/fees/receipts/${id}`),
  "fee plan": link("Fee plan", "fee_plans", (id) => `/app/fees/plans/${id}`),
  assignment: link("Assignment", "assignments", (id) => `/app/assignments/${id}`),
  event: link("Event", "events", (id) => `/app/events/${id}`),
  notice: link("Notice", "announcements", (id) => `/app/announcements/${id}`),
  meeting: link("Meeting", "meeting_days", (id) => `/app/meetings/${id}`),
  book: link("Book", "books", (id) => `/app/library/books/${id}`),
  vehicle: link("Vehicle", "vehicles", (id) => `/app/transport/vehicles/${id}`),
  route: link("Route", "routes", (id) => `/app/transport/routes/${id}`),
  vendor: link("Vendor", "exp_vendors", (id) => `/app/expenses/vendors/${id}`),
  journal: link("Journal entry", "fin_journals", (id) => `/app/finance/journals/${id}`),
  payrun: link("Salary run", "pay_runs", (id) => `/app/payroll/runs/${id}`),
  payexit: link("Exit settlement", "pay_exits", (id) => `/app/payroll/exits/${id}`),
  request: link("Request", "requests", (id) => `/app/requests/${id}`),
  ticket: link("Support ticket", "support_tickets", (id) => `/app/support/${id}`),
  exam: link("Exam", "exams", (id) => `/app/exams/${id}`),
  domain: page("Domains", "/app/domains"),
  website: page("Website", "/app/website"),
  school: page("School details", "/app/settings/school"),
  role: page("Roles", "/app/settings/roles"),
  "data export": page("Exports", "/app/settings/export"),
};

export interface AuditLink { href: string; label: string; table?: string }

/** The place an entry's record can be opened from, or null when the entity has no page. Existence is checked by the caller. */
export function auditLink(entity: string | null, entityId: string | null): AuditLink | null {
  const l = entity ? LINKS[entity.toLowerCase()] : undefined;
  if (!l) return null;
  if (!l.table) return { href: l.href(""), label: l.label };
  return entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? { href: l.href(entityId), label: l.label, table: l.table } : null;
}

export const AUDIT_LINK_TABLES = new Set(Object.values(LINKS).flatMap((l) => (l.table ? [l.table] : [])));
