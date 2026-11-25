import { withSchool, eq, users } from "@smw/db";
import { alertsNewDevice } from "@smw/feature-settings/service";
import { accountMailer } from "@smw/feature-notifications/delivery";
import { emailHtml, escapeHtml, trySend } from "@smw/integrations";

/**
 * "Was this you?" mail after a sign-in from a device family the person never used before (not their very first sign-in).
 * Admins and accountants get it unless they turned it off; everyone else when they turned it on (My profile).
 * Never awaited by callers and never throws: a mail problem must not change the sign-in.
 */
export async function mailNewDevice(school: { id: string; name: string }, userId: string, seen: { newDevice: boolean; firstSignIn: boolean }, device: string) {
  if (!seen.newDevice || seen.firstSignIn) return;
  try {
    const [u] = await withSchool(school.id, (tx) => tx.select({ name: users.name, email: users.email, role: users.role, alertNewDevice: users.alertNewDevice }).from(users).where(eq(users.id, userId)).limit(1));
    if (!u?.email || !alertsNewDevice(u)) return;
    const first = u.name.trim().split(/\s+/)[0] || "there";
    await trySend(accountMailer(school.id), {
      to: u.email,
      subject: `New sign-in to your account · ${school.name}`,
      text: `Hello ${first},\n\nYour ${school.name} account was just used from a new device: ${device}.\n\nIf this was you, there is nothing to do. If it was not, change your password now from My profile, or ask your school admin to sign you out everywhere.`,
      html: emailHtml("New sign-in to your account", `<p>Hello ${escapeHtml(first)},</p><p>Your ${escapeHtml(school.name)} account was just used from a new device: ${escapeHtml(device)}.</p><p>If this was you, there is nothing to do. If it was not, change your password now from My profile, or ask your school admin to sign you out everywhere.</p>`),
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "new device mail failed", err: String(err) }));
  }
}
