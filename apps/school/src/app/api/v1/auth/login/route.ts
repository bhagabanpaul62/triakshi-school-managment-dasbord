import { AppError } from "@smw/feature-kit";
import { LoginError, SchoolAuth } from "@smw/auth";
import { apiHandler, readJson, schoolFromRequest } from "@smw/runtime/bearer";
import { loginBody } from "../../_schemas";

/** POST /api/v1/auth/login { identifier, password } -> { token, expiresAt, user }. The token is a school session token: send it as `Authorization: Bearer <token>`. */
export const POST = apiHandler(async (req) => {
  const body = await readJson(req, loginBody);
  const school = await schoolFromRequest(req);
  const auth = new SchoolAuth(school.id);
  try {
    const { token, expiresAt, mustChangePassword } = await auth.login(body.identifier, body.password, {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: req.headers.get("user-agent") ?? "mobile-api",
    });
    const session = await auth.validate(token);
    // When true, every other route answers 403 password_change_required until POST /api/v1/auth/change-password.
    return { token, expiresAt: expiresAt.toISOString(), mustChangePassword, user: session && { id: session.user.id, name: session.user.name, role: session.user.role, email: session.user.email, avatarUrl: session.user.avatarUrl } };
  } catch (e) {
    if (e instanceof LoginError) {
      if (e.reason === "rate_limited") throw new AppError("Too many attempts. Wait 15 minutes and try again.", "rate_limited", 429);
      if (e.reason === "disabled") throw new AppError("This account is disabled. Ask your school office.", "account_disabled", 403);
      throw new AppError("That login ID or password is not right.", "invalid_credentials", 401);
    }
    throw e;
  }
});
