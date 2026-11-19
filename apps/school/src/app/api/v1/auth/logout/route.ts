import { SchoolAuth } from "@smw/auth";
import { apiHandler, bearerSession, bearerToken } from "@smw/runtime/bearer";

/** POST /api/v1/auth/logout: ends the session behind the bearer token. */
export const POST = apiHandler(async (req) => {
  const { school } = await bearerSession(req);
  await new SchoolAuth(school.id).logout(bearerToken(req));
  return { ok: true };
});
