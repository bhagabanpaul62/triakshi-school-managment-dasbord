import type { SchoolRole } from "@smw/db";

/** The slice of a FeatureDef the role screens need. The school app passes its generated FEATURES list in, because a feature package cannot import the others. */
export interface CatalogueFeature { key: string; name: string; permissions: Record<string, readonly SchoolRole[]> }
export type Catalogue = readonly CatalogueFeature[];

const LABELS: Record<string, string> = {
  read: "View", view: "View", write: "Add and edit", manage: "Manage", mark: "Mark attendance", marks: "Enter marks",
  enquiries: "Website enquiries", public: "Publish pages", use: "Use", send: "Send", audit: "View audit log",
  export: "Export data", run: "Run", self: "Own records", submit: "Submit work",
  collect: "Collect money", setup: "Set up plans and bills", concede: "Propose concessions and corrections", claim: "Claim own expenses",
  draft: "Write drafts", publish: "Publish", urgent: "Send urgent alerts", safeguard: "Review reported conversations",
  office: "Work the requests inbox", all: "Message any family", meetings: "Run meetings", delivery: "See delivery and failures",
  journal: "Manual entries and transfers", reconcile: "Match bank statements", approve: "Approve requests", close: "Close months and years",
};
/** Words that differ by module ("approve" means notices here, money requests in finance). Checked before LABELS. */
const FEATURE_LABELS: Record<string, string> = {
  "announcements:approve": "Approve notices", "announcements:manage": "Manage templates, categories and any notice",
  "meetings:use": "Run parent-teacher meetings", "messages:manage": "Manage message settings and limits",
  "notifications:manage": "Change communication settings", "requests:office": "Work the office inbox", "requests:manage": "Manage request categories and reports",
};
export const permissionLabel = (key: string, feature?: string) => FEATURE_LABELS[`${feature}:${key}`] ?? LABELS[key] ?? key.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

/** What every signed-in staff member needs to use the app at all: always granted, never shown in the matrix. */
export const BASELINE_GRANTS = ["home:view", "notifications:read", "messages:use", "settings:read", "payroll:self",
  "announcements:read", "events:read", "requests:use"] as const;

/**
 * A custom role may never hold the school-control powers: settings (except the baseline settings:read that only opens
 * My profile: users, roles, export), billing, domains and setup. Holding one of those is "make me admin" or spends money.
 * Other admin-default grants (transport:manage, exams:manage, website:manage, staff:write) stay delegable: the services
 * refuse any action on an admin account by a non-admin, so they cannot be turned against the admin.
 */
const ADMIN_ONLY_MODULES = new Set(["settings", "billing", "domains", "setup"]);
export function adminOnlyGrants(catalogue: Catalogue): Set<string> {
  const out = new Set<string>();
  for (const f of catalogue) for (const p of Object.keys(f.permissions)) {
    const g = `${f.key}:${p}`;
    if (ADMIN_ONLY_MODULES.has(f.key) && !(BASELINE_GRANTS as readonly string[]).includes(g)) out.add(g);
  }
  return out;
}
const PLUMBING = new Set(["home", "settings", "setup"]);
const STAFF_SIDE: readonly SchoolRole[] = ["admin", "accountant", "teacher"];

export interface MatrixModule { key: string; name: string; permissions: { key: string; label: string; grant: string }[] }

/** Modules on for the school and the permissions a role can hold in each. Student-only permissions are left out unless `all`. */
export function matrixFor(catalogue: Catalogue, enabled: ReadonlySet<string>, all = false): MatrixModule[] {
  const adminOnly = adminOnlyGrants(catalogue);
  return catalogue.filter((f) => enabled.has(f.key) && !PLUMBING.has(f.key)).map((f) => ({
    key: f.key, name: f.name,
    permissions: Object.entries(f.permissions).filter(([, roles]) => all || roles.some((r) => STAFF_SIDE.includes(r)))
      .filter(([key]) => all || (!adminOnly.has(`${f.key}:${key}`) && !(BASELINE_GRANTS as readonly string[]).includes(`${f.key}:${key}`)))
      .map(([key]) => ({ key, label: permissionLabel(key, f.key), grant: `${f.key}:${key}` })),
  })).filter((m) => m.permissions.length);
}

export const allGrants = (catalogue: Catalogue) => new Set(catalogue.flatMap((f) => Object.keys(f.permissions).map((p) => `${f.key}:${p}`)));

/** What a built-in role gets from each feature.ts default list. */
export const systemGrants = (role: SchoolRole, catalogue: Catalogue) =>
  catalogue.flatMap((f) => Object.entries(f.permissions).filter(([, roles]) => roles.includes(role)).map(([p]) => `${f.key}:${p}`));

export const SYSTEM_ROLES = [
  { key: "admin", name: "Admin", description: "Manages everything. Cannot be edited." },
  { key: "teacher", name: "Teacher", description: "Classes, attendance, marks and assignments." },
  { key: "student", name: "Student", description: "Their own records. Students sign in with their admission number." },
  { key: "accountant", name: "Accountant", description: "Fees and money." },
] as const satisfies readonly { key: SchoolRole; name: string; description: string }[];

/** Ready-made roles, seeded into every school as editable custom roles. */
export const ROLE_TEMPLATES: readonly { name: string; description: string; grants: string[] }[] = [
  { name: "Fee accountant", description: "Sets up fees, collects and proposes concessions.", grants: ["fees:read", "fees:collect", "fees:setup", "fees:concede", "finance:read", "students:read", "attendance:leave", "expenses:claim"] },
  { name: "Cashier", description: "Takes money at the counter and prints receipts. Cannot change bills.", grants: ["fees:read", "fees:collect", "students:read", "attendance:leave", "expenses:claim"] },
  { name: "Bursar", description: "Approves money requests and closes months.", grants: ["finance:read", "finance:approve", "finance:close", "fees:read", "expenses:read", "payroll:read", "attendance:leave", "expenses:claim"] },
  { name: "Auditor", description: "Reads every book and report. Changes nothing.", grants: ["finance:read", "fees:read", "expenses:read", "payroll:read", "attendance:leave", "expenses:claim"] },
  { name: "Librarian", description: "Runs the library desk.", grants: ["library:read", "library:manage"] },
  { name: "Transport in-charge", description: "Manages routes, stops and vehicles.", grants: ["transport:read", "transport:manage"] },
  { name: "Front office", description: "Looks up students, answers enquiries and posts notices.", grants: ["students:read", "website:enquiries", "announcements:read", "announcements:draft", "requests:office", "meetings:use"] },
  { name: "Safeguarding lead", description: "Reviews reported conversations. Sees student details, nothing else.", grants: ["messages:safeguard", "students:read"] },
  { name: "Coordinator", description: "Writes and publishes notices, approves others, runs events and the requests inbox.", grants: ["announcements:draft", "announcements:publish", "announcements:approve", "events:write", "requests:office", "students:read", "academics:read"] },
  { name: "Exam coordinator", description: "Sets up exams, report cards and results.", grants: ["academics:read", "exams:read", "exams:manage", "exams:marks", "exams:remarks", "exams:coscholastic"] },
  { name: "Timetable in-charge", description: "Builds the timetable and arranges cover for absent teachers.", grants: ["academics:read", "timetable:read", "timetable:manage"] },
];
