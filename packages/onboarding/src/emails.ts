import { env } from "@smw/config";
import { emailHtml, type Mail } from "@smw/integrations";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const supportEmail = () => `support@${env().ROOT_DOMAIN}`;

/** The emails of the signup and approval flow. Pure: build a Mail, the caller sends it. */
export const OnboardingEmails = {
  verify(p: { to: string; adminName: string; schoolName: string; link: string }): Mail {
    return {
      to: p.to,
      subject: `Confirm your email to register ${p.schoolName} on Triakshi`,
      text: `Hi ${p.adminName},\n\nThanks for registering ${p.schoolName}. Confirm your email and choose a password:\n\n${p.link}\n\nThe link works for 48 hours and only once. Our team then reviews your school, usually within one business day, and we email you when it is approved.\n\nIf you did not sign up, ignore this email.`,
      html: emailHtml("Confirm your email", `<p>Hi ${esc(p.adminName)},</p><p>Thanks for registering <b>${esc(p.schoolName)}</b>. Confirm your email and choose a password. The link works for 48 hours and only once.</p><p>Our team then reviews your school, usually within one business day. We email you when it is approved.</p>`, { label: "Confirm email and set password", url: p.link }),
    };
  },

  /** `link` comes from signInLink: a one-time "set your password" page when they have none yet, else sign-in with the email filled in. */
  approved(p: { to: string; adminName: string; schoolName: string; trialDays: number; link: string; setPassword: boolean }): Mail {
    const next = p.setPassword ? "Set your password to sign in (the link works for 7 days, once)." : "Sign in with this email and the password you chose.";
    const label = p.setPassword ? "Set password and sign in" : "Sign in to your school";
    return {
      to: p.to,
      subject: `Your school is approved: ${p.schoolName}`,
      text: `Hi ${p.adminName},\n\n${p.schoolName} is approved. Your ${p.trialDays}-day free trial starts today.\n\n${next} Then finish the quick setup:\n${p.link}\n\nTriakshi`,
      html: emailHtml("Your school is approved", `<p>Hi ${esc(p.adminName)},</p><p><b>${esc(p.schoolName)}</b> is approved. Your ${p.trialDays}-day free trial starts today.</p><p>${esc(next)} Then finish the quick setup.</p>`, { label, url: p.link }),
    };
  },

  /** Sent when someone tries to register a new school with an email that already signs in to one. */
  existingAccount(p: { to: string; name: string; schoolName: string; link: string; setPassword: boolean }): Mail {
    const how = p.setPassword ? "You have not set a password yet, so the button below lets you choose one (it works for 7 days, once)." : "Sign in with this email and your password. If you forgot it, use Forgot password on that page.";
    return {
      to: p.to,
      subject: `You already have a Triakshi account: ${p.schoolName}`,
      text: `Hi ${p.name},\n\nSomeone (probably you) tried to register a new school with this email. It already signs in to ${p.schoolName}, so no new school was created.\n\n${how}\n${p.link}\n\nTo register a different school, use a different email address.\n\nTriakshi`,
      html: emailHtml("You already have an account", `<p>Hi ${esc(p.name)},</p><p>Someone (probably you) tried to register a new school with this email. It already signs in to <b>${esc(p.schoolName)}</b>, so no new school was created.</p><p>${esc(how)}</p><p>To register a different school, use a different email address.</p>`, { label: p.setPassword ? "Set password and sign in" : `Sign in to ${p.schoolName}`, url: p.link }),
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
