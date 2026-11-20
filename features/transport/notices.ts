import { eq, inArray, and } from "drizzle-orm";
import { schoolUrl } from "@smw/config";
import { schools, users, type Tx } from "@smw/db";
import { NotFoundError, SchoolService, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { emailHtml, services, trySend } from "@smw/integrations";
import { students } from "@smw/feature-students/schema";
import transportFeature from "./feature";
import { noticeInput } from "./inputs";
import { routes, studentTransport } from "./schema";

type Perm = keyof typeof transportFeature.permissions;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface Mail { to: string; name: string; subject: string; text: string; html: string }

/** Email to send after the transaction commits. One bad address never stops the rest. Returns how many went out. */
export async function sendAll(mails: Mail[]): Promise<number> {
  let sent = 0;
  for (const m of mails) if (await trySend(services().email, { to: m.to, subject: m.subject, text: m.text, html: m.html })) sent++;
  return sent;
}

/** The school's name and a link into the app, for the email button. */
export async function appLink(tx: Tx, path: string) {
  const [school] = await tx.select({ name: schools.name, slug: schools.slug }).from(schools).limit(1);
  return { schoolName: school?.name ?? "School", url: schoolUrl(school?.slug ?? "", path) };
}

/** "Bus is late by 20 minutes": one notice to every student riding a route, in the app and by email (no parent logins: the student login is the family login). */
export class RouteNoticeService extends SchoolService<Perm> {
  protected feature = transportFeature;
  constructor(ctx: Ctx) { super(ctx); }

  async send(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(noticeInput, input);
    const mails: Mail[] = [];
    const out = await this.write("manage", async (tx) => {
      const [route] = await tx.select({ id: routes.id, name: routes.name }).from(routes).where(eq(routes.id, data.routeId)).limit(1);
      if (!route) throw new NotFoundError("Route");
      const riders = await tx.select({ userId: students.userId }).from(studentTransport).innerJoin(students, eq(students.id, studentTransport.studentId))
        .where(and(eq(studentTransport.routeId, route.id), eq(students.status, "active")));
      const ids = [...new Set(riders.flatMap((r) => (r.userId ? [r.userId] : [])))];
      const title = `${route.name}: ${data.title}`;
      const notified = await NotificationWriter.insert(tx, this.ctx.schoolId, ids.map((userId) => ({ userId, kind: "system" as const, title, body: data.body, href: "/app/transport" })));
      const people = ids.length ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.schoolId, this.ctx.schoolId), inArray(users.id, ids))) : [];
      const { url } = await appLink(tx, "/app/transport");
      for (const p of people) {
        if (!p.email) continue;
        mails.push({ to: p.email, name: p.name, subject: title, text: `${data.body}\n\n${url}\n`, html: emailHtml(esc(title), `<p>${esc(data.body).replace(/\n/g, "<br>")}</p>`, { label: "Open transport", url }) });
      }
      return { routeId: route.id, routeName: route.name, riders: riders.length, notified };
    }, (r) => ({ action: "notice", entity: "Route", entityId: r.routeId, summary: `Sent a notice to ${r.riders} students on ${r.routeName}: ${data.title}` }));
    return { ...out, emailed: await sendAll(mails) };
  }
}
