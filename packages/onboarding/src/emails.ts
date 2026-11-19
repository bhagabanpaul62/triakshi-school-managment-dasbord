import { env, schoolUrl } from "@smw/config";
import { emailHtml, type Mail } from "@smw/integrations";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const supportEmail = () => `support@${env().ROOT_DOMAIN}`;

/** The three emails of the approval flow. Pure: build a Mail, the caller sends it. */
export const OnboardingEmails = {
  verify(p: { to: string; adminName: string; schoolName: string; link: string }): Mail {
    return {
      to: p.to,
      subject: `Confirm your email to register ${p.schoolName} on Triakshi`,
      text: `Hi ${p.adminName},\n\nThanks for registering ${p.schoolName}. Confirm your email and choose a password:\n\n${p.link}\n\nThe link works for 48 hours and only once. Our team then reviews your school, usually within one business day, and we email you when it is approved.\n\nIf you did not sign up, ignore this email.`,
      html: emailHtml("Confirm your email", `<p>Hi ${esc(p.adminName)},</p><p>Thanks for registering <b>${esc(p.schoolName)}</b>. Confirm your email and choose a password. The link works for 48 hours and only once.</p><p>Our team then reviews your school, usually within one business day. We email you when it is approved.</p>`, { label: "Confirm email and set password", url: p.link }),
    };
  },

  approved(p: { to: string; adminName: string; schoolName: string; slug: string; trialDays: number }): Mail {
    const url = schoolUrl(p.slug, "/login");
    return {
      to: p.to,
      subject: `Your school is approved: ${p.schoolName}`,
      text: `Hi ${p.adminName},\n\n${p.schoolName} is approved. Your ${p.trialDays}-day free trial starts today.\n\nSign in and finish the quick setup:\n${url}\n\nIf you have not set a password yet, choose "Forgot password" on that page.\n\nTriakshi`,
      html: emailHtml("Your school is approved", `<p>Hi ${esc(p.adminName)},</p><p><b>${esc(p.schoolName)}</b> is approved. Your ${p.trialDays}-day free trial starts today. Sign in and finish the quick setup. If you have not set a password yet, choose "Forgot password" on the sign-in page.</p>`, { label: "Sign in to your school", url }),
    };
  },

  rejected(p: { to: string; adminName: string; schoolName: string; reason: string }): Mail {
    const support = supportEmail();
    return {
      to: p.to,
      replyTo: support,
      subject: `Update on your Triakshi registration: ${p.schoolName}`,
      text: `Hi ${p.adminName},\n\nWe could not approve ${p.schoolName} yet.\n\nReason: ${p.reason}\n\nIf this looks wrong, or you can send what we need, reply to this email or write to ${support} and we will look again.\n\nTriakshi`,
      html: emailHtml("We could not approve your school yet", `<p>Hi ${esc(p.adminName)},</p><p>We could not approve <b>${esc(p.schoolName)}</b> yet.</p><p><b>Reason:</b> ${esc(p.reason)}</p><p>If this looks wrong, or you can send what we need, reply to this email or write to ${esc(support)} and we will look again.</p>`),
    };
  },
};
