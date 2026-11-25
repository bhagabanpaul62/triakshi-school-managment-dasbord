"use server";

import { z } from "zod";
import { AuthInputError, LoginError, OtpError, SchoolAuth, otpMessage } from "@smw/auth";
import { schoolUrl } from "@smw/config";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "@smw/feature-kit";
import { UploadError, authMails, services, trySend, uploadKey } from "@smw/integrations";
import { accountMailer } from "@smw/feature-notifications/delivery";
import { formToObject, getSchool, getSession, runAction, type ActionResult } from "@smw/runtime";
import { FilePolicy } from "../service";
import { profileInput } from "../inputs";

/** The signed-in person on this host. Support sessions and read-only schools cannot change an account. */
async function me() {
  const [school, session] = await Promise.all([getSchool(), getSession()]);
  if (!session) throw new UnauthenticatedError();
  if (session.readOnly || school.readOnly) throw new ForbiddenError("This session is read-only.");
  return { school, session, user: session.user, auth: new SchoolAuth(school.id) };
}

/** Policy and duplicate messages become field errors the form can show. */
function asField<T>(field: string, fn: () => Promise<T>) {
  return fn().catch((err) => { throw err instanceof AuthInputError ? new ValidationError({ [field]: err.message }, err.message) : err; });
}

const passwordSchema = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z.string().min(1, "Choose a new password"),
  confirm: z.string(),
}).refine((v) => v.next === v.confirm, { message: "The passwords do not match", path: ["confirm"] });

/** Shared by /app/profile and the forced /app/change-password page. Ends every other session. */
export async function changeMyPassword(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { school, session, user, auth } = await me();
    const d = passwordSchema.safeParse(formToObject(fd));
    if (!d.success) throw new ValidationError(Object.fromEntries(d.error.issues.map((i) => [i.path.join("."), i.message])));
    try {
      await asField("next", () => auth.changePassword(user.id, d.data.current, d.data.next, session.sessionId));
    } catch (err) {
      if (err instanceof LoginError) throw new ValidationError({ current: "That is not your current password" });
      throw err;
    }
    // A failed mail must not undo the change.
    if (user.email) void trySend(accountMailer(school.id), { to: user.email, ...authMails.passwordChanged(school.name, user.name) });
    return null;
  }, "Password changed. Your other devices are signed out.");
}

/** Name (not for students), mobile, and a new email, which only applies once the link sent to it is opened. */
export async function updateMyDetails(fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const { school, user, auth } = await me();
    const parsed = profileInput.partial({ name: true }).safeParse(formToObject(fd));
    if (!parsed.success) throw new ValidationError(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
    const d = parsed.data;
    const cur = await auth.contactOf(user.id);
    const changing = !!d.email && d.email.toLowerCase() !== cur?.email?.toLowerCase();
    // Ask for the email change first, so a wrong password stops the whole save.
    let req: Awaited<ReturnType<SchoolAuth["requestEmailChange"]>> | null = null;
    if (changing) {
      const pw = String(fd.get("currentPassword") ?? "");
      if (!pw) throw new ValidationError({ currentPassword: "Enter your current password to change your email" });
      try { req = await asField("email", () => auth.requestEmailChange(user.id, d.email!, pw)); } catch (err) {
        if (err instanceof LoginError) throw new ValidationError({ currentPassword: err.reason === "rate_limited" ? "Too many tries. Wait a while." : "That is not your current password" });
        throw err;
      }
    }
    await asField("phone", () => auth.updateProfile(user.id, { phone: d.phone ?? null, ...(user.role !== "student" && d.name ? { name: d.name } : {}) }));
    if (!req) return { sent: null as boolean | null, email: null as string | null };
    const mail = authMails.confirmEmail(school.name, user.name, schoolUrl(school.slug, `/confirm-email?token=${req.token}`), req.code);
    const sent = await trySend(accountMailer(school.id), { to: d.email!, ...mail });
    // Tell the old address, so a hijacked session cannot move the account quietly.
    if (req.oldEmail) {
      const text = `Hello ${user.name},\n\nYour ${school.name} email is being changed to ${d.email}. If this was you, there is nothing to do.\n\nIf it was not you, contact the school office now.`;
      void trySend(accountMailer(school.id), { to: req.oldEmail, subject: `Your email is being changed · ${school.name}`, text });
    }
    return { sent, email: d.email! };
  });
  if (!r.ok || r.data.sent === null) return r.ok ? { ...r, message: "Details saved" } : r;
  return { ...r, message: r.data.sent
    ? `Details saved. We emailed a code and a link to ${r.data.email}. Your email changes when you enter the code or open the link.`
    : "Details saved, but we couldn't email the confirmation code, so your email did not change. Ask your school office." };
}

/** The 6-digit code sent to the new address, typed on the profile. */
export async function confirmMyEmailCode(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { session, user, auth } = await me();
    const code = String(fd.get("code") ?? "").replace(/\D/g, "");
    if (code.length !== 6) throw new ValidationError({ code: "Enter the 6-digit code" });
    try { await asField("code", () => auth.confirmEmailChangeWithCode(user.id, code, session.sessionId)); } catch (err) {
      if (err instanceof OtpError) throw new ValidationError({ code: otpMessage(err) }, otpMessage(err));
      if (err instanceof LoginError) throw new ValidationError({ code: "Too many tries. Wait a while and send a new code." });
      throw err;
    }
    return null;
  }, "Email confirmed");
}

/** Email a code that proves I own my current email. */
export async function sendMyVerifyCode(): Promise<ActionResult> {
  return runAction(async () => {
    const { school, user, auth } = await me();
    const mail = await asField("code", () => auth.sendVerifyEmailCode(user.id));
    const sent = await trySend(accountMailer(school.id), { to: mail.to, ...authMails.otp(school.name, mail.name, mail.code, "verify_email") });
    if (!sent) throw new ValidationError({ code: "We could not send the email. Try again later." }, "We could not send the email. Try again later.");
    return null;
  }, "We emailed you a 6-digit code");
}

export async function verifyMyEmailCode(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { user, auth } = await me();
    const code = String(fd.get("code") ?? "").replace(/\D/g, "");
    if (code.length !== 6) throw new ValidationError({ code: "Enter the 6-digit code" });
    try { await auth.verifyEmailWithCode(user.id, code); } catch (err) {
      if (err instanceof OtpError) throw new ValidationError({ code: otpMessage(err) }, otpMessage(err));
      if (err instanceof LoginError) throw new ValidationError({ code: "Too many tries. Wait a while and send a new code." });
      throw err;
    }
    return null;
  }, "Email verified");
}

export async function setMyPhoto(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { school, user, auth } = await me();
    const file = fd.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ photo: "Choose a photo" });
    let key: string;
    try { key = uploadKey(school.id, "avatars", file, "image"); } catch (err) {
      if (err instanceof UploadError) throw new ValidationError({ photo: err.message }, err.message);
      throw err;
    }
    await services().storage.put(key, new Uint8Array(await file.arrayBuffer()), file.type);
    await auth.updateProfile(user.id, { avatarUrl: FilePolicy.url(key) });
    const prev = FilePolicy.keyOf(user.avatarUrl);
    if (prev?.startsWith(`${school.id}/avatars/`)) await services().storage.delete(prev).catch(() => undefined);
    return null;
  }, "Photo updated");
}

export async function signOutDevice(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { user, auth } = await me();
    await auth.revokeSession(user.id, String(fd.get("id")));
    return null;
  }, "Signed out on that device");
}

export async function signOutOtherDevices(): Promise<ActionResult> {
  return runAction(async () => {
    const { session, user, auth } = await me();
    await auth.logoutOthers(user.id, session.sessionId);
    return null;
  }, "Signed out everywhere else");
}
