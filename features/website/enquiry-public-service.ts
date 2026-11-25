// The enquiry and question forms of the public website. Nobody is signed in: the route builds a system context for the school
// and this service may only record an enquiry (permission "public").
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { RateLimiter } from "@smw/auth";
import { AppError, f, systemCtx, ValidationError, type Ctx } from "@smw/feature-kit";
import { releaseMail, reserveMail } from "@smw/feature-notifications/delivery";
import { services, trySend } from "@smw/integrations";
import { ENQUIRY_CONSENT_TEXT, ENQUIRY_CONSENT_VERSION } from "@smw/site-templates";
import { EnquiryBase, istDay, istStart, ipKey, loadEnquirySettings, phoneKeyOf, schoolClasses, schoolSessions, type Who } from "./enquiry-core";
import { mobile } from "./enquiry-inputs";
import { enquiries, enquiryEvents } from "./schema";

const WEBSITE: Who = { id: null, name: "Website" };
/** A form posted faster than a person can type is probably a script, but it may be a person: they are asked to press Send again, and nothing is lost. A start time that is in the future or hours old is ignored. */
const MIN_FILL_MS = 1500;
/** The thank-you mail goes once a day to one address or phone, and a school sends at most this many a day, so it never eats the mail share. */
const ACK_DAILY_CAP = 40;
const AGAIN_TEXT = 300;
const DUPLICATE_DAYS = 30;

const common = {
  parentName: f.text(2, 100, "Enter your name"),
  phone: mobile(),
  email: f.optEmail(),
  message: f.optText(1000),
  consent: z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.literal(true, { error: "Please tick the box to say the school may contact you" })),
  utm_source: f.optText(80),
  utm_campaign: f.optText(80),
  /** Where the form was: filled by the site, never shown. Only an address of the site is kept. */
  page: z.string().trim().max(200).regex(/^\/[^\s\\]*$/).optional().catch(undefined),
};
const admissionInput = z.object({ ...common, studentName: f.text(2, 100, "Enter the child's name"), dob: f.optDate(), classApplying: f.optText(40), session: f.optText(9), relation: f.optText(20) });
const questionInput = z.object({ ...common, message: f.text(1, 1000, "Write your question") });

export interface PublicFormOptions { classes: string[]; sessions: string[]; session: string; consentText: string }

export class PublicEnquiryService extends EnquiryBase {
  /** Per visitor address, and for the whole school whatever the addresses (a made-up X-Forwarded-For must not open the floodgate). Tests reset them. */
  static readonly limiter = new RateLimiter(8, 60 * 60_000);
  static readonly schoolLimiter = new RateLimiter(200, 60 * 60_000);

  constructor(ctx: Ctx) { super(ctx); }

  static forSchool(schoolId: string, features: Iterable<string>, readOnly = false) {
    return new PublicEnquiryService({ ...systemCtx(schoolId, features), readOnly });
  }

  /**
   * What the forms offer: the school's own classes (a section's list narrows them; without academics the section's own list is used),
   * the sessions when next year exists, and the words the parent agrees to.
   */
  async options(narrow: string[] = []): Promise<PublicFormOptions> {
    return this.read("public", async (tx) => {
      const [own, sessions] = await Promise.all([schoolClasses(tx), schoolSessions(tx)]);
      const keep = new Set(narrow.map((c) => c.toLowerCase()));
      const narrowed = narrow.length ? own.filter((c) => keep.has(c.toLowerCase())) : own;
      return {
        classes: narrowed.length ? narrowed : narrow, sessions: sessions.later.length ? [sessions.current, ...sessions.later] : [], session: sessions.current, consentText: ENQUIRY_CONSENT_TEXT,
      };
    });
  }

  /**
   * Record an admission enquiry or a question. A filled honeypot or a form sent too fast gets the same success and stores nothing.
   * The same phone and child within 30 days adds a line to the first enquiry instead of a second row, with the same visible success.
   */
  async submit(input: unknown, meta: { ip?: string } = {}): Promise<{ received: true }> {
    this.authorize("public", "write");
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    if (String(raw.website ?? "").trim()) return { received: true };
    const age = Date.now() - Number(raw.ts);
    if (Number.isFinite(age) && age >= 0 && age < MIN_FILL_MS) throw new AppError("That was very quick. Please press Send again.", "too_fast", 422);
    if (!PublicEnquiryService.schoolLimiter.take(this.ctx.schoolId) || !PublicEnquiryService.limiter.take(`${this.ctx.schoolId}:${ipKey(meta.ip)}`)) {
      throw new AppError("We have received several enquiries from you. Please try again in an hour, or call the school office.", "rate_limited", 429);
    }
    const question = raw.kind === "question";
    const d = this.parse(question ? questionInput : admissionInput, raw) as z.infer<typeof admissionInput> & { studentName?: string };
    const campaign = [d.utm_source, d.utm_campaign].filter(Boolean).join(" / ") || null;
    const now = new Date();

    const out = await this.write("public", async (tx) => {
      const [settings, sessions] = [await loadEnquirySettings(tx), await schoolSessions(tx)];
      if (d.session && ![sessions.current, ...sessions.later].includes(d.session)) throw new ValidationError({ session: "Choose a session from the list" });
      const classes = await schoolClasses(tx);
      if (d.classApplying && classes.length && !classes.some((c) => c.toLowerCase() === d.classApplying!.toLowerCase())) throw new ValidationError({ classApplying: "Choose a class from the list" });
      const child = question ? "General question" : d.studentName!;
      const key = phoneKeyOf(d.phone);
      // Two posts of the same form at once must not make two rows.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enquiry:${this.ctx.schoolId}:${key}`}))`);
      const [again] = await tx.select({ id: enquiries.id, ref: enquiries.ref, ownerId: enquiries.ownerId, kind: enquiries.kind, classApplying: enquiries.classApplying }).from(enquiries)
        .where(and(eq(enquiries.phoneKey, key), eq(enquiries.kind, question ? "question" : "admission"), sql`lower(${enquiries.studentName}) = lower(${child})`, isNull(enquiries.mergedInto),
          gt(enquiries.createdAt, new Date(now.getTime() - DUPLICATE_DAYS * 86_400_000)))).orderBy(desc(enquiries.createdAt)).limit(1);
      if (again) {
        // One line a day per enquiry, whatever is posted, and a short one: a repeat cannot fill the timeline.
        const [today] = await tx.select({ id: enquiryEvents.id }).from(enquiryEvents).where(and(eq(enquiryEvents.enquiryId, again.id), eq(enquiryEvents.kind, "again"), gt(enquiryEvents.createdAt, new Date(now.getTime() - 86_400_000)))).limit(1);
        if (!today) {
          const said = d.message ? d.message.slice(0, AGAIN_TEXT) : "";
          await this.log(tx, again.id, "again", said ? `The family wrote again: ${said}` : "The family sent the form again", { campaign }, WEBSITE);
          await this.tellNew(tx, again, true);
        }
        return { id: again.id, ref: again.ref, school: "", email: null as string | null, phone: key, fresh: false };
      }
      const row = await this.insertNew(tx, settings, {
        kind: question ? "question" : "admission", studentName: child, parentName: d.parentName, phone: d.phone, email: d.email, message: d.message, campaign,
        dob: d.dob, classApplying: d.classApplying, session: d.session, relation: d.relation, source: "website", pagePath: d.page?.split(/[?#]/)[0] || null, consentAt: now, consentText: `${ENQUIRY_CONSENT_VERSION}: ${ENQUIRY_CONSENT_TEXT}`,
      }, { by: WEBSITE });
      await this.tellNew(tx, row, false);
      return { id: row.id, ref: row.ref, school: (await this.schoolRow(tx)).name, email: row.email, phone: key, fresh: true, ack: settings.ackText };
    });
    if (out.fresh && out.email) await this.acknowledge(out as typeof out & { ack: string; email: string });
    return { received: true };
  }

  /**
   * The thank-you mail with the reference. Not to an address or a phone that was mailed in the last day, not past the school's own daily
   * cap, and nothing the visitor typed goes into it. Each outcome is a line on the timeline.
   */
  private async acknowledge(o: { id: string; ref: string | null; school: string; email: string; phone: string; ack: string }) {
    const now = new Date();
    const result = await this.write("public", async (tx) => {
      const [again] = [...(await tx.execute(sql`select 1 from enquiry_events v join enquiries e on e.id = v.enquiry_id where v.kind = 'email' and v.detail->>'ack' = 'sent' and v.created_at > now() - interval '24 hours' and (lower(e.email) = lower(${o.email}) or e.phone_key = ${o.phone}) limit 1`))];
      if (again) return "skipped" as const;
      const [{ n }] = [...(await tx.execute(sql`select count(*)::int as n from enquiry_events where kind = 'email' and detail->>'ack' = 'sent' and created_at >= ${istStart(istDay(now)).toISOString()}::timestamptz`))] as [{ n: number }];
      return n >= ACK_DAILY_CAP ? ("capped" as const) : ("go" as const);
    });
    let outcome: "sent" | "skipped" | "capped" | "no-budget" | "failed" = result === "go" ? "sent" : result;
    if (result === "go") {
      if (!(await reserveMail(this.ctx.schoolId, 3, now))) outcome = "no-budget";
      else if (!(await trySend(services().email, { to: o.email, subject: `We have your enquiry · ${o.school}`, text: `Hello,\n\n${o.ack}\n\nYour reference is ${o.ref}.\n\n${o.school}` }))) { await releaseMail(this.ctx.schoolId, now); outcome = "failed"; }
    }
    const body = { sent: `Acknowledgement sent to ${o.email}`, skipped: "Acknowledgement not sent: this family was mailed in the last day", capped: "Acknowledgement not sent: the school's daily limit for these mails is used", "no-budget": "Acknowledgement not sent: today's email limit is used up", failed: `Acknowledgement could not be sent to ${o.email}` }[outcome];
    await this.write("public", (tx) => this.log(tx, o.id, "email", body, { ack: outcome }, WEBSITE)).catch((e) => console.error(JSON.stringify({ level: "error", msg: "enquiry mail note failed", err: String(e) })));
  }
}
