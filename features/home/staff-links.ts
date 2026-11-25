import { allows, type Ctx, type FeatureDef } from "@smw/feature-kit";
import academics from "@smw/feature-academics/feature";
import announcements from "@smw/feature-announcements/feature";
import assignments from "@smw/feature-assignments/feature";
import attendance from "@smw/feature-attendance/feature";
import billing from "@smw/feature-billing/feature";
import events from "@smw/feature-events/feature";
import expenses from "@smw/feature-expenses/feature";
import exams from "@smw/feature-exams/feature";
import fees from "@smw/feature-fees/feature";
import finance from "@smw/feature-finance/feature";
import library from "@smw/feature-library/feature";
import meetings from "@smw/feature-meetings/feature";
import messages from "@smw/feature-messages/feature";
import notifications from "@smw/feature-notifications/feature";
import payroll from "@smw/feature-payroll/feature";
import requests from "@smw/feature-requests/feature";
import settings from "@smw/feature-settings/feature";
import setup from "@smw/feature-setup/feature";
import staff from "@smw/feature-staff/feature";
import students from "@smw/feature-students/feature";
import support from "@smw/feature-support/feature";
import timetable from "@smw/feature-timetable/feature";
import transport from "@smw/feature-transport/feature";
import website from "@smw/feature-website/feature";

// Every feature this package can see. The sidebar is built from the app's own list; this one only needs the same menu entries.
export const FEATURES: readonly FeatureDef[] = [
  academics, students, staff, attendance, timetable, assignments, exams, fees, finance, expenses, payroll, library, transport,
  announcements, events, meetings, messages, requests, notifications, website, support, billing, settings, setup,
];

/** The pages this login may open (module on and permission held), in the sidebar's order. */
export function staffLinks(ctx: Pick<Ctx, "role" | "features" | "grants">) {
  return FEATURES.flatMap((f) => (f.menu ?? []).filter((m) => allows(ctx, f, m.permission)).map((m) => ({ label: m.label, href: m.href, icon: m.icon, order: m.order ?? 50 })))
    .sort((a, b) => a.order - b.order)
    .map(({ label, href, icon }) => ({ label, href, icon }));
}
