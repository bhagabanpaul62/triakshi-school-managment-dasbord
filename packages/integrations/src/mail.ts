import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@smw/config";

export interface Mail { to: string; subject: string; text: string; html?: string; replyTo?: string; attachments?: { filename: string; content: Uint8Array; contentType: string }[] }

export interface EmailSender { send(mail: Mail): Promise<void> }

/** SMTP: Mailpit locally, Amazon SES SMTP (ap-south-1) in production. */
export class SmtpEmailSender implements EmailSender {
  private transport: Transporter;
  constructor() {
    const e = env();
    this.transport = nodemailer.createTransport({
      host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_PORT === 465,
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
