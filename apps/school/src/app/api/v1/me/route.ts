import { apiHandler, bearerSession } from "@smw/runtime/bearer";

/** GET /api/v1/me: who the token belongs to, the school, and which modules are on. */
export const GET = apiHandler(async (req) => {
  const { ctx, school, session } = await bearerSession(req);
  const u = session.user;
  return {
    user: { id: u.id, name: u.name, role: u.role, email: u.email, avatarUrl: u.avatarUrl },
    school: { id: school.id, slug: school.slug, name: school.name },
    features: [...ctx.features].sort(),
    readOnly: ctx.readOnly,
    ...(ctx.leftUntil ? { leftUntil: ctx.leftUntil } : {}),
    expiresAt: session.expiresAt.toISOString(),
  };
});
