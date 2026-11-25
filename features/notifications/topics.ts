// Every kind of notification in the product. Nothing is sent without a topic from here. Client-safe.
import type { EmailMode } from "./constants";

export const TOPIC_GROUPS = {
  urgent: "Safety and urgent", attendance: "Attendance and leave", notices: "Notices", messages: "Messages and requests",
  homework: "Homework", exams: "Exams and results", fees: "Fees and payments", services: "Library and transport",
  calendar: "Calendar and meetings", work: "Approvals and work",
} as const;
export type TopicGroup = keyof typeof TOPIC_GROUPS;

interface Topic { group: TopicGroup; label: string; push: boolean; email: EmailMode; /** People cannot turn it off. */ mustTell?: true; priority?: 1 | 2 | 3 | 4 }
const t = (group: TopicGroup, label: string, push: boolean, email: EmailMode, extra: Pick<Topic, "mustTell" | "priority"> = {}): Topic => ({ group, label, push, email, ...extra });

export const TOPICS = {
  "urgent.alert": t("urgent", "Urgent alert", true, "instant", { mustTell: true, priority: 1 }),
  "safety.report": t("urgent", "A reported concern", true, "instant", { mustTell: true, priority: 1 }),
  "attendance.absence": t("attendance", "Absent or late", true, "instant", { mustTell: true, priority: 2 }),
  "attendance.leave": t("attendance", "Leave requests", true, "digest"),
  "notice.published": t("notices", "New notice", true, "digest"),
  "notice.changed": t("notices", "Notice corrected or withdrawn", true, "digest"),
  "notice.answer": t("notices", "A notice needs your answer", true, "instant", { priority: 3 }),
  "notice.approval": t("work", "Notices waiting for approval", true, "digest"),
  "message.new": t("messages", "New message", true, "digest"),
  "request.update": t("messages", "Your request", true, "instant", { priority: 3 }),
  "request.work": t("work", "Requests for you", true, "digest"),
  "homework.new": t("homework", "New homework", true, "digest"),
  "homework.due": t("homework", "Homework due soon", true, "off"),
  "homework.graded": t("homework", "Homework marked", true, "digest"),
  "exam.schedule": t("exams", "Exam dates and admit cards", true, "digest"),
  "exam.result": t("exams", "Results", true, "digest"),
  "fees.due": t("fees", "Fee due and overdue", true, "instant", { priority: 3 }),
  "fees.payment": t("fees", "Payments and receipts", true, "digest"),
  "library.due": t("services", "Library books", true, "digest"),
  "transport.notice": t("services", "Bus changes", true, "instant", { priority: 2 }),
  "event.invite": t("calendar", "New events", true, "digest"),
  "event.changed": t("calendar", "Event changed or cancelled", true, "instant", { priority: 3 }),
  "event.reminder": t("calendar", "Event reminders", true, "off"),
  "holiday.declared": t("calendar", "Holidays", true, "digest"),
  "meeting.open": t("calendar", "Meeting booking", true, "instant", { priority: 3 }),
  "meeting.changed": t("calendar", "Meeting changed or cancelled", true, "instant", { priority: 3 }),
  "meeting.reminder": t("calendar", "Meeting reminders", true, "off"),
  "work.approval": t("work", "Waiting for your approval", true, "digest"),
  "work.cover": t("work", "Cover duty", true, "instant", { priority: 2 }),
  "work.decision": t("work", "Decisions on your requests", true, "digest"),
  "work.update": t("work", "Other updates", false, "digest"),
  "payroll.payslip": t("work", "Payslips and salary", true, "digest"),
} as const satisfies Record<string, Topic>;
export type TopicKey = keyof typeof TOPICS;
export const topicOf = (k: TopicKey): Topic => TOPICS[k];
/** Groups where every topic must be told: shown locked in the preferences. */
export const lockedGroup = (g: TopicGroup) => Object.values(TOPICS as Record<string, Topic>).filter((x) => x.group === g).every((x) => x.mustTell);
