"use server";

import { formToObject } from "@smw/runtime";
import { services } from "@smw/integrations";
import { schoolUrl } from "@smw/config";
import {
  ApprovalService, DesignRequestService, ModuleAdminService, NoticeService, PlanAdminService, SchoolAdminService, StaffAdminService, SupportDeskService, SupportLoginService,
  type DeskFile, type DesignStatus,
} from "@smw/platform";
import { addWorkingHours, replyHours } from "@smw/feature-support/sla";
import { consoleAction, field } from "@/lib/console-action";

const id = (fd: FormData) => field(fd, "id");

// ----- schools -----

export async function createSchool(fd: FormData) {
  return consoleAction(SchoolAdminService, async (s) => {
    const r = await s.create(formToObject(fd));
    // Invite email is best effort: the school exists either way and staff can resend from the school page.
    const to = field(fd, "adminEmail").trim();
    try {
      await services().email.send({
        to, subject: "Your Triakshi school panel is ready",
        text: `Hello ${field(fd, "adminName")},\n\nYour school panel is ready. Set your password here (the link works for 7 days):\n${schoolUrl(r.slug, `/reset-password?token=${encodeURIComponent(r.inviteToken)}`)}\n\nTriakshi`,
      });
    } catch (err) { console.error(JSON.stringify({ level: "warn", msg: "invite email failed", err: String(err) })); }
    return { schoolId: r.schoolId };
  }, "School created. The administrator has been sent an invite.");
}
export async function suspendSchool(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.suspend(id(fd), field(fd, "reason") || undefined), "School suspended");
}
export async function reactivateSchool(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.reactivate(id(fd)), "School reactivated");
}
export async function makeSchoolReadOnly(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.setReadOnly(id(fd)), "School is now read-only");
}
export async function extendTrial(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.extendTrial(id(fd), Number(field(fd, "days"))), "Trial extended");
}
export async function changePlan(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.changePlan(id(fd), field(fd, "planId")), "Plan changed");
}
export async function scheduleDeletion(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.scheduleDeletion(id(fd)), "Deletion scheduled for 30 days from now");
}
export async function setOverride(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.setOverride(id(fd), formToObject(fd)), "Override saved");
}
export async function removeOverride(fd: FormData) {
  return consoleAction(SchoolAdminService, (s) => s.removeOverride(id(fd), field(fd, "moduleKey")), "Override removed");
}

/** Returns the one-time URL; the dialog shows it to the staff member (it is never stored in the page). */
export async function createSupportLogin(fd: FormData) {
  return consoleAction(SupportLoginService, async (s) => {
    const r = await s.create({ ...formToObject(fd), schoolId: id(fd) });
    return { url: r.url, userName: r.userName, expiresAt: r.expiresAt.toISOString() };
  });
}

// ----- approvals -----

export async function approveSchool(fd: FormData) {
  const r = await consoleAction(ApprovalService, (s) => s.approve(id(fd), field(fd, "note") || undefined));
  if (!r.ok) return r;
  return { ...r, message: r.data.emailSent ? "Approved. The 30-day trial has started and the administrator has a sign-in link." : "Approved, but the email did not send. Tell the administrator to sign in." };
}
export async function resendSchoolSignIn(fd: FormData) {
  const r = await consoleAction(ApprovalService, (s) => s.resendSignIn(id(fd)));
  if (!r.ok) return r;
  return { ...r, message: !r.data.emailSent ? "The email did not send. Check the email settings, then try again."
    : r.data.setPassword ? "Sent. The administrator gets a link to set their password and sign in." : "Sent. The administrator gets a sign-in link with their email filled in." };
}
export async function rejectSchool(fd: FormData) {
  const r = await consoleAction(ApprovalService, (s) => s.reject(id(fd), field(fd, "reason")));
  if (!r.ok) return r;
  return { ...r, message: r.data.emailSent ? "School rejected. The administrator has been emailed the reason." : "School rejected, but the email did not send. Write to the administrator yourself." };
}
export async function reopenSchool(fd: FormData) {
  return consoleAction(ApprovalService, (s) => s.reopen(id(fd)), "Back in the review queue");
}

// ----- plans and modules -----

export async function editPlan(fd: FormData) {
  return consoleAction(PlanAdminService, (s) => s.edit(id(fd), formToObject(fd)), "Saved as a new version. Current subscribers keep their old terms.");
}
export async function setPlanFlags(fd: FormData) {
  return consoleAction(PlanAdminService, (s) => s.setFlags(id(fd), {
  ...(fd.has("isPublic") && { isPublic: field(fd, "isPublic") === "true" }), ...(fd.has("isActive") && { isActive: field(fd, "isActive") === "true" }),
}), "Plan updated");
}
export async function setModuleStage(fd: FormData) {
  return consoleAction(ModuleAdminService, (s) => s.setStage(field(fd, "key"), field(fd, "stage") as never), "Stage changed");
}

// ----- staff -----

export async function createStaff(fd: FormData) {
  return consoleAction(StaffAdminService, (s) => s.create(formToObject(fd)), "Staff member added");
}
export async function setStaffStatus(fd: FormData) {
  return consoleAction(StaffAdminService, (s) => s.setStatus(id(fd), field(fd, "status") as "active" | "disabled"), "Updated");
}
export async function resetStaffTwoFactor(fd: FormData) {
  return consoleAction(StaffAdminService, (s) => s.resetTwoFactor(id(fd)), "Two-step login reset. They set it up again at next sign-in.");
}

// ----- support desk and design requests -----

/** The files of a form, in the order they were picked. */
async function filesOf(fd: FormData): Promise<DeskFile[]> {
  const out: DeskFile[] = [];
  for (const v of fd.getAll("files")) if (v instanceof File && v.size > 0) out.push({ name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) });
  return out;
}
export async function replyToTicket(fd: FormData) {
  return consoleAction(SupportDeskService, async (s) => s.reply(id(fd), formToObject(fd), await filesOf(fd)), "Reply sent. The school is told within a minute.");
}
export async function addTicketNote(fd: FormData) {
  return consoleAction(SupportDeskService, (s) => s.addNote(id(fd), formToObject(fd)), "Note added. Only the team sees it.");
}
export async function setTicketStatus(fd: FormData) {
  return consoleAction(SupportDeskService, (s) => s.setStatus(id(fd), field(fd, "status") as never), "Status updated");
}
export async function setTicketPriority(fd: FormData) {
  const priority = field(fd, "priority") as "low" | "normal" | "high" | "urgent";
  return consoleAction(SupportDeskService, (s) => s.setPriority(id(fd), priority, (t) => addWorkingHours(t.createdAt, replyHours(priority, t.planKey))), "Priority updated");
}
export async function setTicketCategory(fd: FormData) {
  return consoleAction(SupportDeskService, (s) => s.setCategory(id(fd), field(fd, "category") as never), "Category updated");
}
/** Hand the ticket to anyone on the team; "nobody" gives it back to the queue. */
export async function assignTicket(fd: FormData) {
  return consoleAction(SupportDeskService, (s) => s.assign(id(fd), field(fd, "staffId") === "none" ? null : field(fd, "staffId")), "Owner changed");
}
export async function assignTicketToMe(fd: FormData) {
  return consoleAction(SupportDeskService, (s) => s.assign(id(fd)), "Assigned to you");
}
export async function saveSavedReply(fd: FormData) {
  return consoleAction(SupportDeskService, (s) => s.saveReply(field(fd, "id") || undefined, formToObject(fd)), "Saved reply kept");
}
export async function deleteSavedReply(fd: FormData) {
  return consoleAction(SupportDeskService, (s) => s.deleteReply(id(fd)), "Saved reply deleted");
}

// ----- notices -----

/** A time typed in the form is India time. */
const ist = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+05:30` : v);
export async function createNotice(fd: FormData) {
  const o = formToObject(fd);
  return consoleAction(NoticeService, (s) => s.create({ ...o, startsAt: ist(o.startsAt), endsAt: ist(o.endsAt) }), "Notice posted");
}
export async function endNotice(fd: FormData) {
  return consoleAction(NoticeService, (s) => s.end(id(fd)), "Notice ended");
}
export async function moveDesignRequest(fd: FormData) {
  return consoleAction(DesignRequestService, (s) => s.move(id(fd), field(fd, "to") as DesignStatus, fd.get("quotePaise") ? Number(fd.get("quotePaise")) : undefined), "Request updated");
}

