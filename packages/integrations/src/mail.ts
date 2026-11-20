import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@smw/config";

export interface Mail { to: string; subject: string; text: string; html?: string; replyTo?: string; attachments?: { filename: string; content: Uint8Array; contentType: string }[] }

export interface EmailSender { send(mail: Mail): Promise<void> }

/** SMTP: Mailpit locally; Gmail (app password) or Brevo free on the demo and early production; SES later. All set by SMTP_* env. */
export class SmtpEmailSender implements EmailSender {
  private transport: Transporter;
  constructor() {
    const e = env();
    this.transport = nodemailer.createTransport({
      host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE ?? e.SMTP_PORT === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    });
  }
  async send(m: Mail) {
    await this.transport.sendMail({ from: env().MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) });
  }
}

export class MemoryEmailSender implements EmailSender {
  readonly sent: Mail[] = [];
  async send(m: Mail) { this.sent.push(m); }
}

/** Minimal branded HTML wrapper so every email looks the same. */
export function emailHtml(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const button = cta ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#4F79FF;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">${cta.label}</a></p>` : "";
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111"><h2 style="font-weight:500">${title}</h2>${bodyHtml}${button}<p style="color:#888;font-size:12px">Sent by Triakshi</p></div>`;
}

/** Send without letting a mail failure fail the action. False means "tell the user to ask the office". */
export async function trySend(sender: EmailSender, mail: Mail): Promise<boolean> {
  try { await sender.send(mail); return true; } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "email failed", to: mail.to, subject: mail.subject, err: String(err) }));
    return false;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

const codeText = (code?: string) => (code ? `\n\nOr type this code on the page, it works for 10 minutes: ${code}` : "");
const codeHtml = (code?: string) => (code ? `<p>Or type this code on the page. It works for 10 minutes.</p><p style="font-size:28px;letter-spacing:6px;font-weight:600;margin:12px 0">${esc(code)}</p>` : "");
const OTP_FOR = {
  reset: "reset your password",
  login: "sign in",
  email_change: "confirm your new email address",
  verify_email: "verify your email address",
} as const;

/** Plain-words account mails: every subject carries the school name. */
export const authMails = {
  resetPassword(school: string, name: string, url: string, code?: string): Omit<Mail, "to"> {
    return {
      subject: `Reset your password · ${school}`,
      text: `Hello ${first(name)},\n\nUse this link to set a new password for your ${school} account. It works once and for 60 minutes:\n${url}${codeText(code)}\n\nDid not ask for this? You can ignore this email. Your password stays as it is.`,
      html: emailHtml("Reset your password", `<p>Hello ${esc(first(name))},</p><p>Use the button to set a new password for your ${esc(school)} account. The link works once and for 60 minutes.</p>${codeHtml(code)}<p>Did not ask for this? You can ignore this email. Your password stays as it is.</p>`, { label: "Set a new password", url }),
    };
  },
  passwordChanged(school: string, name: string): Omit<Mail, "to"> {
    return {
      subject: `Your password was changed · ${school}`,
      text: `Hello ${first(name)},\n\nThe password for your ${school} account was just changed. If this was you, there is nothing to do.\n\nIf it was not you, ask your school office to reset your password now.`,
      html: emailHtml("Your password was changed", `<p>Hello ${esc(first(name))},</p><p>The password for your ${esc(school)} account was just changed. If this was you, there is nothing to do.</p><p>If it was not you, ask your school office to reset your password now.</p>`),
    };
  },
  confirmEmail(school: string, name: string, url: string, code?: string): Omit<Mail, "to"> {
    return {
      subject: `Confirm your new email · ${school}`,
      text: `Hello ${first(name)},\n\nConfirm this address as the email for your ${school} account. The link works once and for 24 hours:\n${url}\n\nDid not ask for this? Ignore this email. Nothing changes until you confirm.`,
      html: emailHtml("Confirm your new email", `<p>Hello ${esc(first(name))},</p><p>Confirm this address as the email for your ${esc(school)} account. The link works once and for 24 hours.</p>${codeHtml(code)}<p>Did not ask for this? Ignore this email. Nothing changes until you confirm.</p>`, { label: "Confirm this email", url }),
    };
  },
  /** A 6-digit code on its own (sign in, resend, verify). */
  otp(school: string, name: string, code: string, use: keyof typeof OTP_FOR): Omit<Mail, "to"> {
    const what = OTP_FOR[use];
    return {
      subject: `${code} is your ${school} code`,
      text: `Hello ${first(name)},\n\nYour code to ${what} is ${code}. It works for 10 minutes.\n\nIf this wasn't you, ignore this mail.`,
      html: emailHtml("Your code", `<p>Hello ${esc(first(name))},</p><p>Use this code to ${what}. It works for 10 minutes.</p><p style="font-size:28px;letter-spacing:6px;font-weight:600;margin:12px 0">${esc(code)}</p><p>If this wasn't you, ignore this mail.</p>`),
    };
  },
};
