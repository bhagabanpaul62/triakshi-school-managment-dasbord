import { eq, and } from "drizzle-orm";
import { NotFoundError, SchoolService, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";
import transportFeature from "./feature";
import { noticeInput } from "./inputs";
import { routes, studentTransport } from "./schema";

type Perm = keyof typeof transportFeature.permissions;

/** "Bus is late by 20 minutes": one notice to every student riding a route (no parent logins: the student login is the family login). The writer sends the email and push by each person's choices. */
export class RouteNoticeService extends SchoolService<Perm> {
  protected feature = transportFeature;
  constructor(ctx: Ctx) { super(ctx); }

  async send(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(noticeInput, input);
    return this.write("manage", async (tx) => {
      const [route] = await tx.select({ id: routes.id, name: routes.name }).from(routes).where(eq(routes.id, data.routeId)).limit(1);
      if (!route) throw new NotFoundError("Route");
      const riders = await tx.select({ userId: students.userId }).from(studentTransport).innerJoin(students, eq(students.id, studentTransport.studentId))
        .where(and(eq(studentTransport.routeId, route.id), eq(students.status, "active")));
      const ids = [...new Set(riders.flatMap((r) => (r.userId ? [r.userId] : [])))];
      const title = `${route.name}: ${data.title}`;
      const notified = await NotificationWriter.insert(tx, this.ctx.schoolId, ids.map((userId) => ({ userId, topic: "transport.notice" as const, subject: { type: "route", id: route.id }, title, body: data.body, href: "/app/transport" })));
      return { routeId: route.id, routeName: route.name, riders: riders.length, notified };
    }, (r) => ({ action: "notice", entity: "Route", entityId: r.routeId, summary: `Sent a notice to ${r.riders} students on ${r.routeName}: ${data.title}` }));
  }
}
